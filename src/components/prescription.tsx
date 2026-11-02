import type { ExtractedField, ExtractedLine, ExtractionRun, Product } from "@prisma/client";
import { Bot } from "lucide-react";
import { ConfidenceBadge } from "./status";
import { Alert, Badge } from "./ui";

export type RunWithDetail = ExtractionRun & { lines: (ExtractedLine & { matchedProduct: Product | null })[]; fields: ExtractedField[] };

export const FIELD_LABEL: Record<string, string> = {
  patient_name: "Patient name",
  prescriber_name: "Prescriber",
  prescriber_reg_no: "Prescriber reg. no.",
  prescriber_address: "Clinic / address",
  prescription_date: "Prescription date",
};

export function extractionHeadline(run: ExtractionRun | null | undefined): { tone: "ok" | "warn" | "info" | "bad"; title: string; body: string } {
  switch (run?.status) {
    case "SUCCEEDED":
      return { tone: "ok", title: "Prescription read", body: "This is an automated draft. A registered pharmacist will compare it with your prescription before approving anything." };
    case "LOW_CONFIDENCE":
      return { tone: "warn", title: "We couldn’t read this clearly", body: "Parts of the prescription are hard to read. Please re-upload a sharper, well-lit photo of the whole page. You can still send it for the pharmacist to read manually." };
    case "UNREADABLE":
      return { tone: "warn", title: "No medicines could be read", body: "Please upload a clearer photo showing the whole prescription, flat and in good light. You can still send it for the pharmacist to read manually." };
    case "UNSUPPORTED":
      return { tone: "info", title: "A pharmacist will read this file", body: "This file type is not read automatically. The pharmacist will read it directly." };
    case "FAILED":
    case "SKIPPED":
      return { tone: "info", title: "Automatic reading unavailable", body: "A pharmacist will read the prescription manually. Nothing is approved automatically." };
    default:
      return { tone: "info", title: "Not read yet", body: "A pharmacist will read the prescription." };
  }
}

/** Draft read-out of a prescription with per-field confidence. Used on checkout (read-only). */
export function ExtractionDraft({ run, compact = false }: { run: RunWithDetail | null; compact?: boolean }) {
  const head = extractionHeadline(run);
  return (
    <div className="space-y-3" data-testid="extraction-draft">
      <Alert tone={head.tone} title={head.title}>
        {head.body}
      </Alert>
      {run && run.lines.length ? (
        <div className="rounded-xl border border-line">
          <div className="flex items-center gap-2 border-b border-line bg-canvas px-4 py-2 text-sm font-semibold text-ink-soft">
            <Bot aria-hidden className="size-4" /> Automated draft · {run.provider} · overall <ConfidenceBadge value={run.overallConfidence ? Number(run.overallConfidence) : null} />
          </div>
          <ul className="divide-y divide-line">
            {run.lines.map((l) => (
              <li key={l.id} className="px-4 py-3 text-[15px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{l.medicineName ?? "Name not legible"}</span>
                  <span>{l.strength ?? "strength not legible"}</span>
                  <ConfidenceBadge value={Math.min(Number(l.nameConfidence), Number(l.strengthConfidence))} />
                </div>
                {!compact ? (
                  <p className="mt-0.5 text-muted">
                    As written: {l.dosageText ?? "dosage not stated"}
                    {l.durationDays ? ` · ${l.durationDays} days` : ""}
                    {l.matchedProduct ? ` · matches ${l.matchedProduct.name}` : l.matchStatus === "AMBIGUOUS" ? " · several possible products" : " · no catalogue match"}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {run && run.fields.length && !compact ? (
        <div className="flex flex-wrap gap-2 text-sm">
          {run.fields.filter((f) => f.value).map((f) => (
            <Badge key={f.id} tone="neutral">
              {FIELD_LABEL[f.key] ?? f.key}: {f.value}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * `viewKey` is a per-render value from the server page. A new URL on every render stops the browser
 * reusing an image it fetched earlier in the same tab, so each display reaches the server and is
 * audited. Lazy loading means a collapsed preview is only fetched (and logged) when opened.
 */
export function PrescriptionPreview({ id, mimeType, alt, className, viewKey }: { id: string; mimeType: string; alt: string; className?: string; viewKey: string }) {
  const src = `/api/prescriptions/${id}/file?view=${viewKey}`;
  if (mimeType === "application/pdf") {
    return <iframe src={src} title={alt} loading="lazy" className={className ?? "h-[70vh] w-full rounded-xl border border-line bg-white"} />;
  }
  // eslint-disable-next-line @next/next/no-img-element -- authenticated, non-cacheable private file
  return <img src={src} alt={alt} loading="lazy" className={className ?? "w-full rounded-xl border border-line bg-white"} />;
}
