-- Kivunra migration 002: invoice hardening
--
-- 1. Close RLS gaps (webhook_events, payment_orders, payment_captures)
-- 2. Index the hashed public pay token
-- 3. Race-free per-owner invoice numbering
-- 4. Atomic invoice creation and item replacement
--
-- Safe to re-run: policies and indexes are dropped/created idempotently.

-- ---------------------------------------------------------------------------
-- 1. RLS gaps
-- ---------------------------------------------------------------------------

-- webhook_events is only ever touched by server code using the service role.
-- Enabling RLS without policies denies every anon/authenticated API request.
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own payment orders" ON public.payment_orders;
CREATE POLICY "Users can view own payment orders" ON public.payment_orders
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = payment_orders.invoice_id
        AND i.owner_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can view own payment captures" ON public.payment_captures;
CREATE POLICY "Users can view own payment captures" ON public.payment_captures
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.payment_orders po
      JOIN public.invoices i ON i.id = po.invoice_id
      WHERE po.id = payment_captures.payment_order_id
        AND i.owner_user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 2. Public pay-link tokens
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_public_token_hash
  ON public.invoices (public_token_hash)
  WHERE public_token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_owner_status
  ON public.invoices (owner_user_id, status);

CREATE INDEX IF NOT EXISTS idx_ledger_entries_owner_posted
  ON public.ledger_entries (owner_user_id, direction, posted_at);

-- ---------------------------------------------------------------------------
-- 3. Race-free invoice numbering
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.invoice_number_counters (
  owner_user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_number BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.invoice_number_counters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own invoice counter" ON public.invoice_number_counters;
CREATE POLICY "Users can manage own invoice counter" ON public.invoice_number_counters
  FOR ALL
  USING (auth.uid() = owner_user_id)
  WITH CHECK (auth.uid() = owner_user_id);

CREATE OR REPLACE FUNCTION public.next_invoice_number(p_owner UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_next BIGINT;
BEGIN
  INSERT INTO public.invoice_number_counters (owner_user_id, last_number)
  VALUES (p_owner, 1)
  ON CONFLICT (owner_user_id) DO UPDATE
    SET last_number = public.invoice_number_counters.last_number + 1,
        updated_at = NOW()
  RETURNING last_number INTO v_next;

  RETURN 'INV-' || LPAD(v_next::TEXT, 4, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.next_invoice_number(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_invoice_number(UUID) TO authenticated, service_role;

-- Continue from the highest number already in use instead of restarting at 1.
INSERT INTO public.invoice_number_counters (owner_user_id, last_number)
SELECT i.owner_user_id,
       COALESCE(MAX(NULLIF(regexp_replace(i.invoice_number, '\D', '', 'g'), '')::BIGINT), 0)
FROM public.invoices i
GROUP BY i.owner_user_id
ON CONFLICT (owner_user_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Atomic invoice creation
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_invoice(
  p_customer_id UUID,
  p_items JSONB,
  p_currency TEXT DEFAULT 'USD',
  p_due_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_owner UUID := auth.uid();
  v_invoice_id UUID;
  v_total NUMERIC(18,2) := 0;
  v_number TEXT;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one invoice item is required' USING ERRCODE = '22023';
  END IF;

  -- Never allow linking another user's customer.
  IF p_customer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.customers c
    WHERE c.id = p_customer_id AND c.owner_user_id = v_owner
  ) THEN
    RAISE EXCEPTION 'Customer not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(SUM(
           COALESCE((item->>'quantity')::NUMERIC, 1) *
           COALESCE((item->>'unit_price')::NUMERIC, 0)
         ), 0)
  INTO v_total
  FROM jsonb_array_elements(p_items) AS item;

  v_number := public.next_invoice_number(v_owner);

  INSERT INTO public.invoices (
    owner_user_id, customer_id, invoice_number, currency, total, status, due_at
  )
  VALUES (
    v_owner, p_customer_id, v_number,
    COALESCE(NULLIF(p_currency, ''), 'USD'), v_total, 'Draft', p_due_at
  )
  RETURNING id INTO v_invoice_id;

  INSERT INTO public.invoice_items (
    invoice_id, description, quantity, unit_price, line_total
  )
  SELECT
    v_invoice_id,
    COALESCE(NULLIF(TRIM(item->>'description'), ''), 'Item'),
    COALESCE((item->>'quantity')::NUMERIC, 1),
    COALESCE((item->>'unit_price')::NUMERIC, 0),
    COALESCE((item->>'quantity')::NUMERIC, 1) * COALESCE((item->>'unit_price')::NUMERIC, 0)
  FROM jsonb_array_elements(p_items) AS item;

  RETURN v_invoice_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_invoice(UUID, JSONB, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_invoice(UUID, JSONB, TEXT, TIMESTAMPTZ) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Atomic item replacement (delete + insert + total update in one transaction)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.replace_invoice_items(
  p_invoice_id UUID,
  p_items JSONB
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_owner UUID := auth.uid();
  v_total NUMERIC(18,2) := 0;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.id = p_invoice_id AND i.owner_user_id = v_owner
  ) THEN
    RAISE EXCEPTION 'Invoice not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one invoice item is required' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(SUM(
           COALESCE((item->>'quantity')::NUMERIC, 1) *
           COALESCE((item->>'unit_price')::NUMERIC, 0)
         ), 0)
  INTO v_total
  FROM jsonb_array_elements(p_items) AS item;

  DELETE FROM public.invoice_items WHERE invoice_id = p_invoice_id;

  INSERT INTO public.invoice_items (
    invoice_id, description, quantity, unit_price, line_total
  )
  SELECT
    p_invoice_id,
    COALESCE(NULLIF(TRIM(item->>'description'), ''), 'Item'),
    COALESCE((item->>'quantity')::NUMERIC, 1),
    COALESCE((item->>'unit_price')::NUMERIC, 0),
    COALESCE((item->>'quantity')::NUMERIC, 1) * COALESCE((item->>'unit_price')::NUMERIC, 0)
  FROM jsonb_array_elements(p_items) AS item;

  UPDATE public.invoices
  SET total = v_total, updated_at = NOW()
  WHERE id = p_invoice_id;

  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_invoice_items(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_invoice_items(UUID, JSONB) TO authenticated, service_role;
