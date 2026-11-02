import { describe, expect, it } from "vitest";
import { findDosageText, parseUnitsPerDay } from "@/server/extraction/dosage";
import { matchToCatalogue, type CatalogueEntry } from "@/server/extraction/matcher";
import { parseOcrLines, type OcrLine } from "@/server/extraction/ocr-parser";
import { runExtraction } from "@/server/extraction/pipeline";
import {
  ExtractionProviderError,
  type PrescriptionExtractionProvider,
  type RawExtraction,
} from "@/server/extraction/types";

const catalogue: CatalogueEntry[] = [
  { id: "met500g", name: "Metformin 500 mg", molecule: "Metformin", strength: "500 mg", form: "Tablet", genericGroup: "met500", active: true },
  { id: "met500b", name: "Glucofine 500", molecule: "Metformin", strength: "500 mg", form: "Tablet", genericGroup: "met500", active: true },
  { id: "met1000", name: "Metformin 1000 mg", molecule: "Metformin", strength: "1000 mg", form: "Tablet", genericGroup: "met1000", active: true },
  { id: "tel40", name: "Telmisartan 40 mg", molecule: "Telmisartan", strength: "40 mg", form: "Tablet", genericGroup: "tel40", active: true },
  { id: "lev50", name: "Levothyroxine 50 mcg", molecule: "Levothyroxine", strength: "50 mcg", form: "Tablet", genericGroup: "lev50", active: true },
];
const thresholds = { minFieldConfidence: 0.8, minOverallConfidence: 0.75, minMatchScore: 0.85 };

const words = (text: string, confidence = 95): OcrLine => ({ words: text.split(" ").map((t) => ({ text: t, confidence })) });

describe("dosage notation", () => {
  it.each([
    ["1-0-1", 2],
    ["1-1-1", 3],
    ["0-0-1", 1],
    ["½-0-½", 1],
    ["BD", 2],
    ["once daily", 1],
    ["TDS", 3],
    ["1-0-1 (twice daily)", 2],
  ])("%s → %s per day", (text, n) => expect(parseUnitsPerDay(text)).toBe(n));

  it.each(["as directed", "SOS", "1-0-1 OD", "", null])("leaves %s for the pharmacist", (text) => {
    expect(parseUnitsPerDay(text as string | null)).toBeNull();
  });

  it("finds the notation inside a line", () => {
    expect(findDosageText(" 1-0-1 (twice daily) x 30 days")?.value).toBe("1-0-1 (twice daily)");
  });
});

describe("OCR text parsing", () => {
  it("extracts header fields and a medicine line with per-field confidence", () => {
    const raw = parseOcrLines(
      [
        words("Dr. Arindam Banerjee"),
        words("Reg. No: WBMC-DEMO-1042"),
        words("Patient: Sunita Ghosh"),
        words("Date: 03/10/2026"),
        { words: [...words("1. Tab. Metformin").words, { text: "500", confidence: 60 }, { text: "mg", confidence: 90 }, ...words("1-0-1 x 30 days").words] },
      ],
      0.9,
    );
    expect(raw.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "prescriber_name", value: "Dr. Arindam Banerjee" }),
        expect.objectContaining({ key: "prescriber_reg_no", value: "WBMC-DEMO-1042" }),
        expect.objectContaining({ key: "patient_name", value: "Sunita Ghosh" }),
        expect.objectContaining({ key: "prescription_date", value: "03/10/2026" }),
      ]),
    );
    expect(raw.lines).toHaveLength(1);
    const l = raw.lines[0];
    expect(l.medicineName).toEqual({ value: "Metformin", confidence: 0.95 });
    expect(l.strength).toEqual({ value: "500 mg", confidence: 0.6 }); // lowest word wins
    expect(l.form).toBe("Tablet");
    expect(l.dosageText.value).toBe("1-0-1");
    expect(l.durationDays.value).toBe(30);
    expect(l.quantityUnits.value).toBeNull(); // never guessed
  });

  it("does not invent a dosage or quantity that is not written", () => {
    const raw = parseOcrLines([words("2. Tab. Levothyroxine 50 mcg as directed")], 0.9);
    expect(raw.lines[0].dosageText).toEqual({ value: null, confidence: 0 });
    expect(raw.lines[0].durationDays.value).toBeNull();
    expect(raw.lines[0].quantityUnits.value).toBeNull();
  });

  it("ignores lines without a strength (banners, signatures)", () => {
    expect(parseOcrLines([words("SYNTHETIC DEMO PRESCRIPTION"), words("Signature: ______")], 0.9).lines).toEqual([]);
  });
});

describe("catalogue matching", () => {
  it("matches name + strength and prefers the product literally named", () => {
    const m = matchToCatalogue({ medicineName: "Metformin", strength: "500 mg" }, catalogue, 0.85);
    expect(m).toMatchObject({ status: "MATCHED", productId: "met500g" });
    expect(m.candidates.map((c) => c.productId)).toContain("met500b");
  });

  it("matches a brand name to the brand product", () => {
    expect(matchToCatalogue({ medicineName: "Glucofine", strength: "500mg" }, catalogue, 0.85)).toMatchObject({ status: "MATCHED", productId: "met500b" });
  });

  it("tolerates small OCR errors", () => {
    expect(matchToCatalogue({ medicineName: "Telmisarten", strength: "40 mg" }, catalogue, 0.8).status).toBe("MATCHED");
  });

  it("stays AMBIGUOUS when the strength is not legible", () => {
    const m = matchToCatalogue({ medicineName: "Metformin", strength: null }, catalogue, 0.85);
    expect(m).toMatchObject({ status: "AMBIGUOUS", productId: null });
  });

  it("does not match a strength that is not in the catalogue", () => {
    expect(matchToCatalogue({ medicineName: "Metformin", strength: "850 mg" }, catalogue, 0.85)).toMatchObject({ status: "UNMATCHED", productId: null });
  });

  it("returns UNMATCHED for an unknown medicine or missing name", () => {
    expect(matchToCatalogue({ medicineName: "Zzyzx", strength: "5 mg" }, catalogue, 0.85).status).toBe("UNMATCHED");
    expect(matchToCatalogue({ medicineName: null, strength: "5 mg" }, catalogue, 0.85).status).toBe("UNMATCHED");
  });
});

const goodRaw: RawExtraction = {
  pageConfidence: 0.93,
  fields: [{ key: "patient_name", value: "Sunita Ghosh", confidence: 0.95 }],
  lines: [
    {
      medicineName: { value: "Metformin", confidence: 0.96 },
      strength: { value: "500 mg", confidence: 0.95 },
      form: "Tablet",
      dosageText: { value: "1-0-1", confidence: 0.93 },
      durationDays: { value: 30, confidence: 0.92 },
      quantityUnits: { value: null, confidence: 0 },
    },
  ],
};

const provider = (impl: PrescriptionExtractionProvider["extract"], supports = true): PrescriptionExtractionProvider => ({
  name: "test",
  external: false,
  supports: () => supports,
  extract: impl,
});
const input = { bytes: Buffer.from("x"), mimeType: "image/png" };

describe("extraction pipeline", () => {
  it("produces a draft with matches and a derived (flagged) quantity", async () => {
    const o = await runExtraction(provider(async () => goodRaw), input, catalogue, thresholds, 1000);
    expect(o.status).toBe("SUCCEEDED");
    expect(o.lines[0]).toMatchObject({ matchStatus: "MATCHED", matchedProductId: "met500g", unitsPerDay: 2, quantityUnits: 60, quantityDerived: true });
    expect(o.overallConfidence).toBe(0.93);
  });

  it("marks low-confidence reads and asks for a re-upload", async () => {
    const low = structuredClone(goodRaw);
    low.lines[0].strength = { value: "500 mg", confidence: 0.55 };
    const o = await runExtraction(provider(async () => low), input, catalogue, thresholds, 1000);
    expect(o.status).toBe("LOW_CONFIDENCE");
    expect(o.issues[0]).toMatch(/re-upload/i);
  });

  it("treats a missing strength as low confidence (never guessed)", async () => {
    const missing = structuredClone(goodRaw);
    missing.lines[0].strength = { value: null, confidence: 0 };
    const o = await runExtraction(provider(async () => missing), input, catalogue, thresholds, 1000);
    expect(o.status).toBe("LOW_CONFIDENCE");
    expect(o.lines[0].strength).toBeNull();
    expect(o.lines[0].matchStatus).toBe("AMBIGUOUS");
  });

  it("returns UNREADABLE when no medicine lines are found", async () => {
    const o = await runExtraction(provider(async () => ({ pageConfidence: 0.2, fields: [], lines: [] })), input, catalogue, thresholds, 1000);
    expect(o.status).toBe("UNREADABLE");
    expect(o.issues[0]).toMatch(/clearer/);
  });

  it("times out gracefully", async () => {
    const slow = provider((_i, signal) => new Promise((resolve) => { const t = setTimeout(() => resolve(goodRaw), 5000); signal.addEventListener("abort", () => clearTimeout(t)); }));
    const o = await runExtraction(slow, input, catalogue, thresholds, 50);
    expect(o).toMatchObject({ status: "FAILED", errorCode: "TIMEOUT", lines: [] });
  });

  it("handles provider errors and missing configuration", async () => {
    const o1 = await runExtraction(provider(async () => { throw new Error("boom"); }), input, catalogue, thresholds, 1000);
    expect(o1).toMatchObject({ status: "FAILED", errorCode: "PROVIDER_ERROR" });
    const o2 = await runExtraction(provider(async () => { throw new ExtractionProviderError("NOT_CONFIGURED", "no key"); }), input, catalogue, thresholds, 1000);
    expect(o2).toMatchObject({ status: "FAILED", errorCode: "NOT_CONFIGURED" });
  });

  it("rejects malformed provider output", async () => {
    const bad = { fields: [], lines: [{ medicineName: "Metformin" }] } as unknown as RawExtraction;
    const o = await runExtraction(provider(async () => bad), input, catalogue, thresholds, 1000);
    expect(o).toMatchObject({ status: "FAILED", errorCode: "INVALID_RESPONSE" });
    const outOfRange = structuredClone(goodRaw);
    outOfRange.lines[0].medicineName.confidence = 7;
    expect((await runExtraction(provider(async () => outOfRange), input, catalogue, thresholds, 1000)).errorCode).toBe("INVALID_RESPONSE");
  });

  it("reports unsupported formats without calling the provider", async () => {
    let called = false;
    const o = await runExtraction(provider(async () => { called = true; return goodRaw; }, false), { ...input, mimeType: "application/pdf" }, catalogue, thresholds, 1000);
    expect(o.status).toBe("UNSUPPORTED");
    expect(called).toBe(false);
  });

  it("output carries no decision fields — a draft only", async () => {
    const o = await runExtraction(provider(async () => goodRaw), input, catalogue, thresholds, 1000);
    const keys = JSON.stringify(o);
    expect(keys).not.toMatch(/"approved|"decision|"status":"APPROVED/);
  });
});
