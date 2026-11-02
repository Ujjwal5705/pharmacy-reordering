import { describe, expect, it } from "vitest";
import { chooseNearestFulfillingStore, haversineKm } from "@/server/domain/geo";
import { estimateRefill } from "@/server/domain/refill";
import { parseStockCsv } from "@/server/domain/stock-csv";

describe("refill estimate", () => {
  const start = new Date("2026-10-01T00:00:00Z");

  it("divides units supplied by pharmacist-confirmed units per day", () => {
    // 4 strips × 15 tablets = 60; 1-0-1 = 2 a day → 30 days
    const e = estimateRefill({ packs: 4, unitsPerPack: 15, unitsPerDay: 2, startDate: start, remindDaysBefore: 5 });
    expect(e.kind).toBe("ESTIMATED");
    if (e.kind !== "ESTIMATED") return;
    expect(e.daysSupply).toBe(30);
    expect(e.runOutDate.toISOString()).toBe("2026-10-31T00:00:00.000Z");
    expect(e.remindAt.toISOString()).toBe("2026-10-26T00:00:00.000Z");
    expect(e.explanation).toContain("60 units ÷ 2 per day = 30 days");
  });

  it("rounds partial days down so the reminder is never late", () => {
    const e = estimateRefill({ packs: 1, unitsPerPack: 10, unitsPerDay: 3, startDate: start, remindDaysBefore: 0 });
    expect(e.kind === "ESTIMATED" && e.daysSupply).toBe(3);
  });

  it.each([null, 0, -1, Number.NaN, 25])("does not calculate a date when dosage is %s", (upd) => {
    const e = estimateRefill({ packs: 1, unitsPerPack: 100, unitsPerDay: upd as number | null, startDate: start, remindDaysBefore: 5 });
    expect(e.kind).toBe("NEEDS_DOSAGE");
    expect("runOutDate" in e).toBe(false);
  });

  it("waits for delivery before dating the estimate", () => {
    const e = estimateRefill({ packs: 3, unitsPerPack: 10, unitsPerDay: 1, startDate: null, remindDaysBefore: 5 });
    expect(e).toMatchObject({ kind: "AWAITING_DELIVERY", daysSupply: 30 });
  });

  it("never schedules a reminder before the supply started", () => {
    const e = estimateRefill({ packs: 1, unitsPerPack: 2, unitsPerDay: 1, startDate: start, remindDaysBefore: 5 });
    expect(e.kind === "ESTIMATED" && e.remindAt.getTime()).toBe(start.getTime());
  });
});

describe("nearest store with full stock", () => {
  const origin = { lat: 22.58, lng: 88.415 }; // Salt Lake
  const near = { storeId: "near", point: { lat: 22.5795, lng: 88.418 }, available: new Map([["met", 2], ["tel", 5]]) };
  const mid = { storeId: "mid", point: { lat: 22.62, lng: 88.42 }, available: new Map([["met", 10], ["tel", 10]]) };
  const far = { storeId: "far", point: { lat: 22.5, lng: 88.31 }, available: new Map([["met", 10], ["tel", 10]]) };

  it("computes sensible distances", () => {
    expect(haversineKm(origin, far.point)).toBeGreaterThan(12);
    expect(haversineKm(origin, near.point)).toBeLessThan(1);
  });

  it("skips a nearer store that lacks stock for any line", () => {
    expect(chooseNearestFulfillingStore(origin, [far, near, mid], [{ productId: "met", quantity: 4 }, { productId: "tel", quantity: 1 }])?.storeId).toBe("mid");
  });

  it("chooses the nearest store when it has everything", () => {
    expect(chooseNearestFulfillingStore(origin, [far, mid, near], [{ productId: "met", quantity: 2 }])?.storeId).toBe("near");
  });

  it("returns null instead of splitting when no single store can fulfil the order", () => {
    const a = { storeId: "a", point: origin, available: new Map([["met", 5]]) };
    const b = { storeId: "b", point: far.point, available: new Map([["tel", 5]]) };
    expect(chooseNearestFulfillingStore(origin, [a, b], [{ productId: "met", quantity: 1 }, { productId: "tel", quantity: 1 }])).toBeNull();
  });
});

describe("stock CSV validation", () => {
  const known = { storeCodes: new Set(["SL01", "BH01"]), skus: new Set(["MET500-G", "TEL40-G"]) };

  it("accepts valid rows, normalising case and whitespace", () => {
    const r = parseStockCsv("store_code,sku,quantity_on_hand\n sl01 , met500-g , 12\nBH01,TEL40-G,0\n", known);
    expect(r.headerErrors).toEqual([]);
    expect(r.rows.map((x) => [x.storeCode, x.sku, x.quantity, x.status])).toEqual([
      ["SL01", "MET500-G", 12, "VALID"],
      ["BH01", "TEL40-G", 0, "VALID"],
    ]);
  });

  it("reports missing columns", () => {
    expect(parseStockCsv("store,sku,qty\nSL01,MET500-G,1", known).headerErrors[0]).toMatch(/store_code.*quantity_on_hand/);
  });

  it("reports row-level errors with row numbers", () => {
    const r = parseStockCsv("store_code,sku,quantity_on_hand\nZZ01,MET500-G,1\nSL01,NOPE,1\nSL01,TEL40-G,-3\nSL01,TEL40-G,1.5\nBH01,MET500-G,\n", known);
    expect(r.rows.map((x) => [x.rowNumber, x.status])).toEqual([[1, "ERROR"], [2, "ERROR"], [3, "ERROR"], [4, "ERROR"], [5, "ERROR"]]);
    expect(r.rows[0].errorMessage).toMatch(/unknown store_code/);
    expect(r.rows[1].errorMessage).toMatch(/unknown sku/);
    expect(r.rows[2].errorMessage).toMatch(/whole number/);
  });

  it("flags duplicate store+sku rows and keeps the first", () => {
    const r = parseStockCsv("store_code,sku,quantity_on_hand\nSL01,MET500-G,5\nSL01,MET500-G,9\n", known);
    expect(r.rows.map((x) => x.status)).toEqual(["VALID", "DUPLICATE"]);
    expect(r.rows[0].quantity).toBe(5);
  });

  it("handles a UTF-8 BOM, quoted cells and blank lines", () => {
    const r = parseStockCsv('﻿store_code,sku,quantity_on_hand\n"SL01","MET500-G","7"\n\n', known);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ status: "VALID", quantity: 7 });
  });

  it("rejects an empty file", () => {
    expect(parseStockCsv("", known).headerErrors).toEqual(["The file is empty."]);
  });
});
