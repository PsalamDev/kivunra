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

## Accounts, journal name and confirmation codes

Signing up asks for a **journal name**, email and password. The journal name is
the business name shown as the issuer on invoices, receipts and the pay page; it
is stored on the auth user as `user_metadata.journal_name`, with `Kivunra` as
the fallback for accounts created before it existed.

With **Confirm email** enabled, Supabase emails a 6-digit code and a confirmation
link. `/verify` accepts the code (`supabase.auth.verifyOtp({ type: 'signup' })`)
and the link lands on `/auth/callback`; either one creates the session.
**Send a new code** calls `supabase.auth.resend()`.

Confirmation mail is sent by **Supabase Auth**, not by the app's transactional
provider, so two separate things must be set up:

1. **Authentication → Emails → SMTP Settings** — point Supabase at Brevo
   (`smtp-relay.brevo.com`, port `587`, the SMTP login and `xsmtpsib-…` key from
   Brevo's SMTP page, sender `abdulsalambabalola225@gmail.com`). This removes the
   built-in mailer's strict rate limit; Brevo's free plan allows 300 messages a
   day. Supabase's own **Authentication → Rate Limits** still apply (30 emails
   per hour by default).
2. **Authentication → Emails → Confirm signup** — include the code in the
   template. The default template only has a link, so keep both:

   ```html
   <h2>Confirm your Kivunra account</h2>
   <p>Enter this code in the app:</p>
   <p style="font-size: 28px; letter-spacing: 6px; font-weight: bold">{{ .Token }}</p>
   <p>Or click to confirm:</p>
   <p><a href="{{ .ConfirmationURL }}">Confirm my email</a></p>
   ```

   `{{ .Token }}` is the code; **Authentication → Providers → Email → Email OTP
   Length** must be `6` to match this form. `{{ .ConfirmationURL }}` already carries
   the `emailRedirectTo` the app passes at signup.

**Authentication → URL Configuration** must allow the deployment, otherwise the
link falls back to the Site URL:

- Site URL: `https://kivunra.vercel.app`
- Redirect URLs: `https://kivunra.vercel.app/**`, `http://localhost:3000/**`

### Settings and password recovery

`/settings` is the account screen. It lets a signed-in user:

- rename the **journal** (the same `user_metadata.journal_name` used as the
  invoice issuer, so the change shows up on existing public invoices too), and
- change their password, which first re-checks the current password with
  `signInWithPassword` before calling `updateUser`.

The email address is read-only there; changing it needs an admin.

Password recovery starts at `/forgot-password` and calls
`supabase.auth.resetPasswordForEmail()` with
`redirectTo=<origin>/auth/callback?next=/reset-password`. Supabase sends the
recovery mail through its Auth SMTP settings (Brevo here), and `/auth/callback`
exchanges the link for a session before `/reset-password` renders the form. The
reply is intentionally identical for unknown addresses so the form cannot be
used to discover registered emails. Recovery links are single-use and expire
(one hour by default); opening `/reset-password` without a session shows the
"expired or already used" state. The **Authentication → Emails → Reset password**
template must keep `{{ .ConfirmationURL }}` for the link to come back to
`/auth/callback`.

### Why "Resend" is not the Resend service

`supabase.auth.resend()` is a Supabase SDK method that asks Supabase to issue a
new confirmation message. It is unrelated to [Resend](https://resend.com) the
email provider, costs nothing, and is delivered through whatever SMTP Supabase
is configured with — Brevo in this deployment.

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

Invoices must be published first. The **Email Invoice** button is hidden once an
invoice is paid or cancelled, and the API refuses to re-send a paid invoice even
if it is called directly. If the provider rejects the message the API returns the
provider's reason.

A customer created without an email can be given one later with **Edit** in the
customer list; the next invoice email picks it up immediately.

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
(`openai/gpt-oss-120b`, a free-plan production model).

Paste a short request, a client email, a project brief or a contract excerpt (up
to 6000 characters). The assistant extracts the client, line items, currency,
payment terms and a short payment note, then fills the editable form. It also
returns a list of assumptions whenever it had to infer something, so the draft
can be checked before saving. `Regenerate` re-runs the same source text.

`POST /api/ai/invoice-draft` is authenticated and rate-limited to 20 drafts per
user per hour. It sends the source text plus the user's customer names to Groq,
validates the JSON response with zod, matches the suggested customer to an
existing one, and never creates an invoice directly. Every attempt is recorded
in `ai_interactions` for audit and rate limiting.

## Zapier: email to draft invoice

**Settings → Automation (Zapier)** generates an API key. The key is shown once
and stored only as a SHA-256 hash in the owner's Supabase user metadata, so no
database migration is required. Revoke or rotate it from the same card at any
time; rotating invalidates the previous key immediately.

In Zapier, create a Zap:

1. **Trigger:** Gmail (or Outlook) → *New Email Matching Search*, for example
   `to:invoices@yourdomain.com`.
2. **Action:** Webhooks by Zapier → *POST*.
   - URL: `https://your-app.vercel.app/api/automation/invoice-draft`
   - Payload type: `json`
   - Headers: `Authorization: Bearer <your key>`
   - Data:
     - `text` → the email body (plain text)
     - `subject` → the email subject
     - `from_email` → the sender address
     - `external_id` → the message id (prevents duplicate drafts on retries)
     - `create_customer` → `true` to add unknown senders to your customer list
3. Test the action, then review the new **Draft** invoice in Kivunra.

The endpoint is rate-limited to 30 drafts per hour. It matches an existing
customer by sender email before asking the model, returns the invoice number,
link and line items, and never publishes or emails anything — publishing stays
a human decision. To extract a draft without creating it, send
`"create_invoice": false`.

```bash
curl -X POST "https://your-app.vercel.app/api/automation/invoice-draft" \
  -H "Authorization: Bearer $KIVUNRA_AUTOMATION_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Please invoice Acme Studio for the 5-page website redesign, $2,400, Net 14.",
    "subject": "Website redesign",
    "from_email": "sarah@acmestudio.com",
    "external_id": "gmail-message-id",
    "create_customer": true
  }'
```

## Billing calendar

`/calendar` plots invoice due dates and completed PayPal captures on a
[Bryntum Calendar](https://bryntum.com/products/calendar/) Community-tier
widget. The Community tier is MIT-licensed and needs no key or license file.

- Due dates are colored by invoice status: blue **Published**, amber
  **Partially paid**, red **Overdue**, green **Paid**, gray **Draft** and
  **Cancelled**.
- Completed PayPal captures appear in teal on the day the payment was recorded.
- Clicking an event opens that invoice.

The view is read-only: dragging, resizing, event editing and context menus are
disabled. Bryntum is loaded only in the browser and only on this route, so the
rest of the app does not download its bundle. The calendar reads existing
invoices and payment captures, so no database migration is required.

## Invoice lifecycle

Draft and unpaid invoices can be edited from the invoice page: customer, line
items and due date. The currency and invoice number never change. Publishing
happens from the same page and issues the public pay link.

The API enforces the money rules:

- An invoice with captured payments (net of completed refunds) can still be
  cancelled or deleted only after those payments are refunded.
- `Paid` and `Cancelled` invoices cannot be edited, and `Paid` invoices cannot
  be deleted.
- `Draft → Published` is a one-way transition; nothing sets `Paid` manually.

Open invoices (`Published`, `PartiallyPaid`) whose due date is before today
(UTC) are flipped to `Overdue` whenever the dashboard, invoice list or invoice
detail loads. A Vercel Cron job (`/api/cron/mark-overdue`, daily at 02:00 UTC)
covers accounts that are not browsing the app. Vercel sends
`Authorization: Bearer $CRON_SECRET`, so set `CRON_SECRET` in the deployment;
without it the route returns `503`.

## Required environment variables

See `.env.example`. In addition to the Supabase keys, set
`INVOICE_TOKEN_SECRET` to a random value of at least 32 characters
(`openssl rand -hex 32`). It signs public invoice links — rotating it
invalidates every existing pay link. Set `BREVO_API_KEY` or `RESEND_API_KEY`
plus `INVOICE_EMAIL_FROM` to enable emailing invoices; without them the button
returns a clear "not configured" error. Set `CRON_SECRET` to a random value so
the daily overdue sweep can authenticate.

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
5. Set `CRON_SECRET`. `vercel.json` registers the daily overdue sweep; Vercel
   sends it as a Bearer token automatically.

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
