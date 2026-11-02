import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ExtractionInput, PrescriptionExtractionProvider, RawExtraction } from "../types";

type Manifest = { fixtures: { file: string; sha256: string; transcription: RawExtraction }[] };

/**
 * Deterministic provider for automated tests: returns the recorded ground-truth transcription of
 * a synthetic fixture image (matched by SHA-256), and "nothing legible" for any other file.
 */
export class FixtureProvider implements PrescriptionExtractionProvider {
  readonly name = "fixture";
  readonly external = false;
  private readonly byHash: Map<string, RawExtraction>;

  constructor(manifest?: Manifest) {
    const m =
      manifest ??
      (JSON.parse(
        readFileSync(path.join(process.cwd(), "fixtures", "prescriptions", "manifest.json"), "utf8"),
      ) as Manifest);
    this.byHash = new Map(m.fixtures.map((f) => [f.sha256, f.transcription]));
  }

  supports(mimeType: string) {
    return mimeType === "image/png" || mimeType === "image/jpeg";
  }

  async extract(input: ExtractionInput): Promise<RawExtraction> {
    const hash = createHash("sha256").update(input.bytes).digest("hex");
    return this.byHash.get(hash) ?? { pageConfidence: 0.2, fields: [], lines: [] };
  }
}
