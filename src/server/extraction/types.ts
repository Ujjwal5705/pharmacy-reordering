import { z } from "zod";

export const HEADER_FIELD_KEYS = [
  "patient_name",
  "prescriber_name",
  "prescriber_reg_no",
  "prescriber_address",
  "prescription_date",
] as const;
export type HeaderFieldKey = (typeof HEADER_FIELD_KEYS)[number];

const confidence = z.number().min(0).max(1);
const field = <T extends z.ZodTypeAny>(value: T) => z.object({ value: value.nullable(), confidence });

/**
 * What a provider is allowed to return: only values visibly present on the prescription,
 * each with a confidence. Anything not legible must be null — providers must not fill gaps.
 */
export const rawExtractionSchema = z.object({
  pageConfidence: confidence.nullable().optional(),
  fields: z
    .array(z.object({ key: z.enum(HEADER_FIELD_KEYS), value: z.string().max(200).nullable(), confidence }))
    .max(HEADER_FIELD_KEYS.length),
  lines: z
    .array(
      z.object({
        medicineName: field(z.string().min(1).max(120)),
        strength: field(z.string().min(1).max(40)),
        form: z.string().max(40).nullable().optional(),
        dosageText: field(z.string().min(1).max(120)),
        durationDays: field(z.number().int().positive().max(366)),
        quantityUnits: field(z.number().int().positive().max(10_000)),
      }),
    )
    .max(20),
});
export type RawExtraction = z.infer<typeof rawExtractionSchema>;

export type ExtractionInput = { bytes: Buffer; mimeType: string };

export interface PrescriptionExtractionProvider {
  readonly name: string;
  /** True if prescription content is sent outside this server. Must be opted into explicitly. */
  readonly external: boolean;
  supports(mimeType: string): boolean;
  extract(input: ExtractionInput, signal: AbortSignal): Promise<RawExtraction>;
}

export class ExtractionProviderError extends Error {
  constructor(
    public readonly code: "NOT_CONFIGURED" | "PROVIDER_ERROR" | "INVALID_RESPONSE" | "TIMEOUT",
    message: string,
  ) {
    super(message);
    this.name = "ExtractionProviderError";
  }
}

export type MatchCandidate = { productId: string; label: string; score: number; reason: string };

export type ExtractedLineResult = {
  lineIndex: number;
  medicineName: string | null;
  nameConfidence: number;
  strength: string | null;
  strengthConfidence: number;
  form: string | null;
  dosageText: string | null;
  unitsPerDay: number | null;
  dosageConfidence: number;
  durationDays: number | null;
  durationConfidence: number;
  quantityUnits: number | null;
  quantityConfidence: number;
  quantityDerived: boolean;
  matchStatus: "MATCHED" | "AMBIGUOUS" | "UNMATCHED";
  matchedProductId: string | null;
  matchScore: number | null;
  matchReason: string;
  candidates: MatchCandidate[];
};

export type ExtractionOutcome = {
  provider: string;
  status: "SUCCEEDED" | "LOW_CONFIDENCE" | "UNREADABLE" | "FAILED" | "UNSUPPORTED" | "SKIPPED";
  overallConfidence: number | null;
  errorCode: string | null;
  durationMs: number;
  fields: { key: HeaderFieldKey; value: string | null; confidence: number }[];
  lines: ExtractedLineResult[];
  /** Plain-language reasons shown to customer and pharmacist. No prescription content. */
  issues: string[];
};

export type ExtractionThresholds = { minFieldConfidence: number; minOverallConfidence: number; minMatchScore: number };
