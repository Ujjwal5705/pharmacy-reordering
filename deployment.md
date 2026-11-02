# Deployment and reviewer guide

**Project:** Pharmacy chain online reordering with pharmacist prescription checks (prototype)
**Repository:** https://github.com/Ujjwal5705/pharmacy-reordering
**Deployment status:** **local / demo only.** No hosted deployment was made, so there is no live URL. Everything below runs on your machine with synthetic data.

> All people, phone numbers, clinics, prescriptions and orders in this project are fictional. Payments and SMS/WhatsApp messages are test-mode mocks; nothing is charged or sent.

---

## 1. Prerequisites

| Tool | Version used | Notes |
|---|---|---|
| Node.js | 22.x (tested on 22.17.0) | Node ≥ 22.9 is required (`--env-file-if-exists`). |
| npm | 10.x | Comes with Node 22. |
| Docker Desktop / Docker Engine | Compose v2 (`docker compose`) | Runs PostgreSQL 16 in a container. |
| Free ports | 3000 (app), 5433 (Postgres), 3100 (browser tests only) | |
| Internet | Only for `npm ci`, the Postgres image and (optionally) Playwright’s Chromium download | The OCR model ships inside `node_modules`. The app needs no external service at runtime. |

## 2. Local setup from a fresh clone

```bash
git clone https://github.com/Ujjwal5705/pharmacy-reordering.git
cd pharmacy-reordering

npm ci                 # install dependencies (also runs `prisma generate`)
npm run setup:env      # creates .env from .env.example and generates a local encryption key
npm run db:up          # starts PostgreSQL 16 in Docker and waits until it is healthy
npm run db:migrate     # applies all migrations (schema, CHECK constraints, audit trigger)
npm run db:seed        # loads the synthetic demo data and encrypts the demo prescriptions
npm run dev            # http://localhost:3000
```

Open http://localhost:3000 and sign in with a demo account (section 5).

To run a production build instead of the dev server:

```bash
npm run build
npm start              # http://localhost:3000 (still uses APP_ENV=demo from .env)
```

**What `setup:env` does:** copies `.env.example` to `.env` (never overwrites an existing `.env`), writes a freshly generated random `PRESCRIPTION_ENCRYPTION_KEY` and sets the demo OTP. `.env` is git-ignored. If you delete `.env` and regenerate it, the key changes, so run `npm run db:seed` again; files encrypted with the old key cannot be read.

**Stopping:** press Ctrl+C for the app. `npm run db:down` stops the database and keeps its data volume.

## 3. How the app is deployed

It isn’t: this submission is a local prototype. To host it you would need a Node.js server (`npm run build && npm start`), a managed PostgreSQL database, private persistent storage for `PRIVATE_STORAGE_DIR`, a secrets manager for the encryption key, `APP_ENV=production` (which disables the demo OTP) and a real SMS provider behind the notification adapter. None of these have been set up or tested. Do not deploy it with real patient data.

## 4. Environment variables (names only)

Values live in `.env`, which is generated locally and never committed. The names are:

| Name | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string for the app and the seed script. |
| `TEST_DATABASE_URL` | Separate database for automated tests (`pharmacy_test`). |
| `APP_ENV` | `demo`, `test` or `production`. Defaults to `production` (demo OTP off) when unset. |
| `APP_BASE_URL` | Base URL of the app. Informational. |
| `AUTH_DEMO_OTP` | Fixed demo OTP. Only honoured when `APP_ENV` is `demo` or `test`; startup fails if it is set with `APP_ENV=production`. |
| `SESSION_TTL_HOURS` | Session lifetime. |
| `PRESCRIPTION_ENCRYPTION_KEY` | Secret. Base64-encoded 32-byte key for AES-256-GCM encryption of prescription files. |
| `PRESCRIPTION_ENCRYPTION_KEY_ID` | Label stored with each file to support key rotation. |
| `PRIVATE_STORAGE_DIR` | Private directory for encrypted prescription files (not web-served). |
| `UPLOAD_MAX_BYTES` | Maximum prescription upload size. |
| `EXTRACTION_PROVIDER` | `local-ocr` (default), `anthropic`, `fixture` (tests) or `none`. |
| `EXTRACTION_TIMEOUT_MS` | Timeout for one extraction run. |
| `EXTRACTION_MIN_FIELD_CONFIDENCE` | Per-field confidence threshold (prototype assumption). |
| `EXTRACTION_MIN_OVERALL_CONFIDENCE` | Whole-prescription confidence threshold. |
| `EXTRACTION_MIN_MATCH_SCORE` | Minimum catalogue-match score. |
| `ALLOW_EXTERNAL_PRESCRIPTION_PROCESSING` | Must be `true` before any prescription is sent to an external AI provider. |
| `ANTHROPIC_API_KEY` | Secret. Only needed for the optional Claude vision adapter. |
| `ANTHROPIC_MODEL` | Optional model override for the Claude adapter. |
| `REFILL_REMIND_DAYS_BEFORE` | Days before the estimated run-out date to show a reminder. |

The default extraction provider is local Tesseract OCR. Prescriptions never leave the machine unless you explicitly set both `EXTRACTION_PROVIDER=anthropic` and `ALLOW_EXTERNAL_PRESCRIPTION_PROCESSING=true` and supply a key.

## 5. Reviewer demo login (synthetic accounts)

Sign-in is phone number + one-time code. In local demo mode the code is always **`246810`**. This works only while `APP_ENV=demo` and is refused in production. The login page also lists these accounts; tap one to fill in the number.

| Mobile number | Account (fictional) | Role |
|---|---|---|
| `5550000001` | Debasish Ghosh — orders for himself and his mother Sunita Ghosh | Customer |
| `5550000002` | Rina Sen — order RX-50214 awaiting pharmacist | Customer |
| `5550000003` | Arif Mondal — order RX-50219 on hold for re-upload | Customer |
| `5550000004` | Priya Das — use for the Schedule H1 demo | Customer |
| `5550000101` | Ananya Roy — registered pharmacist, all stores | Pharmacist |
| `5550000102` | Sourav Dutta — registered pharmacist, Salt Lake store only | Pharmacist |
| `5550000201` | Salt Lake store desk | Store staff |
| `5550000202` | Behala store desk | Store staff |
| `5550000203` | Howrah Maidan store desk | Store staff |
| `5550000301` | Central operations desk | Operations |

(Numbers starting with 555 are not allocated to Indian mobiles, so they cannot reach a real person.)

Synthetic prescription images to upload are in [`fixtures/prescriptions/`](fixtures/prescriptions/):

| File | Use it to see |
|---|---|
| `rx-sunita-ghosh.png` | A clear prescription: metformin with dosage, levothyroxine "as directed" (no dose). |
| `rx-rina-sen.png` / `rx-rina-sen.pdf` | Clear telmisartan prescription. The PDF goes to manual reading (local OCR reads images only). |
| `rx-debasish-ghosh.png` | Telmisartan + amlodipine. |
| `rx-priya-das-h1.png` | Fictional Schedule H1 item (“Cefdinova 300 mg”), which needs the H1 register. |
| `rx-arif-mondal-blurred.png` | Blurred handwriting-style photo, which triggers the re-upload request. |

## 6. How to test the main journeys

Use two browser windows (or one normal and one private) so a customer and a pharmacist can be signed in at the same time.

**A. Customer reorder with a prescription (phone-sized window works best)**
1. Sign in as `5550000001`. Under **Ordering for**, choose **Sunita Ghosh · Mother**.
2. Go to **Medicines**, search `metformin`, and press **Add to cart** on *Metformin 500 mg* (generic). In **Cart**, raise the quantity to 4.
3. Press **Continue to checkout**, then **Upload prescription** and choose `fixtures/prescriptions/rx-sunita-ghosh.png`. Upload progress is shown, then the automated draft with confidence badges. The cart line is marked *On the prescription (draft)*.
4. The delivery area defaults to Salt Lake, and the nearest store with stock is shown. Choose **UPI (test)** or **Cash on delivery (test)** and press **Place order**.
5. The order page shows *Awaiting pharmacist* and a progress timeline.

**B. Pharmacist verification**
1. Sign in as `5550000101`. The **Verification queue** lists the new order and RX-50214 (oldest first, with a waiting time).
2. Press **Review**. The original prescription (zoom and rotate) sits beside the verified fields, pre-filled from the draft with confidence, and the item decisions.
3. Check the prescriber and date, choose **Approve**, keep *Units per day* = 2, and press **Record decisions**.
4. Optional: open RX-50214 and try **Reject item** (a reason is required) or **Request re-upload**.

**C. Store fulfilment**
1. Sign in as `5550000201` (Salt Lake). The approved order is under **Ready to pick**.
2. Press **Start picking**, enter a store invoice number, then **Mark packed**. Enter who collected the order, press **Hand over to delivery**, then **Mark delivered**.
3. Orders still waiting for a pharmacist are listed separately and cannot be picked.

**D. Refill reminder and one-tap reorder**
1. As the customer, open the delivered order. The refill section shows *60 units ÷ 2 a day ≈ 30 days* and the run-out date. Tick **Remind me before this runs out**.
2. On **Home** for *Debasish Ghosh · Myself*, the seeded telmisartan reminder is due: press **Reorder**. This fills the cart only; nothing is ordered until you check out.
3. For *Sunita Ghosh*, the levothyroxine reminder explains that no date can be estimated because no daily dose was confirmed.

**E. Safety checks to try**
- Search `xelorex` or `narcodem` (fictional Schedule X / narcotic items): they are shown as *Not sold online* with no add button.
- Generic alternative: as Debasish (mother selected), order **Glucofine 500** (fictional brand) using the prescription on file. As the pharmacist, choose **Generic alternative** → *Metformin 500 mg (generic)*. The customer then sees **Your consent is needed** and must answer before anything changes.
- Re-upload: sign in as Arif (`5550000003`) and open RX-50219. The pharmacist’s reason is shown and a new photo can be uploaded.
- H1 register: as Priya (`5550000004`), order *Cefdinova 300 mg* and upload `rx-priya-das-h1.png`. The pharmacist must complete the H1 register fields before approving.
- Access control: a customer opening `/pharmacist` gets *You don’t have access to this page*. Prescription files are served only to the uploading customer and in-scope pharmacists, and every view is audited.

**F. Operations**
Sign in as `5550000301`:
- The **Dashboard** shows orders by store, median verification time, rejections and orders waiting for stock (seeded RX-50226).
- **Medicine rules** shows the versioned policies and lets you add a new version (Schedule X/narcotic can never be enabled online).
- **Run refill reminder job (mock)** logs mock notifications without sending anything or creating orders.

## 7. Loading the sample stock CSV

1. Sign in as operations (`5550000301`) → **Stock import**.
2. Upload `fixtures/stock/sample-daily-stock.csv` (clean, 67 rows) or `fixtures/stock/sample-stock-with-errors.csv` (shows row-level errors and duplicates).
3. Review the preview, then press **Apply N valid row(s)**. Rows that would push stock below quantities already reserved for open orders are refused. Orders waiting for stock are re-routed automatically; the clean sample raises Behala thermometer stock, so RX-50226 gets routed.

CSV format: `store_code,sku,quantity_on_hand` (quantities in packs). Store codes: `SL01 BH01 HM01 GH01 DD01 SB01`. SKUs are listed in `prisma/seed.ts`.

## 8. Resetting the demo data

```bash
npm run db:seed     # wipes all tables and reloads the synthetic dataset (keeps the schema)
npm run db:reset    # drops and re-applies every migration, then seeds
```

The seed also deletes the encrypted demo files in `PRIVATE_STORAGE_DIR` and re-creates them. Sign out and back in after a reset; old sessions are removed.

## 9. Automated tests

```bash
npm run typecheck
npm run lint
npm test                      # unit + database integration tests (Vitest); needs the Docker DB running
npx playwright install chromium   # once, for browser tests
npm run test:e2e              # Playwright: starts its own server on :3100 against the test database
```

Integration and browser tests use the separate `pharmacy_test` database, which `docker/init-db.sql` creates on first start. They never touch the demo data. Browser tests use the deterministic `fixture` extraction provider. No test calls a payment, SMS, WhatsApp or AI service.

If your Docker volume was created before `docker/init-db.sql` existed, create the test DB once with:
`docker compose exec db createdb -U pharmacy pharmacy_test`

## 10. Optional: Claude vision extraction

Handwritten prescriptions usually come back low-confidence from local OCR and go to manual pharmacist reading. To try the Claude vision adapter, which sends prescription images to Anthropic’s API, set in `.env`: `EXTRACTION_PROVIDER=anthropic`, `ALLOW_EXTERNAL_PRESCRIPTION_PROCESSING=true` and `ANTHROPIC_API_KEY`. Then restart. Do this only with synthetic images. This adapter was tested with mocked responses only (no live call was made during development).

## 11. Known limitations

- Local/demo only: not deployed, not load-tested, and not a compliance-reviewed system. Regulatory rules are configurable placeholders taken from the brief, not legal advice.
- Local OCR (Tesseract) reads printed text well but handwriting poorly; such prescriptions are routed to manual review by design.
- Store distance is straight-line distance from an area the customer picks (approximate demo coordinates), not travel time. Only 6 demo stores are seeded, not the chain’s 46.
- OTP delivery, SMS and WhatsApp are mocks. In `APP_ENV=production` there is no real SMS adapter, so sign-in would not work until one is added.
- UPI and cash on delivery are simulated (test references only).
- Bengali and Hindi cover navigation, statuses and main buttons only. They are draft translations and need native review.
- Prescription validity periods and stock reservation expiry are not modelled (not specified in the brief).
- Single-instance prototype: rate limits are stored in Postgres, and files sit on local disk rather than object storage.

## 12. Troubleshooting

| Symptom | Fix |
|---|---|
| `db:migrate` cannot connect | Make sure Docker is running and port 5433 is free, then `npm run db:up`. |
| Upload says storage is not configured | `.env` is missing the encryption key. Run `npm run setup:env` (only if `.env` doesn’t exist) or add a base64 32-byte key, then `npm run db:seed`. |
| Seeded prescription images fail to load | The encryption key changed after seeding. Run `npm run db:seed`. |
| Tests fail with “Could not migrate the test database” | Start the DB (`npm run db:up`) and make sure the `pharmacy_test` database exists (section 9). |
| Port 3000 in use | `npx next dev -p 3001`. |
