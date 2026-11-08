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
4. `supabase/migrations/004_refunds_notifications.sql`
5. `supabase/migrations/005_function_grants.sql`

Migration 002 adds atomic invoice RPCs, race-free invoice numbering, the
hashed public pay-link index and the missing RLS policies. Migration 003 adds
the ledger `Payment` source type and the atomic `record_payment_capture` RPC
used by PayPal captures and webhooks. Migration 004 adds refunds
(`payment_refunds`), in-app notifications, the ledger `Refund` source type, and
the atomic `apply_payment_refund` RPC. Migration 005 removes Supabase's
default `EXECUTE` grants from `anon`/`authenticated` on the money RPCs and
future functions — without it, PostgREST would let anonymous callers invoke
`record_payment_capture` and `apply_payment_refund` directly.

## PayPal setup

Set `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_ENVIRONMENT`
(`sandbox` or `live`) and `NEXT_PUBLIC_PAYPAL_CLIENT_ID` (the same public
client id). Checkout is enabled for **USD, EUR and GBP** invoices; other
currencies show a "contact the sender" fallback.

Create a webhook in the PayPal dashboard pointing at:

```
${NEXT_PUBLIC_APP_URL}/api/webhooks/paypal
```

Subscribe to `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.REFUNDED` and
`PAYMENT.CAPTURE.REVERSED` (optionally `PAYMENT.CAPTURE.DENIED` and
`PAYMENT.CAPTURE.PENDING`; other event types are stored and acknowledged, but
ignored). Copy the webhook id into
`PAYPAL_WEBHOOK_ID`. Webhook signatures are verified with PayPal before
anything is applied, and every delivery is stored in `webhook_events` so
retries are idempotent.

How a payment flows:

1. `POST /api/pay/[token]/order` re-reads the invoice, computes the remaining
   balance, and creates (or reuses) a PayPal order.
2. `POST /api/pay/[token]/capture` captures that order, re-checks the amount
   and currency against the database, then calls `record_payment_capture`.
3. The RPC writes the capture, the ledger entry, and the invoice status
   (`Paid` / `PartiallyPaid`) in one transaction.

Partial payments are supported. Captures are recorded once per PayPal capture
id, so a repeated approval, webhook retry or duplicate callback is harmless.

If PayPal reports an order already captured (double click, retried capture,
webhook race), the capture route re-reads the order and reconciles instead of
failing the payer. If the database write fails after the money has moved, the
route returns `202 pending_reconciliation` and the webhook finishes the record.

## Refunds, receipts and notifications

Owners can refund a captured payment (fully or partially) from **Payments**.
`POST /api/refunds` asks PayPal for the refund first, then calls the atomic
`apply_payment_refund` RPC. Refund ids are unique at PayPal, so retries and
duplicate webhook deliveries never refund or record twice. Migration 004 also
handles `PAYMENT.CAPTURE.REFUNDED` webhooks, so refunds issued from the PayPal
dashboard are recorded automatically.

Refunds never rewrite the original capture. Balances are computed net of
completed refunds: a fully refunded invoice returns to `Published` (payable
again), while partial refunds keep `PartiallyPaid`/`Overdue`. Refund ledger
entries use `source_type = 'Refund'` with `direction = 'Expense'`.

Each completed payment or refund also creates an in-app notification for the
owner. The dashboard bell (`GET/POST /api/notifications`) shows the latest 20
with an unread count and can mark one or all as read. Notifications are created
inside the money RPCs and deduped with the ledger write, so replays never
duplicate them.

Customers can open a read-only receipt at `/pay/[token]/receipt` — the same
hashed token as the pay link — showing completed payments, refunds, net paid
and the remaining balance. Receipt links appear on the public invoice page and
after a successful checkout.

## Emailing invoices

Set `INVOICE_EMAIL_FROM` to a sender verified with one provider and the matching
API key:

| Provider | Key | Sender verification |
|---|---|---|
| Brevo | `BREVO_API_KEY` | Verify a single email address in **Senders** — no DNS needed |
| Resend | `RESEND_API_KEY` | `onboarding@resend.dev` only reaches the account owner; other recipients need a verified domain |

`EMAIL_PROVIDER=brevo|resend` selects one explicitly. When unset, the provider
with a key is used (Brevo wins if both are set).

The **Email Invoice** button then re-reads the invoice on the server, requires a
customer email address, and sends the public pay link plus the outstanding
balance and line items. The link is derived from the invoice id and
`INVOICE_TOKEN_SECRET`; the browser never supplies a URL or amount. The owner's
email is used as `Reply-To`.

Invoices must be published first, and invoices already paid in full are not
re-sent. If the provider rejects the message the API returns the provider's
reason.

### Verifying delivery

A `2xx` response only means the provider accepted the message, not that it was
delivered. Brevo in particular answers `201` even when the sender is not
verified; the real outcome appears in its transactional log
(`GET /v3/smtp/statistics/events` or **Transactional → Logs**). A transactional
key with only "Send transactional email" cannot list senders, so confirm the
sender status in **Senders** and check the event stream for `delivered`.
Recipient-side spam filtering is outside the provider's control — sending from a
verified domain instead of a free mailbox improves placement.

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
invalidates every existing pay link. Set `BREVO_API_KEY` or `RESEND_API_KEY`
plus `INVOICE_EMAIL_FROM` to enable emailing invoices; without them the button
returns a clear "not configured" error.

## Deploying

Deploy to Vercel (or any Node host), then set every variable from
`.env.example` in the project's environment settings. Never commit `.env.local`.

1. Apply migrations `001`–`005` to the production Supabase project.
2. Set `NEXT_PUBLIC_APP_URL` to the deployed origin (for example
   `https://kivunra.vercel.app`). Public pay links and invoice emails use it.
3. Use `PAYPAL_ENVIRONMENT=live` with a live app's client id/secret for real
   payments, or keep `sandbox` for a demo.
4. Create the PayPal webhook against
   `${NEXT_PUBLIC_APP_URL}/api/webhooks/paypal` and store its id in
   `PAYPAL_WEBHOOK_ID`.

If a webhook already exists, update its URL instead of creating a second one:

```bash
curl -X PATCH "https://api-m.sandbox.paypal.com/v1/notifications/webhooks/$PAYPAL_WEBHOOK_ID" \
  -H "Authorization: Bearer $PAYPAL_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '[{"op":"replace","path":"/url","value":"https://your-app.vercel.app/api/webhooks/paypal"}]'
```

Quick tunnels from `cloudflared` get a new hostname each time they restart, so
they are for local testing only — repoint the webhook after every restart.

## Checks

```bash
npm run check   # lint + typecheck + build
```
