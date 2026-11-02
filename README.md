# Pharmacy reordering with pharmacist verification (prototype)

A working prototype for a Kolkata pharmacy chain ("Company A", from the assignment brief). Regular customers reorder monthly medicines for themselves or a family member, upload a prescription, and receive same-day delivery from the nearest store that has everything in stock. A registered pharmacist checks every prescription item before anything can be packed, and customers get refill reminders before they run out.

> **Synthetic data only.** Every person, phone number, clinic, prescription and order is fictional. Payments, SMS and WhatsApp are test-mode mocks. This is not a production or legally reviewed system.

- **Run it locally:** see [deployment.md](deployment.md). Demo OTP `246810`; demo accounts are listed on the login page.
- **Design and decisions:** [docs/TDD.md](docs/TDD.md) (also exported to PDF for the submission).
- **Implementation checklist:** [docs/implementation-plan.md](docs/implementation-plan.md)

## What’s inside

| Area | Screens |
|---|---|
| Customer (mobile-first) | OTP login, family/patient selector, home with one-tap reorder + refill reminders, medicine search, cart, checkout with prescription upload and AI draft, order tracking with re-upload and generic-substitution consent |
| Pharmacist | Verification queue, side-by-side prescription review with confidence, per-item approve / generic alternative / reject, H1 register capture, audit trail |
| Store | Pick → pack (store invoice no.) → hand over → delivered, with dispatch-gate explanations |
| Operations | Dashboard (orders by store, median verification time, rejections, no-stock), stock CSV import with preview, versioned medicine rules |

## Stack

Next.js 15 (App Router, TypeScript) · Tailwind CSS 4 · PostgreSQL 16 via Prisma 6 · Zod · tesseract.js (local OCR) · optional Claude vision adapter (`@anthropic-ai/sdk`, off by default) · Vitest · Playwright.

```
src/server/domain/      pure rules: policy, order state machine, approval/dispatch gates, routing, refill maths, CSV
src/server/services/    use cases with role/ownership checks and transactions
src/server/extraction/  provider interface, OCR parser, catalogue matcher, pipeline (timeouts, thresholds)
src/app/                pages, server actions and two route handlers (upload, private file stream)
prisma/                 schema, migrations (incl. CHECK constraints + append-only audit trigger), seed
tests/                  unit, DB integration, Playwright e2e
fixtures/               synthetic prescriptions and stock CSVs
```

## Quick start

```bash
npm ci && npm run setup:env && npm run db:up && npm run db:migrate && npm run db:seed && npm run dev
```

## Tests

```bash
npm test            # Vitest: unit + integration (needs the Docker DB)
npm run test:e2e    # Playwright (run `npx playwright install chromium` once)
```
