import { parseUnitsPerDay } from "./dosage";
import { matchToCatalogue, type CatalogueEntry } from "./matcher";
import {
  ExtractionProviderError,
  rawExtractionSchema,
  type ExtractedLineResult,
  type ExtractionInput,
  type ExtractionOutcome,
  type ExtractionThresholds,
  type PrescriptionExtractionProvider,
} from "./types";

/**
 * Runs one provider with a timeout and turns its output into a draft for pharmacist review.
 * Never throws: every failure becomes a status that routes the prescription to manual review.
 * The outcome is advisory only — nothing here can approve an item, order or substitution.
 */
export async function runExtraction(
  provider: PrescriptionExtractionProvider,
  input: ExtractionInput,
  catalogue: CatalogueEntry[],
  thresholds: ExtractionThresholds,
  timeoutMs: number,
): Promise<ExtractionOutcome> {
  const started = Date.now();
  const base = { provider: provider.name, fields: [], lines: [], overallConfidence: null };

  if (!provider.supports(input.mimeType)) {
    return {
      ...base,
      status: "UNSUPPORTED",
      errorCode: "UNSUPPORTED_FORMAT",
      durationMs: 0,
      issues: ["This file type cannot be read automatically. A pharmacist will read it manually."],
    };
  }

  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  let raw: unknown;
  try {
    raw = await Promise.race([
      provider.extract(input, controller.signal),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new ExtractionProviderError("TIMEOUT", "Extraction timed out"));
        }, timeoutMs);
      }),
    ]);
  } catch (e) {
    const code = e instanceof ExtractionProviderError ? e.code : "PROVIDER_ERROR";
    return {
      ...base,
      status: "FAILED",
      errorCode: code,
      durationMs: Date.now() - started,
      issues: [
        code === "TIMEOUT"
          ? "Automatic reading took too long. A pharmacist will read the prescription manually."
          : "Automatic reading is unavailable right now. A pharmacist will read the prescription manually.",
      ],
    };
  } finally {
    if (timer) clearTimeout(timer);
  }

  const parsed = rawExtractionSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ...base,
      status: "FAILED",
      errorCode: "INVALID_RESPONSE",
      durationMs: Date.now() - started,
      issues: ["Automatic reading returned an unusable result. A pharmacist will read it manually."],
    };
  }
  const data = parsed.data;
  const durationMs = Date.now() - started;

  if (data.lines.length === 0) {
    return {
      ...base,
      fields: data.fields,
      status: "UNREADABLE",
      errorCode: null,
      overallConfidence: data.pageConfidence ?? 0,
      durationMs,
      issues: ["No medicines could be read. Please upload a clearer, well-lit photo of the whole prescription."],
    };
  }

  const issues: string[] = [];
  const lines: ExtractedLineResult[] = data.lines.map((l, lineIndex) => {
    const match = matchToCatalogue(
      { medicineName: l.medicineName.value, strength: l.strength.value },
      catalogue,
      thresholds.minMatchScore,
    );
    const unitsPerDay = parseUnitsPerDay(l.dosageText.value);
    // Arithmetic on two written values only; flagged as derived so the pharmacist sees the basis.
    const derivedQty =
      l.quantityUnits.value === null && unitsPerDay !== null && l.durationDays.value !== null
        ? Math.ceil(unitsPerDay * l.durationDays.value)
        : null;
    return {
      lineIndex,
      medicineName: l.medicineName.value,
      nameConfidence: l.medicineName.confidence,
      strength: l.strength.value,
      strengthConfidence: l.strength.confidence,
      form: l.form ?? null,
      dosageText: l.dosageText.value,
      unitsPerDay,
      dosageConfidence: l.dosageText.confidence,
      durationDays: l.durationDays.value,
      durationConfidence: l.durationDays.confidence,
      quantityUnits: l.quantityUnits.value ?? derivedQty,
      quantityConfidence:
        l.quantityUnits.value !== null
          ? l.quantityUnits.confidence
          : derivedQty !== null
            ? Math.min(l.dosageText.confidence, l.durationDays.confidence)
            : 0,
      quantityDerived: l.quantityUnits.value === null && derivedQty !== null,
      matchStatus: match.status,
      matchedProductId: match.productId,
      matchScore: match.score,
      matchReason: match.reason,
      candidates: match.candidates,
    };
  });

  const lineScores = lines.map((l) => Math.min(l.nameConfidence, l.strengthConfidence));
  const overall = Math.min(...lineScores, data.pageConfidence ?? 1);
  const lowField = lines.some(
    (l) =>
      !l.medicineName ||
      !l.strength ||
      l.nameConfidence < thresholds.minFieldConfidence ||
      l.strengthConfidence < thresholds.minFieldConfidence,
  );
  if (lowField) issues.push("Some medicine names or strengths are hard to read.");
  if (lines.some((l) => !l.dosageText)) issues.push("Dosage is not legible on every line; the pharmacist will confirm it.");
  if (lines.some((l) => l.matchStatus !== "MATCHED")) issues.push("Some medicines could not be matched to a single product.");

  const low = lowField || overall < thresholds.minOverallConfidence;
  return {
    provider: provider.name,
    status: low ? "LOW_CONFIDENCE" : "SUCCEEDED",
    overallConfidence: round3(overall),
    errorCode: null,
    durationMs,
    fields: data.fields,
    lines,
    issues: low ? ["The prescription is not clear enough to read reliably. Please re-upload a sharper photo.", ...issues] : issues,
  };
}

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}
