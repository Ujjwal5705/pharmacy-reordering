import Papa from "papaparse";

export const STOCK_CSV_HEADERS = ["store_code", "sku", "quantity_on_hand"] as const;
export const MAX_STOCK_ROWS = 20_000;
export const MAX_QUANTITY = 100_000;

export type StockRow = {
  rowNumber: number;
  storeCode: string;
  sku: string;
  quantity: number | null;
  status: "VALID" | "ERROR" | "DUPLICATE";
  errorMessage: string | null;
};

export type StockCsvResult = { headerErrors: string[]; rows: StockRow[] };

/**
 * Parses and validates a daily stock snapshot. Row numbers are 1-based data rows (header excluded).
 * The first occurrence of a store+sku pair wins; later ones are flagged DUPLICATE and skipped.
 */
export function parseStockCsv(text: string, known: { storeCodes: Set<string>; skus: Set<string> }): StockCsvResult {
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: "greedy" });
  const data = parsed.data;
  if (data.length === 0) return { headerErrors: ["The file is empty."], rows: [] };

  const header = data[0].map((h) => h.trim().toLowerCase());
  const missing = STOCK_CSV_HEADERS.filter((h) => !header.includes(h));
  if (missing.length) {
    return { headerErrors: [`Missing required column(s): ${missing.join(", ")}.`], rows: [] };
  }
  if (data.length - 1 > MAX_STOCK_ROWS) {
    return { headerErrors: [`Too many rows (max ${MAX_STOCK_ROWS}).`], rows: [] };
  }
  const idx = Object.fromEntries(STOCK_CSV_HEADERS.map((h) => [h, header.indexOf(h)])) as Record<
    (typeof STOCK_CSV_HEADERS)[number],
    number
  >;

  const seen = new Set<string>();
  const rows: StockRow[] = data.slice(1).map((cells, i) => {
    const rowNumber = i + 1;
    const storeCode = (cells[idx.store_code] ?? "").trim().toUpperCase();
    const sku = (cells[idx.sku] ?? "").trim().toUpperCase();
    const rawQty = (cells[idx.quantity_on_hand] ?? "").trim();
    const errors: string[] = [];

    if (!storeCode) errors.push("store_code is empty");
    else if (!known.storeCodes.has(storeCode)) errors.push(`unknown store_code "${storeCode}"`);
    if (!sku) errors.push("sku is empty");
    else if (!known.skus.has(sku)) errors.push(`unknown sku "${sku}"`);

    let quantity: number | null = null;
    if (!/^\d+$/.test(rawQty)) errors.push("quantity_on_hand must be a whole number ≥ 0");
    else {
      quantity = Number(rawQty);
      if (quantity > MAX_QUANTITY) errors.push(`quantity_on_hand exceeds ${MAX_QUANTITY}`);
    }

    if (errors.length) {
      return { rowNumber, storeCode, sku, quantity, status: "ERROR", errorMessage: errors.join("; ") };
    }
    const key = `${storeCode}::${sku}`;
    if (seen.has(key)) {
      return {
        rowNumber,
        storeCode,
        sku,
        quantity,
        status: "DUPLICATE",
        errorMessage: "duplicate store_code + sku; first row in the file is used",
      };
    }
    seen.add(key);
    return { rowNumber, storeCode, sku, quantity, status: "VALID", errorMessage: null };
  });

  return { headerErrors: [], rows };
}
