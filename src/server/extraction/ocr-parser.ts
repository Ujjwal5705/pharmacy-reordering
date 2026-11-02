import { findDosageText, findDuration, findQuantity } from "./dosage";
import type { HeaderFieldKey, RawExtraction } from "./types";

export type OcrWord = { text: string; confidence: number };
export type OcrLine = { words: OcrWord[] };

const STRENGTH_RE = /(\d+(?:\.\d+)?)\s?(mg|mcg|µg|ug|g|ml|iu)\b/i;
const FORM_PREFIX_RE = /^(?:\d+[.)]\s*)?(?:rx\s*)?(tab(?:let)?s?|cap(?:sule)?s?|syp|syrup|inj)\.?\s+/i;

/** Joins words with single spaces and remembers each word's character span. */
function lineWithSpans(line: OcrLine) {
  let text = "";
  const spans: { start: number; end: number; confidence: number }[] = [];
  for (const w of line.words) {
    const t = w.text.trim();
    if (!t) continue;
    if (text) text += " ";
    spans.push({ start: text.length, end: text.length + t.length, confidence: clamp01(w.confidence / 100) });
    text += t;
  }
  return { text, spans };
}

/** Confidence of a substring = lowest confidence among the OCR words it touches. */
function spanConfidence(spans: { start: number; end: number; confidence: number }[], start: number, end: number) {
  const touched = spans.filter((s) => s.end > start && s.start < end);
  return touched.length ? Math.min(...touched.map((s) => s.confidence)) : 0;
}

const HEADER_PATTERNS: { key: HeaderFieldKey; re: RegExp }[] = [
  { key: "patient_name", re: /^(?:patient(?:'s)?\s*name|patient|pt\.?\s*name|name)\s*[:\-]\s*(.{2,80})$/i },
  { key: "prescriber_reg_no", re: /\breg(?:istration)?\.?\s*(?:no\.?|number)?\s*[:\-]\s*([A-Z0-9][A-Z0-9\-/]{2,30})/i },
  { key: "prescription_date", re: /\bdate\s*[:\-]\s*(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})/i },
  { key: "prescriber_address", re: /^(?:clinic|address)\s*[:\-]\s*(.{4,120})$/i },
  { key: "prescriber_name", re: /^(dr\.?\s+[A-Za-z][A-Za-z.\s]{2,60}?)(?:\s*[,(|]|$)/i },
];

/**
 * Turns OCR lines into the raw extraction schema. Values are copied verbatim from what was read;
 * if a field is not on the line it stays null. Quantity is only taken when written explicitly.
 */
export function parseOcrLines(lines: OcrLine[], pageConfidence: number | null): RawExtraction {
  const fields = new Map<HeaderFieldKey, { value: string; confidence: number }>();
  const meds: RawExtraction["lines"] = [];

  for (const line of lines) {
    const { text, spans } = lineWithSpans(line);
    if (text.length < 3) continue;

    for (const { key, re } of HEADER_PATTERNS) {
      if (fields.has(key)) continue;
      const m = re.exec(text);
      if (m) {
        const start = m.index + m[0].indexOf(m[1]);
        fields.set(key, { value: m[1].trim(), confidence: spanConfidence(spans, start, start + m[1].length) });
      }
    }

    const strength = STRENGTH_RE.exec(text);
    if (!strength) continue;
    const beforeStrength = text.slice(0, strength.index);
    const formMatch = FORM_PREFIX_RE.exec(beforeStrength);
    const nameStart = formMatch ? formMatch[0].length : (/^\d+[.)]\s*/.exec(beforeStrength)?.[0].length ?? 0);
    const name = beforeStrength.slice(nameStart).replace(/[^A-Za-z0-9\s\-]/g, " ").replace(/\s+/g, " ").trim();
    if (!/[A-Za-z]{3,}/.test(name)) continue;

    const nameOffset = text.indexOf(name, nameStart);
    const rest = text.slice(strength.index + strength[0].length);
    const restOffset = strength.index + strength[0].length;
    const dosage = findDosageText(rest);
    const duration = findDuration(rest);
    const quantity = findQuantity(rest);

    meds.push({
      medicineName: { value: name, confidence: spanConfidence(spans, nameOffset, nameOffset + name.length) },
      strength: {
        value: `${strength[1]} ${normaliseUnit(strength[2])}`,
        confidence: spanConfidence(spans, strength.index, strength.index + strength[0].length),
      },
      form: formMatch ? normaliseForm(formMatch[1]) : null,
      dosageText: dosage
        ? { value: dosage.value, confidence: spanConfidence(spans, restOffset + dosage.start, restOffset + dosage.end) }
        : { value: null, confidence: 0 },
      durationDays: duration
        ? { value: duration.days, confidence: spanConfidence(spans, restOffset + duration.start, restOffset + duration.end) }
        : { value: null, confidence: 0 },
      quantityUnits: quantity
        ? { value: quantity.units, confidence: spanConfidence(spans, restOffset + quantity.start, restOffset + quantity.end) }
        : { value: null, confidence: 0 },
    });
  }

  return {
    pageConfidence,
    fields: [...fields.entries()].map(([key, f]) => ({ key, value: f.value, confidence: f.confidence })),
    lines: meds.slice(0, 20),
  };
}

export function normaliseUnit(u: string) {
  const l = u.toLowerCase();
  if (l === "µg" || l === "ug") return "mcg";
  if (l === "iu") return "IU";
  return l;
}

function normaliseForm(f: string) {
  const l = f.toLowerCase();
  if (l.startsWith("tab")) return "Tablet";
  if (l.startsWith("cap")) return "Capsule";
  if (l.startsWith("sy")) return "Syrup";
  return "Injection";
}

function clamp01(n: number) {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}
