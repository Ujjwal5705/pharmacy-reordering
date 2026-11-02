/**
 * Reads a written frequency into units per day. Only explicit, unambiguous notations are
 * recognised; anything else returns null so the pharmacist confirms it. This never suggests a dose.
 */
const WORD_FREQUENCIES: [RegExp, number][] = [
  [/\b(?:od|o\.d\.|once\s+(?:a\s+)?daily|once\s+a\s+day)\b/i, 1],
  [/\b(?:bd|b\.d\.|bid|twice\s+(?:a\s+)?daily|twice\s+a\s+day)\b/i, 2],
  [/\b(?:tds|t\.d\.s\.|tid|thrice\s+daily|three\s+times\s+a\s+day)\b/i, 3],
  [/\b(?:qid|q\.i\.d\.|four\s+times\s+a\s+day)\b/i, 4],
];

export function parseUnitsPerDay(dosageText: string | null): number | null {
  if (!dosageText) return null;
  const found = new Set<number>();
  // Morning-afternoon-night notation, e.g. 1-0-1 or 1-1-1 (each digit 0..4, or ½).
  const man = dosageText.match(/(?<![\d.])([0-4](?:\.5)?|½)\s*[-–]\s*([0-4](?:\.5)?|½)\s*[-–]\s*([0-4](?:\.5)?|½)(?![\d.])/);
  if (man) {
    const v = (s: string) => (s === "½" ? 0.5 : Number(s));
    const sum = v(man[1]) + v(man[2]) + v(man[3]);
    if (sum > 0) found.add(sum);
  }
  for (const [re, n] of WORD_FREQUENCIES) if (re.test(dosageText)) found.add(n);
  // Conflicting notations (e.g. "1-0-1 OD") are ambiguous: leave for the pharmacist.
  return found.size === 1 ? [...found][0] : null;
}

/** Extracts the written frequency fragment from a medicine line, if any. */
export function findDosageText(text: string): { value: string; start: number; end: number } | null {
  const patterns = [
    /(?<![\d.])(?:[0-4](?:\.5)?|½)\s*[-–]\s*(?:[0-4](?:\.5)?|½)\s*[-–]\s*(?:[0-4](?:\.5)?|½)(?![\d.])(?:\s*\([^)]{0,30}\))?/,
    /\b(?:od|bd|bid|tds|tid|qid|once\s+(?:a\s+)?daily|twice\s+(?:a\s+)?daily|thrice\s+daily|once\s+a\s+day|twice\s+a\s+day|three\s+times\s+a\s+day|four\s+times\s+a\s+day)\b/i,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) return { value: m[0].trim(), start: m.index, end: m.index + m[0].length };
  }
  return null;
}

export function findDuration(text: string): { days: number; start: number; end: number } | null {
  const m = /(?:\bx|×|\bfor)\s*(\d{1,3})\s*(days?|d|weeks?|wks?)\b/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  const days = /^w/i.test(m[2]) ? n * 7 : n;
  if (days <= 0 || days > 366) return null;
  return { days, start: m.index, end: m.index + m[0].length };
}

export function findQuantity(text: string): { units: number; start: number; end: number } | null {
  const m = /(?:\bqty|\bquantity|#)\s*[:.\-]?\s*(\d{1,4})\b/i.exec(text);
  if (!m) return null;
  const units = Number(m[1]);
  if (units <= 0) return null;
  return { units, start: m.index, end: m.index + m[0].length };
}
