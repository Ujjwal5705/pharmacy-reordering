/**
 * Resets the database to the synthetic demo dataset. Every person, phone number, clinic and
 * prescription here is fictional. Schedule categories of seeded products are demo classifications
 * and must be verified against official schedules before any real use.
 *
 *   npm run db:seed        (also run by npm run db:reset)
 */
import { readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { PrismaClient, type MedicineCategory, type OrderStatus, type Prisma } from "@prisma/client";

const db = new PrismaClient();
const NOW = new Date();
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

async function reset() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  // TRUNCATE does not fire the row-level append-only trigger on AuditEvent (intended for demo resets only).
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  await db.$executeRawUnsafe(`ALTER SEQUENCE order_number_seq RESTART WITH 50231`);
  const dir = path.resolve(process.cwd(), process.env.PRIVATE_STORAGE_DIR || "./storage/private");
  try {
    for (const f of readdirSync(dir)) if (/^[a-f0-9]{32}\.enc$/.test(f)) rmSync(path.join(dir, f));
  } catch {
    /* directory does not exist yet */
  }
}

async function main() {
  // Imported lazily so the env (encryption key) is loaded before config() reads it.
  const { storeEncrypted, newStorageKey } = await import("../src/server/prescriptions/storage");
  const { runExtraction } = await import("../src/server/extraction/pipeline");
  const { FixtureProvider } = await import("../src/server/extraction/providers/fixture");
  const { estimateRefill } = await import("../src/server/domain/refill");

  await reset();

  // ── policies (versioned, effective-dated) ──
  const policyRows: { category: MedicineCategory; orderable: boolean; rx: boolean; pharm: boolean; h1: boolean; text: string }[] = [
    { category: "OTC", orderable: true, rx: false, pharm: false, h1: false, text: "Non-scheduled demo items: no prescription needed." },
    { category: "SCHEDULE_H", orderable: true, rx: true, pharm: true, h1: false, text: "Schedule H: valid prescription and pharmacist approval required (brief)." },
    { category: "SCHEDULE_H1", orderable: true, rx: true, pharm: true, h1: true, text: "Schedule H1: prescription, pharmacist approval and H1 register entry required (brief)." },
    { category: "SCHEDULE_X", orderable: false, rx: true, pharm: true, h1: false, text: "Schedule X: not sold online (brief)." },
    { category: "NARCOTIC", orderable: false, rx: true, pharm: true, h1: false, text: "Narcotic items: not sold online (brief)." },
  ];
  const policies: Record<string, string> = {};
  for (const p of policyRows) {
    const row = await db.medicinePolicy.create({
      data: {
        category: p.category,
        version: 1,
        effectiveFrom: new Date("2026-01-01T00:00:00Z"),
        onlineOrderable: p.orderable,
        prescriptionRequired: p.rx,
        pharmacistApprovalRequired: p.pharm,
        h1RegisterRequired: p.h1,
        description: `${p.text} Prototype rule — online pharmacy rules are not final.`,
      },
    });
    policies[p.category] = row.id;
  }

  // ── localities & stores (approximate demo coordinates) ──
  const localityData = [
    ["Salt Lake", "700091", 22.5800, 88.4150],
    ["Behala", "700034", 22.4980, 88.3100],
    ["Howrah Maidan", "711101", 22.5860, 88.3260],
    ["Gariahat", "700019", 22.5190, 88.3660],
    ["Dum Dum", "700028", 22.6220, 88.4200],
    ["Shibpur", "711102", 22.5650, 88.3150],
    ["New Town", "700156", 22.5800, 88.4700],
    ["Park Street", "700016", 22.5530, 88.3520],
    ["Tollygunge", "700033", 22.4990, 88.3460],
    ["Lake Town", "700089", 22.6050, 88.4020],
  ] as const;
  const localities: Record<string, string> = {};
  for (const [name, pincode, lat, lng] of localityData) {
    localities[name] = (await db.locality.create({ data: { name, pincode, lat, lng } })).id;
  }
  const storeData = [
    ["SL01", "Salt Lake (demo store)", "Sector II, Salt Lake, Kolkata", 22.5795, 88.4180],
    ["BH01", "Behala (demo store)", "Diamond Harbour Road, Behala, Kolkata", 22.4995, 88.3125],
    ["HM01", "Howrah Maidan (demo store)", "Howrah Maidan, Howrah", 22.5855, 88.3240],
    ["GH01", "Gariahat (demo store)", "Gariahat Road, Kolkata", 22.5185, 88.3680],
    ["DD01", "Dum Dum (demo store)", "Dum Dum Road, Kolkata", 22.6230, 88.4215],
    ["SB01", "Shibpur (demo store)", "Shibpur, Howrah", 22.5640, 88.3130],
  ] as const;
  const stores: Record<string, string> = {};
  for (const [code, name, address, lat, lng] of storeData) {
    stores[code] = (await db.store.create({ data: { code, name, address, lat, lng } })).id;
  }

  // ── catalogue (synthetic; "fictional" brands and restricted demo items) ──
  type P = [sku: string, name: string, molecule: string, strength: string, form: string, pack: string, units: number, rupees: number, cat: MedicineCategory, generic: boolean, group: string | null, mfr: string];
  const productData: P[] = [
    ["MET500-G", "Metformin 500 mg", "Metformin", "500 mg", "Tablet", "Strip of 15", 15, 120, "SCHEDULE_H", true, "metformin-500-tab", "Generic (demo)"],
    ["MET500-B", "Glucofine 500", "Metformin", "500 mg", "Tablet", "Strip of 15", 15, 165, "SCHEDULE_H", false, "metformin-500-tab", "Fictional Brand Labs"],
    ["MET1000-G", "Metformin 1000 mg", "Metformin", "1000 mg", "Tablet", "Strip of 15", 15, 180, "SCHEDULE_H", true, "metformin-1000-tab", "Generic (demo)"],
    ["TEL40-G", "Telmisartan 40 mg", "Telmisartan", "40 mg", "Tablet", "Strip of 10", 10, 285, "SCHEDULE_H", true, "telmisartan-40-tab", "Generic (demo)"],
    ["TEL40-B", "Telmora 40", "Telmisartan", "40 mg", "Tablet", "Strip of 10", 10, 340, "SCHEDULE_H", false, "telmisartan-40-tab", "Fictional Brand Labs"],
    ["TEL80-G", "Telmisartan 80 mg", "Telmisartan", "80 mg", "Tablet", "Strip of 10", 10, 420, "SCHEDULE_H", true, "telmisartan-80-tab", "Generic (demo)"],
    ["LEV50-G", "Levothyroxine 50 mcg", "Levothyroxine", "50 mcg", "Tablet", "Bottle of 100", 100, 190, "SCHEDULE_H", true, "levothyroxine-50-tab", "Generic (demo)"],
    ["LEV50-B", "Thyrovance 50", "Levothyroxine", "50 mcg", "Tablet", "Bottle of 100", 100, 235, "SCHEDULE_H", false, "levothyroxine-50-tab", "Fictional Brand Labs"],
    ["LEV25-G", "Levothyroxine 25 mcg", "Levothyroxine", "25 mcg", "Tablet", "Bottle of 100", 100, 150, "SCHEDULE_H", true, "levothyroxine-25-tab", "Generic (demo)"],
    ["LEV100-G", "Levothyroxine 100 mcg", "Levothyroxine", "100 mcg", "Tablet", "Bottle of 100", 100, 230, "SCHEDULE_H", true, "levothyroxine-100-tab", "Generic (demo)"],
    ["GLM1-G", "Glimepiride 1 mg", "Glimepiride", "1 mg", "Tablet", "Strip of 10", 10, 95, "SCHEDULE_H", true, "glimepiride-1-tab", "Generic (demo)"],
    ["AML5-G", "Amlodipine 5 mg", "Amlodipine", "5 mg", "Tablet", "Strip of 10", 10, 60, "SCHEDULE_H", true, "amlodipine-5-tab", "Generic (demo)"],
    ["CEF300-H1", "Cefdinova 300 mg (fictional H1 demo item)", "Cefdinova", "300 mg", "Capsule", "Strip of 10", 10, 410, "SCHEDULE_H1", true, null, "Fictional Brand Labs"],
    ["XRS5-X", "Xelorex 5 mg (fictional Schedule X demo item)", "Xelorex", "5 mg", "Tablet", "Strip of 10", 10, 300, "SCHEDULE_X", false, null, "Fictional Brand Labs"],
    ["NRC10-N", "Narcodem 10 mg (fictional narcotic demo item)", "Narcodem", "10 mg", "Tablet", "Strip of 10", 10, 350, "NARCOTIC", false, null, "Fictional Brand Labs"],
    ["ORS-01", "Oral rehydration salts sachet", "Oral rehydration salts", "21.8 g", "Sachet", "1 sachet", 1, 22, "OTC", true, null, "Generic (demo)"],
    ["BND-20", "Adhesive bandage strips", "Adhesive bandage", "Assorted", "Strip", "Pack of 20", 20, 45, "OTC", true, null, "Generic (demo)"],
    ["THM-01", "Digital thermometer", "Thermometer", "Digital", "Device", "1 unit", 1, 199, "OTC", true, null, "Generic (demo)"],
  ];
  // Repeat medicines (diabetes, blood pressure, thyroid) offer refill reminders; short courses and devices do not.
  const REPEAT = new Set(["MET500-G", "MET500-B", "MET1000-G", "TEL40-G", "TEL40-B", "TEL80-G", "LEV50-G", "LEV50-B", "LEV25-G", "LEV100-G", "GLM1-G", "AML5-G"]);
  const products: Record<string, { id: string; pricePaise: number; unitsPerPack: number; category: MedicineCategory }> = {};
  for (const [sku, name, molecule, strength, form, packLabel, unitsPerPack, rupees, category, isGeneric, genericGroup, manufacturer] of productData) {
    const p = await db.product.create({
      data: { sku, name, molecule, strength, form, packLabel, unitsPerPack, pricePaise: rupees * 100, category, isGeneric, genericGroup, manufacturer, refillReminders: REPEAT.has(sku) },
    });
    products[sku] = { id: p.id, pricePaise: p.pricePaise, unitsPerPack, category };
  }

  // ── inventory snapshot (packs) — mirrors fixtures/stock/sample-daily-stock.csv before seeded orders ──
  const base: Record<string, Record<string, number>> = {
    SL01: { "MET500-G": 30, "MET500-B": 12, "MET1000-G": 10, "TEL40-G": 25, "TEL40-B": 8, "TEL80-G": 6, "LEV50-G": 8, "LEV50-B": 4, "LEV25-G": 6, "GLM1-G": 15, "AML5-G": 20, "CEF300-H1": 5, "XRS5-X": 4, "NRC10-N": 2, "ORS-01": 40, "BND-20": 15, "THM-01": 3 },
    BH01: { "MET500-G": 20, "MET1000-G": 6, "TEL40-G": 18, "TEL40-B": 6, "LEV50-G": 5, "LEV25-G": 4, "GLM1-G": 10, "AML5-G": 12, "ORS-01": 30, "BND-20": 10, "THM-01": 2 },
    HM01: { "MET500-G": 15, "TEL40-G": 10, "LEV50-G": 6, "LEV50-B": 3, "GLM1-G": 8, "AML5-G": 10, "ORS-01": 25, "BND-20": 8, "THM-01": 1 },
    GH01: { "MET500-G": 18, "MET500-B": 6, "TEL40-G": 12, "TEL80-G": 4, "LEV50-G": 7, "LEV100-G": 2, "GLM1-G": 9, "AML5-G": 14, "CEF300-H1": 6, "ORS-01": 20, "BND-20": 12, "THM-01": 2 },
    DD01: { "MET500-G": 22, "MET1000-G": 8, "TEL40-G": 14, "TEL80-G": 5, "LEV50-G": 6, "LEV100-G": 3, "LEV25-G": 3, "GLM1-G": 7, "AML5-G": 9, "ORS-01": 18, "THM-01": 1 },
    SB01: { "MET500-G": 12, "TEL40-G": 9, "LEV50-G": 4, "GLM1-G": 6, "AML5-G": 8, "ORS-01": 15, "BND-20": 6 },
  };
  for (const [code, rows] of Object.entries(base)) {
    for (const [sku, onHand] of Object.entries(rows)) {
      await db.inventoryItem.create({ data: { storeId: stores[code], productId: products[sku].id, onHand } });
    }
  }

  // ── people (fictional; 555-prefixed numbers are not allocated to Indian mobiles) ──
  const mkCustomer = async (phone: string, name: string, locality: string, address: string, family: { name: string; relation: "SELF" | "MOTHER"; yearOfBirth: number }[]) =>
    db.user.create({
      data: { phone, name, role: "CUSTOMER", defaultLocalityId: localities[locality], addressLine: address, familyMembers: { create: family } },
      include: { familyMembers: true },
    });
  const debasish = await mkCustomer("5550000001", "Debasish Ghosh", "Salt Lake", "Flat 4B, Demo Apartments, Sector II, Salt Lake", [
    { name: "Debasish Ghosh", relation: "SELF", yearOfBirth: 1968 },
    { name: "Sunita Ghosh", relation: "MOTHER", yearOfBirth: 1946 },
  ]);
  const rina = await mkCustomer("5550000002", "Rina Sen", "Behala", "22 Sample Para, Behala", [{ name: "Rina Sen", relation: "SELF", yearOfBirth: 1975 }]);
  const arif = await mkCustomer("5550000003", "Arif Mondal", "Howrah Maidan", "7 Example Lane, Howrah Maidan", [{ name: "Arif Mondal", relation: "SELF", yearOfBirth: 1981 }]);
  await mkCustomer("5550000004", "Priya Das", "Gariahat", "3 Placeholder Road, Gariahat", [{ name: "Priya Das", relation: "SELF", yearOfBirth: 1990 }]);

  const ananya = await db.user.create({ data: { phone: "5550000101", name: "Ananya Roy (central pharmacist)", role: "PHARMACIST", pharmacistRegNo: "WBPC-DEMO-0001" } });
  await db.user.create({ data: { phone: "5550000102", name: "Sourav Dutta (Salt Lake pharmacist)", role: "PHARMACIST", storeId: stores.SL01, pharmacistRegNo: "WBPC-DEMO-0002" } });
  const staffSL = await db.user.create({ data: { phone: "5550000201", name: "Salt Lake store desk", role: "STORE_STAFF", storeId: stores.SL01 } });
  await db.user.create({ data: { phone: "5550000202", name: "Behala store desk", role: "STORE_STAFF", storeId: stores.BH01 } });
  await db.user.create({ data: { phone: "5550000203", name: "Howrah Maidan store desk", role: "STORE_STAFF", storeId: stores.HM01 } });
  await db.user.create({ data: { phone: "5550000301", name: "Central operations desk", role: "OPS_ADMIN" } });

  const self = (u: typeof debasish) => u.familyMembers.find((m) => m.relation === "SELF")!;
  const mother = debasish.familyMembers.find((m) => m.relation === "MOTHER")!;

  // ── prescriptions: encrypt fixture images into private storage, record seeded extraction drafts ──
  const provider = new FixtureProvider();
  const catalogue = await db.product.findMany({ select: { id: true, name: true, molecule: true, strength: true, form: true, genericGroup: true, active: true } });
  const thresholds = { minFieldConfidence: 0.8, minOverallConfidence: 0.75, minMatchScore: 0.85 };
  async function seedPrescription(customerId: string, familyMemberId: string, file: string, uploadedAt: Date) {
    const bytes = readFileSync(path.join(process.cwd(), "fixtures", "prescriptions", file));
    const storageKey = newStorageKey();
    const stored = await storeEncrypted(storageKey, bytes);
    const rx = await db.prescription.create({
      data: { customerId, familyMemberId, storageKey, mimeType: "image/png", sizeBytes: bytes.length, cipherSha256: stored.cipherSha256, keyId: stored.keyId, uploadedAt },
    });
    const o = await runExtraction(provider, { bytes, mimeType: "image/png" }, catalogue, thresholds, 10_000);
    await db.extractionRun.create({
      data: {
        prescriptionId: rx.id,
        provider: "fixture (seeded demo transcription)",
        status: o.status,
        overallConfidence: o.overallConfidence,
        errorCode: o.errorCode,
        durationMs: o.durationMs,
        createdAt: uploadedAt,
        fields: { create: o.fields },
        lines: {
          create: o.lines.map(({ candidates, ...l }) => ({ ...l, candidates: candidates as Prisma.InputJsonValue })),
        },
      },
    });
    await db.auditEvent.create({ data: { actorId: customerId, actorRole: "CUSTOMER", action: "PRESCRIPTION_UPLOADED", entityType: "Prescription", entityId: rx.id, createdAt: uploadedAt } });
    return { rx, status: o.status };
  }

  const rxMother = await seedPrescription(debasish.id, mother.id, "rx-sunita-ghosh.png", daysAgo(29));
  const rxDebasish = await seedPrescription(debasish.id, self(debasish).id, "rx-debasish-ghosh.png", daysAgo(27));
  const rxRina = await seedPrescription(rina.id, self(rina).id, "rx-rina-sen.png", minutesAgo(26));
  const rxArif = await seedPrescription(arif.id, self(arif).id, "rx-arif-mondal-blurred.png", minutesAgo(95));

  // ── orders ──
  type Line = { sku: string; qty: number; unitsPerDay?: number | null; dosage?: string | null; status?: "APPROVED" | "PENDING_REVIEW" | "REJECTED" | "NOT_REQUIRED" };
  type Seed = {
    number: string; customer: typeof debasish; memberId: string; locality: string; store: string | null; status: OrderStatus;
    rx: string | null; submitted: Date; lines: Line[]; timeline: [OrderStatus, Date, string?][]; review?: { outcome: "APPROVED" | "REUPLOAD_REQUESTED" | "REJECTED"; at: Date; reason?: string; header?: boolean };
    reservation: "HELD" | "CONSUMED" | "RELEASED" | "NONE"; invoice?: string; partner?: string; payment: "UPI_TEST" | "COD_TEST"; manual?: boolean;
    routing?: "ROUTED" | "NO_STOCK";
  };
  const orders: Seed[] = [
    {
      number: "RX-50172", customer: debasish, memberId: mother.id, locality: "Salt Lake", store: "SL01", status: "DELIVERED", rx: rxMother.rx.id,
      submitted: daysAgo(29), lines: [{ sku: "LEV50-G", qty: 1, unitsPerDay: null, dosage: "as directed (no daily dose written)" }],
      timeline: [["AWAITING_PHARMACIST", daysAgo(29)], ["APPROVED", new Date(daysAgo(29).getTime() + 7 * 60_000)], ["PICKING", daysAgo(28.9)], ["PACKED", daysAgo(28.85)], ["HANDED_TO_DELIVERY", daysAgo(28.8)], ["DELIVERED", daysAgo(28.7)]],
      review: { outcome: "APPROVED", at: new Date(daysAgo(29).getTime() + 7 * 60_000), header: true }, reservation: "CONSUMED", invoice: "SL-INV-2026-0388", partner: "Store delivery — Rakesh (demo)", payment: "COD_TEST",
    },
    {
      number: "RX-50180", customer: debasish, memberId: self(debasish).id, locality: "Salt Lake", store: "SL01", status: "DELIVERED", rx: rxDebasish.rx.id,
      submitted: daysAgo(27), lines: [{ sku: "TEL40-G", qty: 3, unitsPerDay: 1, dosage: "1-0-0 (once daily)" }],
      timeline: [["AWAITING_PHARMACIST", daysAgo(27)], ["APPROVED", new Date(daysAgo(27).getTime() + 9 * 60_000)], ["PICKING", daysAgo(26.95)], ["PACKED", daysAgo(26.9)], ["HANDED_TO_DELIVERY", daysAgo(26.85)], ["DELIVERED", daysAgo(26)]],
      review: { outcome: "APPROVED", at: new Date(daysAgo(27).getTime() + 9 * 60_000), header: true }, reservation: "CONSUMED", invoice: "SL-INV-2026-0397", partner: "Store delivery — Rakesh (demo)", payment: "UPI_TEST",
    },
    {
      number: "RX-50195", customer: rina, memberId: self(rina).id, locality: "Behala", store: "BH01", status: "REJECTED", rx: rxRina.rx.id,
      submitted: daysAgo(6), lines: [{ sku: "TEL80-G", qty: 2, status: "REJECTED" }],
      timeline: [["AWAITING_PHARMACIST", daysAgo(6)], ["REJECTED", new Date(daysAgo(6).getTime() + 14 * 60_000), "Telmisartan 80 mg is not on the uploaded prescription."]],
      review: { outcome: "REJECTED", at: new Date(daysAgo(6).getTime() + 14 * 60_000), reason: "Telmisartan 80 mg is not on the uploaded prescription." }, reservation: "RELEASED", payment: "UPI_TEST",
    },
    {
      number: "RX-50211", customer: debasish, memberId: mother.id, locality: "Salt Lake", store: "SL01", status: "PACKED", rx: rxMother.rx.id,
      submitted: minutesAgo(180), lines: [{ sku: "MET500-G", qty: 4, unitsPerDay: 2, dosage: "1-0-1 (twice daily)" }],
      timeline: [["AWAITING_PHARMACIST", minutesAgo(180)], ["APPROVED", minutesAgo(172)], ["PICKING", minutesAgo(150)], ["PACKED", minutesAgo(140)]],
      review: { outcome: "APPROVED", at: minutesAgo(172), header: true }, reservation: "CONSUMED", invoice: "SL-INV-2026-0411", payment: "UPI_TEST",
    },
    {
      number: "RX-50214", customer: rina, memberId: self(rina).id, locality: "Behala", store: "BH01", status: "AWAITING_PHARMACIST", rx: rxRina.rx.id,
      submitted: minutesAgo(25), lines: [{ sku: "TEL40-G", qty: 3 }], timeline: [["AWAITING_PHARMACIST", minutesAgo(25)]], reservation: "HELD", payment: "COD_TEST",
    },
    {
      number: "RX-50219", customer: arif, memberId: self(arif).id, locality: "Howrah Maidan", store: "HM01", status: "NEEDS_REUPLOAD", rx: rxArif.rx.id,
      submitted: minutesAgo(95), lines: [{ sku: "LEV50-G", qty: 1 }], manual: true,
      timeline: [["AWAITING_PHARMACIST", minutesAgo(95)], ["NEEDS_REUPLOAD", minutesAgo(88), "Photo is blurred and the strength is not legible. Please upload a clear photo of the full prescription."]],
      review: { outcome: "REUPLOAD_REQUESTED", at: minutesAgo(88), reason: "Photo is blurred and the strength is not legible. Please upload a clear photo of the full prescription." },
      reservation: "HELD", payment: "UPI_TEST",
    },
    {
      number: "RX-50226", customer: rina, memberId: self(rina).id, locality: "Behala", store: null, status: "APPROVED", rx: null, routing: "NO_STOCK",
      submitted: minutesAgo(40), lines: [{ sku: "THM-01", qty: 4, status: "NOT_REQUIRED" }], timeline: [["APPROVED", minutesAgo(40), "No prescription items — no pharmacist review needed"]], reservation: "NONE", payment: "COD_TEST",
    },
  ];

  for (const o of orders) {
    const lines = o.lines.map((l) => {
      const p = products[l.sku];
      const rxNeeded = p.category !== "OTC";
      return { ...l, p, rxNeeded, status: l.status ?? (o.status === "AWAITING_PHARMACIST" || o.status === "NEEDS_REUPLOAD" ? "PENDING_REVIEW" : rxNeeded ? "APPROVED" : "NOT_REQUIRED") };
    });
    const subtotal = lines.filter((l) => l.status !== "REJECTED").reduce((s, l) => s + l.p.pricePaise * l.qty, 0);
    const fulfilled = (s: OrderStatus) => o.timeline.find((t) => t[0] === s)?.[1] ?? null;
    const order = await db.order.create({
      data: {
        orderNumber: o.number, customerId: o.customer.id, familyMemberId: o.memberId, status: o.status,
        routingStatus: o.routing ?? (o.store ? "ROUTED" : "NOT_ROUTED"), storeId: o.store ? stores[o.store] : null, routedAt: o.store ? o.submitted : null,
        distanceKm: o.store ? 0.4 : null, deliveryLocalityId: localities[o.locality], deliveryAddress: o.customer.addressLine!,
        subtotalPaise: subtotal, requiresPharmacist: lines.some((l) => l.rxNeeded), manualReviewRequired: o.manual ?? false, prescriptionId: o.rx,
        rejectionReason: o.review?.outcome === "REJECTED" ? o.review.reason : null, storeInvoiceNumber: o.invoice, deliveryPartner: o.partner,
        submittedAt: o.submitted, createdAt: o.submitted, firstDecisionAt: o.review?.at ?? null, approvedAt: fulfilled("APPROVED"),
        pickedAt: fulfilled("PICKING"), packedAt: fulfilled("PACKED"), handedOverAt: fulfilled("HANDED_TO_DELIVERY"), deliveredAt: fulfilled("DELIVERED"),
        source: o.number === "RX-50211" ? "REORDER" : "CATALOGUE",
      },
    });
    let prev: OrderStatus | null = null;
    for (const [to, at, note] of o.timeline) {
      const pharm = ["APPROVED", "REJECTED", "NEEDS_REUPLOAD"].includes(to) && o.review;
      const store = ["PICKING", "PACKED", "HANDED_TO_DELIVERY", "DELIVERED"].includes(to);
      await db.orderStatusEvent.create({
        data: { orderId: order.id, fromStatus: prev, toStatus: to, createdAt: at, note: note ?? (prev ? null : "Order submitted"),
          actorId: pharm ? ananya.id : store ? staffSL.id : o.customer.id, actorRole: pharm ? "PHARMACIST" : store ? "STORE_STAFF" : prev ? "SYSTEM" : "CUSTOMER" },
      });
      prev = to;
    }
    const review = o.review
      ? await db.pharmacistReview.create({
          data: {
            orderId: order.id, prescriptionId: o.rx, reviewerId: ananya.id, reviewerRegNo: ananya.pharmacistRegNo!, outcome: o.review.outcome, reason: o.review.reason, createdAt: o.review.at,
            extractionRunId: o.rx ? (await db.extractionRun.findFirst({ where: { prescriptionId: o.rx } }))!.id : null,
            ...(o.review.header && o.rx === rxMother.rx.id ? { patientName: "Sunita Ghosh", prescriberName: "Dr. Arindam Banerjee", prescriberRegNo: "WBMC-DEMO-1042", prescriptionDate: new Date("2026-10-03") } : {}),
            ...(o.review.header && o.rx === rxDebasish.rx.id ? { patientName: "Debasish Ghosh", prescriberName: "Dr. Arindam Banerjee", prescriberRegNo: "WBMC-DEMO-1042", prescriptionDate: new Date("2026-09-01") } : {}),
          },
        })
      : null;
    if (review) {
      await db.auditEvent.create({ data: { actorId: ananya.id, actorRole: "PHARMACIST", action: "PRESCRIPTION_REVIEW_SUBMITTED", entityType: "Order", entityId: order.id, metadata: { reviewId: review.id, outcome: review.outcome }, createdAt: o.review!.at } });
    }

    for (const l of lines) {
      const approved = l.status === "APPROVED";
      const item = await db.orderItem.create({
        data: {
          orderId: order.id, productId: l.p.id, requestedProductId: l.p.id, quantity: l.qty, approvedQuantity: approved ? l.qty : null, unitPricePaise: l.p.pricePaise,
          status: l.status, category: l.p.category, policyId: policies[l.p.category], prescriptionRequired: l.rxNeeded, pharmacistApprovalRequired: l.rxNeeded, h1RegisterRequired: false,
          unitsPerDay: approved ? (l.unitsPerDay ?? null) : null, dosageInstruction: approved ? (l.dosage ?? null) : null, approvedByReviewId: approved && review ? review.id : null,
        },
      });
      if (review && o.review!.outcome !== "REUPLOAD_REQUESTED") {
        await db.reviewItemDecision.create({
          data: { reviewId: review.id, orderItemId: item.id, decision: approved ? "APPROVE" : "REJECT", approvedQuantity: approved ? l.qty : null,
            unitsPerDay: approved ? (l.unitsPerDay ?? null) : null, dosageInstruction: approved ? (l.dosage ?? null) : null, reason: approved ? null : o.review!.reason },
        });
      }
      if (o.store && o.reservation !== "NONE") {
        await db.stockReservation.create({ data: { orderId: order.id, orderItemId: item.id, storeId: stores[o.store], productId: l.p.id, quantity: l.qty, status: o.reservation, createdAt: o.submitted } });
        const where = { storeId_productId: { storeId: stores[o.store], productId: l.p.id } };
        if (o.reservation === "HELD") await db.inventoryItem.update({ where, data: { reserved: { increment: l.qty } } });
        if (o.reservation === "CONSUMED") await db.inventoryItem.update({ where, data: { onHand: { decrement: l.qty } } });
      }
      if (approved && review) {
        const delivered = fulfilled("DELIVERED");
        const est = estimateRefill({ packs: l.qty, unitsPerPack: l.p.unitsPerPack, unitsPerDay: l.unitsPerDay ?? null, startDate: delivered, remindDaysBefore: 5 });
        await db.refillPlan.create({
          data: {
            customerId: o.customer.id, familyMemberId: o.memberId, productId: l.p.id, sourceOrderId: order.id, sourceOrderItemId: item.id,
            packsSupplied: l.qty, unitsSupplied: est.unitsSupplied, unitsPerDay: l.unitsPerDay ?? null, startDate: delivered,
            runOutDate: est.kind === "ESTIMATED" ? est.runOutDate : null, remindAt: est.kind === "ESTIMATED" ? est.remindAt : null,
            status: est.kind === "ESTIMATED" ? "ACTIVE" : est.kind === "AWAITING_DELIVERY" ? "AWAITING_DELIVERY" : "NEEDS_DOSAGE",
            optedIn: est.kind !== "NEEDS_DOSAGE", channel: "IN_APP",
          },
        });
      }
    }
    await db.paymentRecord.create({
      data: {
        orderId: order.id, method: o.payment, amountPaise: subtotal, testReference: `${o.payment === "UPI_TEST" ? "TESTUPI" : "TESTCOD"}-${o.number.slice(3)}`,
        status: o.status === "REJECTED" ? (o.payment === "UPI_TEST" ? "TEST_REFUNDED" : "VOID") : o.payment === "UPI_TEST" ? "TEST_PAID" : o.status === "DELIVERED" ? "COD_COLLECTED" : "COD_PENDING",
      },
    });
  }
  // Consents behind the seeded opt-ins.
  for (const plan of await db.refillPlan.findMany({ where: { optedIn: true } })) {
    await db.consent.create({ data: { customerId: plan.customerId, type: "REFILL_REMINDERS", granted: true, channel: "IN_APP", subjectType: "RefillPlan", subjectId: plan.id, textVersion: "refill-reminder-v1", createdAt: plan.createdAt } });
  }

  // A previous stock import, so the history table is not empty.
  const ops = await db.user.findUniqueOrThrow({ where: { phone: "5550000301" } });
  const rowsSeeded = Object.values(base).reduce((n, r) => n + Object.keys(r).length, 0);
  await db.stockImportBatch.create({ data: { fileName: "initial-demo-stock (seed)", uploadedById: ops.id, status: "APPLIED", totalRows: rowsSeeded, validRows: rowsSeeded, errorRows: 0, createdAt: daysAgo(1), appliedAt: daysAgo(1) } });

  console.log(`Seeded ${orders.length} orders, ${productData.length} products, ${storeData.length} stores. Prescriptions: mother=${rxMother.status}, rina=${rxRina.status}, arif=${rxArif.status}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
