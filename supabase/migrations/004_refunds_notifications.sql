-- Kivunra migration 004: refunds, receipts support and notifications
--
-- 1. Ledger entries can be sourced from a refund
-- 2. payment_refunds table + RLS
-- 3. notifications table + RLS (in-app owner notifications)
-- 4. net_captured_amount helper (captures minus completed refunds)
-- 5. record_payment_capture: net-of-refunds accounting and payment notification
-- 6. apply_payment_refund: atomic refund recording
--
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Ledger source type
-- ---------------------------------------------------------------------------

ALTER TABLE public.ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_source_type_check;
ALTER TABLE public.ledger_entries
  ADD CONSTRAINT ledger_entries_source_type_check
  CHECK (source_type IN ('Invoice', 'Expense', 'Manual', 'Payment', 'Refund'));

-- ---------------------------------------------------------------------------
-- 2. Refunds
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.payment_refunds (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  payment_capture_id UUID REFERENCES public.payment_captures(id) ON DELETE CASCADE NOT NULL,
  paypal_refund_id TEXT UNIQUE NOT NULL,
  amount NUMERIC(18,2) NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'COMPLETED'
    CHECK (status IN ('COMPLETED', 'PENDING', 'CANCELLED', 'FAILED')),
  reason TEXT,
  refunded_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE public.payment_refunds ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_payment_refunds_capture
  ON public.payment_refunds (payment_capture_id);

DROP POLICY IF EXISTS "Users can view own refunds" ON public.payment_refunds;
CREATE POLICY "Users can view own refunds" ON public.payment_refunds
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.payment_captures pc
      JOIN public.payment_orders po ON po.id = pc.payment_order_id
      JOIN public.invoices i ON i.id = po.invoice_id
      WHERE pc.id = payment_refunds.payment_capture_id
        AND i.owner_user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 3. In-app notifications
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  owner_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('PaymentReceived', 'RefundProcessed')),
  title TEXT NOT NULL,
  body TEXT,
  source_type TEXT,
  source_id TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notifications_owner_recent
  ON public.notifications (owner_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_owner_unread
  ON public.notifications (owner_user_id)
  WHERE read_at IS NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own notifications" ON public.notifications;
CREATE POLICY "Users can view own notifications" ON public.notifications
  FOR SELECT USING (auth.uid() = owner_user_id);

-- Mark as read; rows are created by server code (SECURITY DEFINER RPCs).
DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;
CREATE POLICY "Users can update own notifications" ON public.notifications
  FOR UPDATE USING (auth.uid() = owner_user_id)
  WITH CHECK (auth.uid() = owner_user_id);

-- ---------------------------------------------------------------------------
-- 4. Money in the door, net of refunds
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.net_captured_amount(
  p_invoice_id UUID
)
RETURNS NUMERIC(18,2)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT (
           SELECT COALESCE(SUM(pc.amount), 0)
           FROM public.payment_captures pc
           JOIN public.payment_orders po ON po.id = pc.payment_order_id
           WHERE po.invoice_id = p_invoice_id
             AND pc.status = 'COMPLETED'
         )
         -
         (
           SELECT COALESCE(SUM(r.amount), 0)
           FROM public.payment_refunds r
           JOIN public.payment_captures rpc ON rpc.id = r.payment_capture_id
           JOIN public.payment_orders po ON po.id = rpc.payment_order_id
           WHERE po.invoice_id = p_invoice_id
             AND r.status = 'COMPLETED'
         )
$$;

REVOKE ALL ON FUNCTION public.net_captured_amount(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.net_captured_amount(UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Atomic capture recording (net of refunds, notifies once)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.record_payment_capture(
  p_invoice_id UUID,
  p_paypal_order_id TEXT,
  p_paypal_capture_id TEXT,
  p_amount NUMERIC,
  p_currency TEXT,
  p_status TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_order public.payment_orders%ROWTYPE;
  v_capture public.payment_captures%ROWTYPE;
  v_capture_exists BOOLEAN := FALSE;
  v_net NUMERIC(18,2) := 0;
  v_captured NUMERIC(18,2) := 0;
  v_ledger_id UUID;
  v_status TEXT;
BEGIN
  IF p_paypal_order_id IS NULL OR p_paypal_capture_id IS NULL THEN
    RAISE EXCEPTION 'Missing PayPal identifiers' USING ERRCODE = '22023';
  END IF;

  -- Serialize concurrent captures for the same invoice.
  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_invoice.status IN ('Draft', 'Cancelled') THEN
    RAISE EXCEPTION 'Invoice is not payable' USING ERRCODE = '22023';
  END IF;

  IF lower(v_invoice.currency) <> lower(p_currency) THEN
    RAISE EXCEPTION 'Currency mismatch' USING ERRCODE = '22023';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid capture amount' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_order
  FROM public.payment_orders
  WHERE paypal_order_id = p_paypal_order_id;

  IF NOT FOUND THEN
    INSERT INTO public.payment_orders (
      invoice_id, paypal_order_id, expected_amount, currency, status
    )
    VALUES (p_invoice_id, p_paypal_order_id, p_amount, v_invoice.currency, 'Created')
    ON CONFLICT (paypal_order_id) DO NOTHING
    RETURNING * INTO v_order;

    IF v_order.id IS NULL THEN
      SELECT * INTO v_order
      FROM public.payment_orders
      WHERE paypal_order_id = p_paypal_order_id;
    END IF;
  END IF;

  IF v_order.invoice_id <> p_invoice_id THEN
    RAISE EXCEPTION 'Order does not belong to this invoice' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_capture
  FROM public.payment_captures
  WHERE paypal_capture_id = p_paypal_capture_id;

  v_capture_exists := FOUND;

  IF v_capture_exists THEN
    -- A capture id is globally unique at PayPal. Never let one be attached
    -- to another order or silently accept different details.
    IF v_capture.payment_order_id <> v_order.id THEN
      RAISE EXCEPTION 'Capture does not belong to this order' USING ERRCODE = '22023';
    END IF;

    IF v_capture.amount <> p_amount OR lower(v_capture.currency) <> lower(p_currency) THEN
      RAISE EXCEPTION 'Capture details do not match' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF NOT v_capture_exists THEN
    IF p_status = 'COMPLETED' THEN
      -- Refunds reduce the outstanding balance a new capture may fill.
      SELECT public.net_captured_amount(p_invoice_id) INTO v_net;

      IF v_net + p_amount > v_invoice.total + 0.01 THEN
        RAISE EXCEPTION 'Capture exceeds the remaining balance' USING ERRCODE = '22023';
      END IF;
    END IF;

    INSERT INTO public.payment_captures (
      payment_order_id, paypal_capture_id, amount, currency, status
    )
    VALUES (v_order.id, p_paypal_capture_id, p_amount, p_currency, p_status)
    ON CONFLICT (paypal_capture_id) DO NOTHING
    RETURNING * INTO v_capture;

    IF v_capture.id IS NULL THEN
      SELECT * INTO v_capture
      FROM public.payment_captures
      WHERE paypal_capture_id = p_paypal_capture_id;

      IF v_capture.payment_order_id <> v_order.id THEN
        RAISE EXCEPTION 'Capture does not belong to this order' USING ERRCODE = '22023';
      END IF;
    END IF;
  ELSIF p_status = 'COMPLETED' AND v_capture.status <> 'COMPLETED' THEN
    -- A previously pending capture cleared. Check the balance again,
    -- excluding this capture's own (pending) row.
    SELECT COALESCE(SUM(pc.amount), 0) INTO v_net
    FROM public.payment_captures pc
    JOIN public.payment_orders po ON po.id = pc.payment_order_id
    WHERE po.invoice_id = p_invoice_id
      AND pc.status = 'COMPLETED'
      AND pc.id <> v_capture.id;

    SELECT COALESCE(SUM(r.amount), 0) INTO v_captured
    FROM public.payment_refunds r
    JOIN public.payment_captures pc2 ON pc2.id = r.payment_capture_id
    JOIN public.payment_orders po2 ON po2.id = pc2.payment_order_id
    WHERE po2.invoice_id = p_invoice_id
      AND r.status = 'COMPLETED'
      AND pc2.id <> v_capture.id;

    v_net := v_net - v_captured;

    IF v_net + v_capture.amount > v_invoice.total + 0.01 THEN
      RAISE EXCEPTION 'Capture exceeds the remaining balance' USING ERRCODE = '22023';
    END IF;

    UPDATE public.payment_captures
    SET status = 'COMPLETED', captured_at = NOW()
    WHERE id = v_capture.id
    RETURNING * INTO v_capture;
  END IF;

  IF v_capture.status = 'COMPLETED' THEN
    IF p_status = 'COMPLETED' THEN
      UPDATE public.payment_orders
      SET status = 'Captured', updated_at = NOW()
      WHERE id = v_order.id;
    END IF;

    INSERT INTO public.ledger_entries (
      owner_user_id, source_type, source_id, direction, amount, currency, posted_at
    )
    VALUES (
      v_invoice.owner_user_id, 'Payment', v_capture.id, 'Income',
      v_capture.amount, v_invoice.currency, NOW()
    )
    ON CONFLICT (source_type, source_id) DO NOTHING
    RETURNING id INTO v_ledger_id;

    -- Notify once: only the transaction that actually created the ledger row.
    IF v_ledger_id IS NOT NULL THEN
      INSERT INTO public.notifications (
        owner_user_id, type, title, body, source_type, source_id
      )
      VALUES (
        v_invoice.owner_user_id,
        'PaymentReceived',
        'Payment received',
        format(
          '%s %s received for invoice %s',
          to_char(v_capture.amount, 'FM9999999999990.00'),
          upper(v_invoice.currency),
          v_invoice.invoice_number
        ),
        'Invoice',
        p_invoice_id::TEXT
      );
    END IF;

    SELECT public.net_captured_amount(p_invoice_id) INTO v_captured;

    IF v_captured <= 0 THEN
      v_status := v_invoice.status;
    ELSIF v_captured + 0.01 >= v_invoice.total THEN
      v_status := 'Paid';
    ELSE
      v_status := 'PartiallyPaid';
    END IF;

    IF v_status <> v_invoice.status THEN
      UPDATE public.invoices
      SET status = v_status, updated_at = NOW()
      WHERE id = p_invoice_id;
    END IF;

    RETURN jsonb_build_object(
      'invoice_status', v_status,
      'captured', v_captured,
      'total', v_invoice.total,
      'fully_paid', v_captured + 0.01 >= v_invoice.total
    );
  END IF;

  IF p_status IN ('PENDING', 'CREATED') THEN
    UPDATE public.payment_orders
    SET status = 'CapturePending', updated_at = NOW()
    WHERE id = v_order.id;
  ELSE
    UPDATE public.payment_orders
    SET status = 'Failed', updated_at = NOW()
    WHERE id = v_order.id;
  END IF;

  RETURN jsonb_build_object(
    'invoice_status', v_invoice.status,
    'captured', public.net_captured_amount(p_invoice_id),
    'total', v_invoice.total,
    'fully_paid', FALSE
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_payment_capture(UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_payment_capture(UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Atomic refund recording
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.apply_payment_refund(
  p_paypal_capture_id TEXT,
  p_paypal_refund_id TEXT,
  p_amount NUMERIC,
  p_currency TEXT,
  p_status TEXT DEFAULT 'COMPLETED',
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_capture public.payment_captures%ROWTYPE;
  v_refund public.payment_refunds%ROWTYPE;
  v_refund_exists BOOLEAN := FALSE;
  v_refunded NUMERIC(18,2) := 0;
  v_net NUMERIC(18,2) := 0;
  v_ledger_id UUID;
  v_status TEXT;
BEGIN
  IF p_paypal_capture_id IS NULL OR p_paypal_refund_id IS NULL THEN
    RAISE EXCEPTION 'Missing PayPal identifiers' USING ERRCODE = '22023';
  END IF;

  IF p_status NOT IN ('COMPLETED', 'PENDING', 'CANCELLED', 'FAILED') THEN
    RAISE EXCEPTION 'Invalid refund status' USING ERRCODE = '22023';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid refund amount' USING ERRCODE = '22023';
  END IF;

  -- Resolve capture -> order -> invoice and lock the invoice for the recompute.
  SELECT i.* INTO v_invoice
  FROM public.payment_captures pc
  JOIN public.payment_orders po ON po.id = pc.payment_order_id
  JOIN public.invoices i ON i.id = po.invoice_id
  WHERE pc.paypal_capture_id = p_paypal_capture_id
  FOR UPDATE OF i;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Capture not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_capture
  FROM public.payment_captures
  WHERE paypal_capture_id = p_paypal_capture_id;

  IF lower(v_capture.currency) <> lower(p_currency) THEN
    RAISE EXCEPTION 'Currency mismatch' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_refund
  FROM public.payment_refunds
  WHERE paypal_refund_id = p_paypal_refund_id;

  v_refund_exists := FOUND;

  IF v_refund_exists THEN
    -- A refund id is globally unique at PayPal. Never re-attach one to a
    -- different capture or silently accept different details.
    IF v_refund.payment_capture_id <> v_capture.id THEN
      RAISE EXCEPTION 'Refund does not belong to this capture' USING ERRCODE = '22023';
    END IF;

    IF v_refund.amount <> p_amount OR lower(v_refund.currency) <> lower(p_currency) THEN
      RAISE EXCEPTION 'Refund details do not match' USING ERRCODE = '22023';
    END IF;

    IF p_status = 'COMPLETED' AND v_refund.status <> 'COMPLETED' THEN
      -- A previously pending refund cleared. Guard the balance once more,
      -- excluding this refund's own row.
      SELECT COALESCE(SUM(r.amount), 0) INTO v_refunded
      FROM public.payment_refunds r
      WHERE r.payment_capture_id = v_capture.id
        AND r.status = 'COMPLETED'
        AND r.id <> v_refund.id;

      IF v_refunded + p_amount > v_capture.amount + 0.01 THEN
        RAISE EXCEPTION 'Refund exceeds the captured amount' USING ERRCODE = '22023';
      END IF;

      UPDATE public.payment_refunds
      SET status = 'COMPLETED', refunded_at = NOW()
      WHERE id = v_refund.id
      RETURNING * INTO v_refund;
    END IF;
  ELSIF p_status IN ('COMPLETED', 'PENDING') THEN
    SELECT COALESCE(SUM(r.amount), 0) INTO v_refunded
    FROM public.payment_refunds r
    WHERE r.payment_capture_id = v_capture.id
      AND r.status = 'COMPLETED';

    IF v_refunded + p_amount > v_capture.amount + 0.01 THEN
      RAISE EXCEPTION 'Refund exceeds the captured amount' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.payment_refunds (
      payment_capture_id, paypal_refund_id, amount, currency, status, reason
    )
    VALUES (
      v_capture.id, p_paypal_refund_id, p_amount, p_currency, p_status, p_reason
    )
    ON CONFLICT (paypal_refund_id) DO NOTHING
    RETURNING * INTO v_refund;

    IF v_refund.id IS NULL THEN
      SELECT * INTO v_refund
      FROM public.payment_refunds
      WHERE paypal_refund_id = p_paypal_refund_id;

      IF v_refund.payment_capture_id <> v_capture.id THEN
        RAISE EXCEPTION 'Refund does not belong to this capture' USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;

  IF v_refund.status = 'COMPLETED' THEN
    INSERT INTO public.ledger_entries (
      owner_user_id, source_type, source_id, direction, amount, currency, posted_at
    )
    VALUES (
      v_invoice.owner_user_id, 'Refund', v_refund.id, 'Expense',
      v_refund.amount, v_refund.currency, NOW()
    )
    ON CONFLICT (source_type, source_id) DO NOTHING
    RETURNING id INTO v_ledger_id;

    IF v_ledger_id IS NOT NULL THEN
      INSERT INTO public.notifications (
        owner_user_id, type, title, body, source_type, source_id
      )
      VALUES (
        v_invoice.owner_user_id,
        'RefundProcessed',
        'Refund processed',
        format(
          '%s %s refunded for invoice %s',
          to_char(v_refund.amount, 'FM9999999999990.00'),
          upper(v_invoice.currency),
          v_invoice.invoice_number
        ),
        'Invoice',
        v_invoice.id::TEXT
      );
    END IF;

    -- Recompute the invoice status from net money in (captures minus refunds).
    SELECT public.net_captured_amount(v_invoice.id) INTO v_net;

    IF v_net <= 0.01 THEN
      -- Fully refunded: payable again unless the invoice was closed out.
      IF v_invoice.status IN ('Paid', 'PartiallyPaid') THEN
        v_status := 'Published';
      ELSE
        v_status := v_invoice.status;
      END IF;
    ELSIF v_net + 0.01 >= v_invoice.total THEN
      v_status := 'Paid';
    ELSIF v_invoice.status = 'Overdue' THEN
      v_status := 'Overdue';
    ELSE
      v_status := 'PartiallyPaid';
    END IF;

    IF v_status <> v_invoice.status THEN
      UPDATE public.invoices
      SET status = v_status, updated_at = NOW()
      WHERE id = v_invoice.id;
    END IF;
  ELSE
    v_status := v_invoice.status;
  END IF;

  SELECT COALESCE(SUM(r.amount), 0) INTO v_refunded
  FROM public.payment_refunds r
  WHERE r.payment_capture_id = v_capture.id
    AND r.status = 'COMPLETED';

  RETURN jsonb_build_object(
    'invoice_status', v_status,
    'capture_fully_refunded', v_refunded + 0.01 >= v_capture.amount,
    'amount_due', GREATEST(0, v_invoice.total - public.net_captured_amount(v_invoice.id))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_payment_refund(TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_payment_refund(TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT) TO service_role;
