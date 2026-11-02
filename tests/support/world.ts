import { readFileSync } from "node:fs";
import path from "node:path";
import type { MedicineCategory, Role } from "@prisma/client";
import type { Actor } from "@/server/actor";
import { db } from "@/server/db";

export async function resetDb() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

export const fixture = (name: string) => readFileSync(path.join(process.cwd(), "fixtures", "prescriptions", name));
export const pngFile = (name: string) => {
  const bytes = fixture(name);
  return { name, type: "image/png", size: bytes.length, bytes };
};

const toActor = (u: { id: string; role: Role; name: string; storeId: string | null; pharmacistRegNo: string | null }): Actor => ({
  id: u.id,
  role: u.role,
  name: u.name,
  storeId: u.storeId,
  pharmacistRegNo: u.pharmacistRegNo,
});

/**
 * Small, deterministic world: 3 stores at known distances from the "Salt Lake" locality,
 * products in every category, and one actor per role.
 */
export async function buildWorld() {
  await resetDb();
  const categories: MedicineCategory[] = ["OTC", "SCHEDULE_H", "SCHEDULE_H1", "SCHEDULE_X", "NARCOTIC"];
  for (const c of categories) {
    await db.medicinePolicy.create({
      data: {
        category: c,
        version: 1,
        effectiveFrom: new Date("2026-01-01"),
        onlineOrderable: c !== "SCHEDULE_X" && c !== "NARCOTIC",
        prescriptionRequired: c !== "OTC",
        pharmacistApprovalRequired: c !== "OTC",
        h1RegisterRequired: c === "SCHEDULE_H1",
        description: "test policy",
      },
    });
  }
  const saltLake = await db.locality.create({ data: { name: "Salt Lake", pincode: "700091", lat: 22.58, lng: 88.415 } });
  const behalaLoc = await db.locality.create({ data: { name: "Behala", pincode: "700034", lat: 22.498, lng: 88.31 } });
  const near = await db.store.create({ data: { code: "NEAR", name: "Near store", address: "x", lat: 22.5795, lng: 88.418 } });
  const mid = await db.store.create({ data: { code: "MID", name: "Mid store", address: "x", lat: 22.622, lng: 88.42 } });
  const far = await db.store.create({ data: { code: "FAR", name: "Far store", address: "x", lat: 22.4995, lng: 88.3125 } });

  const mk = (sku: string, name: string, molecule: string, strength: string, category: MedicineCategory, pricePaise: number, unitsPerPack: number, genericGroup: string | null = null, isGeneric = true) =>
    db.product.create({ data: { sku, name, molecule, strength, form: "Tablet", packLabel: `Strip of ${unitsPerPack}`, unitsPerPack, pricePaise, category, genericGroup, isGeneric, manufacturer: "Test" } });
  const products = {
    metformin: await mk("MET500-G", "Metformin 500 mg", "Metformin", "500 mg", "SCHEDULE_H", 12000, 15, "met500"),
    metforminBrand: await mk("MET500-B", "Glucofine 500", "Metformin", "500 mg", "SCHEDULE_H", 16500, 15, "met500", false),
    telmisartan: await mk("TEL40-G", "Telmisartan 40 mg", "Telmisartan", "40 mg", "SCHEDULE_H", 28500, 10, "tel40"),
    levothyroxine: await mk("LEV50-G", "Levothyroxine 50 mcg", "Levothyroxine", "50 mcg", "SCHEDULE_H", 19000, 100, "lev50"),
    h1: await mk("CEF300-H1", "Cefdinova 300 mg", "Cefdinova", "300 mg", "SCHEDULE_H1", 41000, 10),
    scheduleX: await mk("XRS5-X", "Xelorex 5 mg", "Xelorex", "5 mg", "SCHEDULE_X", 30000, 10),
    narcotic: await mk("NRC10-N", "Narcodem 10 mg", "Narcodem", "10 mg", "NARCOTIC", 35000, 10),
    otc: await mk("THM-01", "Digital thermometer", "Thermometer", "Digital", "OTC", 19900, 1),
  };
  await db.product.updateMany({ where: { sku: { in: ["MET500-G", "MET500-B", "TEL40-G", "LEV50-G"] } }, data: { refillReminders: true } });
  const stock = async (storeId: string, productId: string, onHand: number) => db.inventoryItem.create({ data: { storeId, productId, onHand } });
  // NEAR: limited metformin, no brand; MID: plenty; FAR: plenty. Everyone stocks restricted items (in-store sale).
  for (const s of [near, mid, far]) {
    await stock(s.id, products.metformin.id, s.id === near.id ? 2 : 20);
    await stock(s.id, products.telmisartan.id, 10);
    await stock(s.id, products.levothyroxine.id, 5);
    await stock(s.id, products.h1.id, 5);
    await stock(s.id, products.scheduleX.id, 5);
    await stock(s.id, products.narcotic.id, 5);
    if (s.id !== near.id) await stock(s.id, products.metforminBrand.id, 10);
    await stock(s.id, products.otc.id, s.id === far.id ? 3 : 0);
  }

  const user = async (phone: string, name: string, role: Role, extra: { storeId?: string; pharmacistRegNo?: string } = {}) =>
    db.user.create({ data: { phone, name, role, defaultLocalityId: saltLake.id, addressLine: "1 Test Road", ...extra } });
  const customerA = await user("5550001001", "Customer A", "CUSTOMER");
  const customerB = await user("5550001002", "Customer B", "CUSTOMER");
  const memberA = await db.familyMember.create({ data: { customerId: customerA.id, name: "Parent of A", relation: "MOTHER" } });
  const memberB = await db.familyMember.create({ data: { customerId: customerB.id, name: "Customer B", relation: "SELF" } });
  const pharmacist = await user("5550001101", "Central pharmacist", "PHARMACIST", { pharmacistRegNo: "REG-1" });
  const farPharmacist = await user("5550001102", "Far-store pharmacist", "PHARMACIST", { storeId: far.id, pharmacistRegNo: "REG-2" });
  const unregistered = await user("5550001103", "Trainee (no registration)", "PHARMACIST");
  const staffNear = await user("5550001201", "Near staff", "STORE_STAFF", { storeId: near.id });
  const staffMid = await user("5550001202", "Mid staff", "STORE_STAFF", { storeId: mid.id });
  const ops = await user("5550001301", "Ops", "OPS_ADMIN");

  return {
    localities: { saltLake, behala: behalaLoc },
    stores: { near, mid, far },
    products,
    members: { a: memberA, b: memberB },
    actors: {
      customerA: toActor(customerA),
      customerB: toActor(customerB),
      pharmacist: toActor(pharmacist),
      farPharmacist: toActor(farPharmacist),
      unregistered: toActor(unregistered),
      staffNear: toActor(staffNear),
      staffMid: toActor(staffMid),
      ops: toActor(ops),
    },
  };
}
export type World = Awaited<ReturnType<typeof buildWorld>>;

export async function inventory(storeId: string, productId: string) {
  return db.inventoryItem.findUniqueOrThrow({ where: { storeId_productId: { storeId, productId } } });
}
