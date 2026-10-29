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

Migration 002 adds atomic invoice RPCs, race-free invoice numbering, the
hashed public pay-link index and the missing RLS policies.

## Required environment variables

See `.env.example`. In addition to the Supabase keys, set
`INVOICE_TOKEN_SECRET` to a random value of at least 32 characters
(`openssl rand -hex 32`). It signs public invoice links — rotating it
invalidates every existing pay link.

## Checks

```bash
npm run check   # lint + typecheck + build
```
