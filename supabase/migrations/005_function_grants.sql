-- Kivunra migration 005: tighten RPC execution grants
--
-- Supabase ships with ALTER DEFAULT PRIVILEGES that grant EXECUTE on new
-- functions in `public` to anon, authenticated and service_role. Revoking
-- from PUBLIC alone (as migrations 002-004 do) does not remove those explicit
-- grants, so anonymous callers could still invoke the SECURITY DEFINER money
-- RPCs through PostgREST.
--
-- This migration removes those grants explicitly and flips the defaults so a
-- future function cannot inherit them by accident.
--
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Service-role-only functions
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.record_payment_capture(UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_payment_refund(TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.net_captured_amount(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_updated_at_column()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.record_payment_capture(UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_payment_refund(TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.net_captured_amount(UUID)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Signed-in-only functions
--
-- These are SECURITY INVOKER and check auth.uid() internally, but anonymous
-- callers have no business reaching them.
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.create_invoice(UUID, JSONB, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.replace_invoice_items(UUID, JSONB)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.next_invoice_number(UUID)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_invoice(UUID, JSONB, TEXT, TIMESTAMPTZ)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.replace_invoice_items(UUID, JSONB)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.next_invoice_number(UUID)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Do not inherit Supabase's permissive defaults for future functions.
--
-- New RPCs must be granted to a role explicitly; anything that forgets stays
-- unreachable from the Data API.
-- ---------------------------------------------------------------------------

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
