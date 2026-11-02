import path from "node:path";
import { createWorker } from "tesseract.js";
import { parseOcrLines, type OcrLine } from "../ocr-parser";
import {
  ExtractionProviderError,
  type ExtractionInput,
  type PrescriptionExtractionProvider,
  type RawExtraction,
} from "../types";

/**
 * Tesseract (WASM) running inside this server process. The prescription never leaves the machine.
 * The English model ships in node_modules (@tesseract.js-data/eng), so no network access is needed.
 * Works well on printed text; handwriting usually comes back low-confidence and goes to manual review.
 */
export class LocalOcrProvider implements PrescriptionExtractionProvider {
  readonly name = "local-ocr";
  readonly external = false;

  supports(mimeType: string) {
    return mimeType === "image/png" || mimeType === "image/jpeg";
  }

  async extract(input: ExtractionInput, signal: AbortSignal): Promise<RawExtraction> {
    const langPath = path.join(process.cwd(), "node_modules", "@tesseract.js-data", "eng", "4.0.0_best_int");
    let worker: Awaited<ReturnType<typeof createWorker>> | null = null;
    const onAbort = () => void worker?.terminate();
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      worker = await createWorker("eng", 1, {
        langPath,
        gzip: true,
        cacheMethod: "none",
        logger: () => {},
        errorHandler: () => {},
      });
      if (signal.aborted) throw new ExtractionProviderError("TIMEOUT", "aborted");
      const { data } = await worker.recognize(input.bytes, {}, { blocks: true, text: false });
      const lines: OcrLine[] = [];
      for (const block of data.blocks ?? []) {
        for (const para of block.paragraphs) {
          for (const line of para.lines) {
            lines.push({ words: line.words.map((w) => ({ text: w.text, confidence: w.confidence })) });
          }
        }
      }
      return parseOcrLines(lines, Number.isFinite(data.confidence) ? data.confidence / 100 : null);
    } catch (e) {
      if (e instanceof ExtractionProviderError) throw e;
      throw new ExtractionProviderError(signal.aborted ? "TIMEOUT" : "PROVIDER_ERROR", "Local OCR failed");
    } finally {
      signal.removeEventListener("abort", onAbort);
      await worker?.terminate().catch(() => {});
    }
  }
}
