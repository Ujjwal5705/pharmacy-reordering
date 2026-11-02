import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import {
  ExtractionProviderError,
  HEADER_FIELD_KEYS,
  type ExtractionInput,
  type PrescriptionExtractionProvider,
  type RawExtraction,
} from "../types";

const DEFAULT_MODEL = "claude-opus-5-5";

// Wire schema for structured outputs. Bounds are re-checked by rawExtractionSchema in the pipeline.
const value = <T extends z.ZodTypeAny>(t: T) => z.object({ value: t.nullable(), confidence: z.number() });
const wireSchema = z.object({
  pageConfidence: z.number().nullable(),
  fields: z.array(z.object({ key: z.enum(HEADER_FIELD_KEYS), value: z.string().nullable(), confidence: z.number() })),
  lines: z.array(
    z.object({
      medicineName: value(z.string()),
      strength: value(z.string()),
      form: z.string().nullable(),
      dosageText: value(z.string()),
      durationDays: value(z.number().int()),
      quantityUnits: value(z.number().int()),
    }),
  ),
});

const SYSTEM = `You transcribe Indian medical prescriptions for a pharmacy's internal verification queue.
A registered pharmacist reviews every result; you are not giving medical advice.

Rules:
- Copy only what is visibly written. If a value is missing, crossed out or illegible, return null for it.
- Never infer, correct or complete a medicine name, strength, dosage, duration or quantity.
- Do not convert dosage notation; copy it as written (for example "1-0-1" or "BD").
- quantityUnits is only an explicitly written total quantity (e.g. "Qty 60", "#30"); otherwise null.
- durationDays only when a duration in days or weeks is written; weeks multiply by 7; otherwise null.
- confidence is your probability (0..1) that the transcribed value is exactly what is written.
- pageConfidence reflects how legible the document is overall.
- fields: patient_name, prescriber_name, prescriber_reg_no, prescriber_address, prescription_date (as written).
- If the image is not a prescription, return empty lines.`;

/**
 * Claude vision adapter. Sends the prescription to Anthropic's API, so it only runs when
 * EXTRACTION_PROVIDER=anthropic AND ALLOW_EXTERNAL_PRESCRIPTION_PROCESSING=true are both set.
 */
export class AnthropicVisionProvider implements PrescriptionExtractionProvider {
  readonly name = "anthropic";
  readonly external = true;
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(opts: { apiKey?: string; model?: string; client?: Anthropic }) {
    if (!opts.client && !opts.apiKey) {
      throw new ExtractionProviderError("NOT_CONFIGURED", "ANTHROPIC_API_KEY is not set");
    }
    this.client = opts.client ?? new Anthropic({ apiKey: opts.apiKey, maxRetries: 1 });
    this.model = opts.model || DEFAULT_MODEL;
  }

  supports(mimeType: string) {
    return ["image/png", "image/jpeg", "application/pdf"].includes(mimeType);
  }

  async extract(input: ExtractionInput, signal: AbortSignal): Promise<RawExtraction> {
    const data = input.bytes.toString("base64");
    const source =
      input.mimeType === "application/pdf"
        ? ({ type: "document", source: { type: "base64", media_type: "application/pdf", data } } as const)
        : ({
            type: "image",
            source: { type: "base64", media_type: input.mimeType as "image/png" | "image/jpeg", data },
          } as const);

    let response;
    try {
      response = await this.client.beta.messages.parse(
        {
          model: this.model,
          max_tokens: 16000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          output_config: { effort: "medium", format: betaZodOutputFormat(wireSchema) },
          system: SYSTEM,
          messages: [
            {
              role: "user",
              content: [source, { type: "text", text: "Transcribe this prescription into the required JSON." }],
            },
          ],
        },
        { signal },
      );
    } catch (e) {
      if (signal.aborted || e instanceof Anthropic.APIUserAbortError) {
        throw new ExtractionProviderError("TIMEOUT", "Anthropic request aborted");
      }
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
        throw new ExtractionProviderError("NOT_CONFIGURED", "Anthropic credentials rejected");
      }
      if (e instanceof Anthropic.APIError || e instanceof Anthropic.APIConnectionError) {
        throw new ExtractionProviderError("PROVIDER_ERROR", "Anthropic API error");
      }
      throw new ExtractionProviderError("INVALID_RESPONSE", "Anthropic response could not be parsed");
    }

    if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") {
      throw new ExtractionProviderError("PROVIDER_ERROR", `Anthropic stopped: ${response.stop_reason}`);
    }
    if (!response.parsed_output) {
      throw new ExtractionProviderError("INVALID_RESPONSE", "Anthropic returned no structured output");
    }
    return response.parsed_output;
  }
}
