-- Kivunra migration 003: PayPal payments
--
-- 1. Allow ledger entries sourced from a payment capture
-- 2. Record a capture atomically: payment order, capture, ledger entry and
--    invoice status (Paid / PartiallyPaid) all move together.
--
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Ledger source type
-- ---------------------------------------------------------------------------

ALTER TABLE public.ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_source_type_check;
ALTER TABLE public.ledger_entries
  ADD CONSTRAINT ledger_entries_source_type_check
  CHECK (source_type IN ('Invoice', 'Expense', 'Manual', 'Payment'));

CREATE INDEX IF NOT EXISTS idx_payment_captures_order
  ON public.payment_captures (payment_order_id);

CREATE INDEX IF NOT EXISTS idx_payment_orders_status
  ON public.payment_orders (status);

-- ---------------------------------------------------------------------------
-- 2. Atomic capture recording
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
  v_captured NUMERIC(18,2) := 0;
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
      SELECT COALESCE(SUM(pc.amount), 0) INTO v_captured
      FROM public.payment_captures pc
      JOIN public.payment_orders po ON po.id = pc.payment_order_id
      WHERE po.invoice_id = p_invoice_id AND pc.status = 'COMPLETED';

      IF v_captured + p_amount > v_invoice.total + 0.01 THEN
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
    SELECT COALESCE(SUM(pc.amount), 0) INTO v_captured
    FROM public.payment_captures pc
    JOIN public.payment_orders po ON po.id = pc.payment_order_id
    WHERE po.invoice_id = p_invoice_id
      AND pc.status = 'COMPLETED'
      AND pc.id <> v_capture.id;

    IF v_captured + v_capture.amount > v_invoice.total + 0.01 THEN
      RAISE EXCEPTION 'Capture exceeds the remaining balance' USING ERRCODE = '22023';
    END IF;

    UPDATE public.payment_captures
    SET status = 'COMPLETED', captured_at = NOW()
    WHERE id = v_capture.id
    RETURNING * INTO v_capture;
  END IF;

  IF v_capture.status = 'COMPLETED' THEN
    INSERT INTO public.ledger_entries (
      owner_user_id, source_type, source_id, direction, amount, currency, posted_at
    )
    VALUES (
      v_invoice.owner_user_id, 'Payment', v_capture.id, 'Income',
      v_capture.amount, v_invoice.currency, NOW()
    )
    ON CONFLICT (source_type, source_id) DO NOTHING;
  END IF;

  IF p_status = 'COMPLETED' THEN
    UPDATE public.payment_orders
    SET status = 'Captured', updated_at = NOW()
    WHERE id = v_order.id;
  ELSIF p_status IN ('PENDING', 'CREATED') THEN
    UPDATE public.payment_orders
    SET status = 'CapturePending', updated_at = NOW()
    WHERE id = v_order.id;
  ELSE
    UPDATE public.payment_orders
    SET status = 'Failed', updated_at = NOW()
    WHERE id = v_order.id;
  END IF;

  SELECT COALESCE(SUM(pc.amount), 0) INTO v_captured
  FROM public.payment_captures pc
  JOIN public.payment_orders po ON po.id = pc.payment_order_id
  WHERE po.invoice_id = p_invoice_id AND pc.status = 'COMPLETED';

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
END;
$$;

REVOKE ALL ON FUNCTION public.record_payment_capture(UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_payment_capture(UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT) TO service_role;
