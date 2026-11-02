# Implementation plan — Pharmacy chain online reordering

Problem 3 of the assignment brief. All data in this repository is synthetic demo data.

## Phase 1 — repository audit (done)

- Workspace was empty: no code, no git history, no environment config. Nothing to preserve.
- Toolchain available: Node 22, npm 10, Docker (daemon running), PostgreSQL 16 client, GitHub CLI.
- Git author configured repo-locally (no global `user.name` existed).
- Risks: OCR of handwritten prescriptions is unreliable locally; Playwright browsers and the
  Tesseract language model must be downloaded once; no external AI key is configured.

## Stack decision

Next.js 15 (App Router) + TypeScript, Tailwind CSS 4, PostgreSQL 16 (Docker Compose) via
Prisma 6, Zod 4 validation, Vitest (unit + DB integration) and Playwright (browser).
Single deployable web app; domain logic in `src/server/**` services that take an explicit
actor so access control is enforced and testable outside the UI.

## Core screens

| # | Route | Role |
|---|-------|------|
| A | `/` customer home: patient selector, reorder CTA, active orders, refill reminders | customer |
| B | `/medicines` catalogue search with schedule badges and stock availability | customer |
| C | `/cart` items, quantities, prescription requirement, totals | customer |
| D | `/checkout` prescription upload + AI draft, delivery area, test payment, submit | customer |
| E | `/orders/[id]` tracking timeline, pharmacist decision, re-upload, generic consent, refill opt-in | customer |
| F | `/pharmacist` verification queue | pharmacist |
| G | `/pharmacist/orders/[id]` side-by-side review, per-item decisions, H1 register, audit | pharmacist |
| H | `/store`, `/ops`, `/ops/stock`, `/ops/policies` store queue, dashboard, CSV import | store staff / ops |

## Checklist

- [x] Phase 1 audit and plan
- [x] Phase 2 foundation: config, Docker DB, Prisma schema + migrations, seed, OTP auth, design tokens
- [x] Phase 3 domain: policy rules, state machine, dispatch gate, routing, refill maths + invariant tests
- [x] Phase 4 customer journey
- [x] Phase 5 pharmacist workflow
- [x] Phase 6 stock import, routing, store/ops views
- [x] Phase 7 polish, full test run, secret scan
- [x] Phase 8 TDD (`docs/TDD.md` → PDF), `deployment.md`, submission ZIP (`npm run submission:build`), GitHub publish

## Outcome

- Vitest: 155 passed (104 unit, 51 PostgreSQL integration). Playwright: 5 passed.
- Verified from a fresh clone of the public repository (install, migrate, seed, build, browser journey, all suites).
