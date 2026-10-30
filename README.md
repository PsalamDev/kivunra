# Kivunra

**Move Smarter. Manage Better.**

AI-powered financial management and payment workflow application for freelancers, independent creators, and small businesses.

## Tech Stack
- Next.js 15 with TypeScript
- Tailwind CSS + shadcn/ui
- Supabase (PostgreSQL + Auth)
- Groq API for AI invoice drafting
- PayPal REST APIs (Sandbox)
- Recharts for visualizations
- Vercel for deployment

## Getting Started

1. Install dependencies
```bash
npm install
```

2. Copy environment variables
```bash
cp .env.example .env.local
```

3. Run development server
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser.

## Database setup

Apply the migrations in order (Supabase SQL editor or CLI):

1. `supabase/migrations/001_initial_schema.sql`
2. `supabase/migrations/002_invoice_hardening.sql`
3. `supabase/migrations/003_payments.sql`

Migration 002 adds atomic invoice RPCs, race-free invoice numbering, the
hashed public pay-link index and the missing RLS policies. Migration 003 adds
the ledger `Payment` source type and the atomic `record_payment_capture` RPC
used by PayPal captures and webhooks.

## PayPal setup

Set `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_ENVIRONMENT`
(`sandbox` or `live`) and `NEXT_PUBLIC_PAYPAL_CLIENT_ID` (the same public
client id). Checkout is enabled for **USD, EUR and GBP** invoices; other
currencies show a "contact the sender" fallback.

Create a webhook in the PayPal dashboard pointing at:

```
${NEXT_PUBLIC_APP_URL}/api/webhooks/paypal
```

Subscribe to `PAYMENT.CAPTURE.COMPLETED` (other event types are stored and
acknowledged, but ignored). Copy the webhook id into `PAYPAL_WEBHOOK_ID`.
Webhook signatures are verified with PayPal before anything is applied, and
every delivery is stored in `webhook_events` so retries are idempotent.

How a payment flows:

1. `POST /api/pay/[token]/order` re-reads the invoice, computes the remaining
   balance, and creates (or reuses) a PayPal order.
2. `POST /api/pay/[token]/capture` captures that order, re-checks the amount
   and currency against the database, then calls `record_payment_capture`.
3. The RPC writes the capture, the ledger entry, and the invoice status
   (`Paid` / `PartiallyPaid`) in one transaction.

Partial payments are supported. Captures are recorded once per PayPal capture
id, so a repeated approval, webhook retry or duplicate callback is harmless.

## AI invoice drafting

Set `GROQ_API_KEY` to enable the AI assistant on **Invoices → Create Invoice**.
The optional `GROQ_MODEL` overrides the default model
(`llama-3.3-70b-versatile`).

`POST /api/ai/invoice-draft` is authenticated and rate-limited to 20 drafts per
user per hour. It sends the request plus the user's customer names to Groq,
validates the JSON response with zod, matches the suggested customer to an
existing one, and returns line items, currency and due date for the form. It
never creates an invoice directly, and every attempt is recorded in
`ai_interactions` for audit and rate limiting.

## Required environment variables

See `.env.example`. In addition to the Supabase keys, set
`INVOICE_TOKEN_SECRET` to a random value of at least 32 characters
(`openssl rand -hex 32`). It signs public invoice links — rotating it
invalidates every existing pay link.

## Checks

```bash
npm run check   # lint + typecheck + build
```
