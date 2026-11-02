import type { AppConfig } from "../env";
import { AnthropicVisionProvider } from "./providers/anthropic";
import { FixtureProvider } from "./providers/fixture";
import { LocalOcrProvider } from "./providers/local-ocr";
import { ExtractionProviderError, type PrescriptionExtractionProvider, type RawExtraction } from "./types";

/** Used when extraction is switched off or misconfigured: every prescription goes to manual review. */
class DisabledProvider implements PrescriptionExtractionProvider {
  readonly external = false;
  constructor(
    readonly name: string,
    private readonly code: "NOT_CONFIGURED",
  ) {}
  supports() {
    return true;
  }
  async extract(): Promise<RawExtraction> {
    throw new ExtractionProviderError(this.code, "Extraction disabled");
  }
}

let override: PrescriptionExtractionProvider | null = null;

/** Tests can inject a provider (e.g. one that times out or returns malformed JSON). */
export function setExtractionProviderOverride(p: PrescriptionExtractionProvider | null) {
  override = p;
}

export function getExtractionProvider(cfg: AppConfig): PrescriptionExtractionProvider {
  if (override) return override;
  switch (cfg.EXTRACTION_PROVIDER) {
    case "local-ocr":
      return new LocalOcrProvider();
    case "fixture":
      return new FixtureProvider();
    case "anthropic":
      // External processing of health data is opt-in, never implied by the presence of a key.
      if (!cfg.ALLOW_EXTERNAL_PRESCRIPTION_PROCESSING || !cfg.ANTHROPIC_API_KEY) {
        return new DisabledProvider("anthropic (not enabled)", "NOT_CONFIGURED");
      }
      return new AnthropicVisionProvider({ apiKey: cfg.ANTHROPIC_API_KEY, model: cfg.ANTHROPIC_MODEL });
    case "none":
      return new DisabledProvider("none", "NOT_CONFIGURED");
  }
}
