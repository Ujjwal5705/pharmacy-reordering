import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Bot, History } from "lucide-react";
import { FIELD_LABEL, extractionHeadline } from "@/components/prescription";
import { PrescriptionViewer } from "@/components/staff/prescription-viewer";
import { CATEGORY_LABEL, ConfidenceBadge, ItemStatusBadge, OrderStatusBadge } from "@/components/status";
import { Alert, Badge, Card, CardHeader, KeyValue } from "@/components/ui";
import { requirePageRole } from "@/server/auth/session";
import { config } from "@/server/env";
import { isDomainError } from "@/server/errors";
import { normaliseName, normaliseStrength } from "@/server/extraction/matcher";
import { getReviewContext } from "@/server/queries/staff";
import { recordReviewOpened } from "@/server/services/review";
import { addressWithArea, age, dateTime, money } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import { ReviewForm, type ReviewItem } from "./review-form";

export const metadata: Metadata = { title: "Prescription review" };

/** "03/10/2026" → "2026-10-03" when it is a real calendar date; otherwise empty (pharmacist enters it). */
function toIsoDate(v: string | null | undefined) {
  const m = v ? /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v) : null;
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  return d.getUTCDate() === Number(m[1]) ? d.toISOString().slice(0, 10) : "";
}

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageRole(["PHARMACIST"]);
  const t = await getT();
  const { id } = await params;
  const ctx = await getReviewContext(actor, id).catch((e) => {
    if (isDomainError(e)) notFound();
    throw e;
  });
  const { order, alternatives, audit } = ctx;
  if (order.status === "AWAITING_PHARMACIST") await recordReviewOpened(actor, order.id);
  const run = order.prescription?.extractionRuns[0] ?? null;
  const head = extractionHeadline(run);
  const field = (k: string) => run?.fields.find((f) => f.key === k);
  const threshold = config().EXTRACTION_MIN_FIELD_CONFIDENCE;

  const items: ReviewItem[] = order.items.map((i) => {
    const line = run?.lines.find(
      (l) =>
        (l.matchedProduct?.genericGroup && l.matchedProduct.genericGroup === i.product.genericGroup) ||
        (l.medicineName && normaliseName(l.medicineName) === normaliseName(i.product.molecule) && normaliseStrength(l.strength) === normaliseStrength(i.product.strength)),
    );
    return {
      id: i.id,
      name: i.product.name,
      detail: `${i.product.molecule} ${i.product.strength} · ${i.product.form} · ${i.product.packLabel}`,
      unitsPerPack: i.product.unitsPerPack,
      quantity: i.quantity,
      category: CATEGORY_LABEL[i.category],
      status: i.status,
      h1: i.h1RegisterRequired,
      rx: i.prescriptionRequired,
      pricePaise: i.unitPricePaise,
      match: line
        ? {
            lineNo: line.lineIndex + 1,
            text: `${line.medicineName ?? "?"} ${line.strength ?? ""}`.trim(),
            dosageText: line.dosageText,
            unitsPerDay: line.unitsPerDay === null ? null : Number(line.unitsPerDay),
            durationDays: line.durationDays,
            quantityUnits: line.quantityUnits,
            quantityDerived: line.quantityDerived,
            confidence: Math.min(Number(line.nameConfidence), Number(line.strengthConfidence)),
            dosageConfidence: Number(line.dosageConfidence),
          }
        : null,
      alternatives: alternatives
        .filter((a) => a.genericGroup && a.genericGroup === i.product.genericGroup && a.id !== i.productId && a.orderable && a.isGeneric)
        .map((a) => ({ id: a.id, label: `${a.name} (generic) — ${money(a.pricePaise)}${a.available !== null ? ` · ${a.available} in stock at store` : ""}`, available: a.available })),
    };
  });

  return (
    <div className="space-y-5">
      <Link href="/pharmacist" className="inline-flex items-center gap-1 text-sm font-semibold text-brand">
        <ArrowLeft aria-hidden className="size-4" /> Back to queue
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{order.orderNumber}</h1>
        <OrderStatusBadge status={order.status} t={t} />
        <Badge tone="neutral">
          {order.firstDecisionAt ? `Decided after ${age(order.submittedAt, order.firstDecisionAt)}` : `Waiting ${age(order.submittedAt)}`}
        </Badge>
        {order.manualReviewRequired ? <Badge tone="warn">Manual reading required</Badge> : null}
        <span className="text-[15px] text-muted">
          Patient <strong className="text-ink">{order.familyMember.name}</strong> · ordered by {order.customer.name} · {order.store?.name ?? "not routed (no stock)"}
        </span>
      </div>

      {!order.prescription ? (
        <Alert tone="bad" title="No prescription is attached">Prescription items cannot be approved. Request a re-upload.</Alert>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          {order.prescription ? <PrescriptionViewer id={order.prescription.id} mimeType={order.prescription.mimeType} viewKey={randomUUID()} /> : null}
          <Card>
            <CardHeader
              title={
                <span className="inline-flex items-center gap-2">
                  <Bot aria-hidden className="size-5 text-muted" /> Automated draft (not a decision)
                </span>
              }
              description={run ? `${run.provider} · ${dateTime(run.createdAt)} · overall confidence ${run.overallConfidence ? Math.round(Number(run.overallConfidence) * 100) + "%" : "—"}` : "No extraction ran."}
            />
            <div className="space-y-3 p-4">
              <Alert tone={head.tone} title={head.title} />
              {run?.lines.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[480px] text-left text-sm">
                    <thead className="text-muted">
                      <tr>
                        <th className="py-1.5 pr-2 font-semibold">#</th>
                        <th className="py-1.5 pr-2 font-semibold">Medicine / strength</th>
                        <th className="py-1.5 pr-2 font-semibold">As written</th>
                        <th className="py-1.5 font-semibold">Catalogue match</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {run.lines.map((l) => (
                        <tr key={l.id} className="align-top">
                          <td className="py-2 pr-2">{l.lineIndex + 1}</td>
                          <td className="py-2 pr-2">
                            <div className="font-semibold">{l.medicineName ?? "—"} {l.strength ?? <span className="text-bad">strength ?</span>}</div>
                            <div className="mt-1 flex flex-wrap gap-1">
                              <span className="text-xs text-muted">name</span> <ConfidenceBadge value={Number(l.nameConfidence)} threshold={threshold} />
                              <span className="text-xs text-muted">strength</span> <ConfidenceBadge value={Number(l.strengthConfidence)} threshold={threshold} />
                            </div>
                          </td>
                          <td className="py-2 pr-2">
                            {l.dosageText ?? <span className="text-muted">dosage not stated</span>}
                            {l.durationDays ? ` · ${l.durationDays} days` : ""}
                            {l.quantityUnits ? (
                              <div className="text-xs text-muted">
                                {l.quantityDerived ? "Calculated" : "Written"} quantity: {l.quantityUnits} units
                              </div>
                            ) : null}
                          </td>
                          <td className="py-2">
                            <Badge tone={l.matchStatus === "MATCHED" ? "ok" : "warn"}>{l.matchStatus.toLowerCase()}</Badge>
                            <div className="text-xs text-muted">{l.matchedProduct?.name ?? l.matchReason}</div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {run?.fields.length ? (
                <KeyValue
                  className="text-sm"
                  items={run.fields.map((f) => [FIELD_LABEL[f.key] ?? f.key, <span key={f.id} className="inline-flex flex-wrap items-center gap-1.5">{f.value ?? "—"} <ConfidenceBadge value={Number(f.confidence)} threshold={threshold} /></span>])}
                />
              ) : null}
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          {order.status === "AWAITING_PHARMACIST" ? (
            <ReviewForm
              orderId={order.id}
              hasPrescription={Boolean(order.prescription)}
              items={items.filter((i) => i.status === "PENDING_REVIEW")}
              otherItems={items.filter((i) => i.status !== "PENDING_REVIEW")}
              header={{
                patientName: field("patient_name")?.value ?? "",
                prescriberName: field("prescriber_name")?.value ?? "",
                prescriberRegNo: field("prescriber_reg_no")?.value ?? "",
                prescriptionDate: toIsoDate(field("prescription_date")?.value),
              }}
              headerConfidence={{
                patientName: field("patient_name") ? Number(field("patient_name")!.confidence) : null,
                prescriberName: field("prescriber_name") ? Number(field("prescriber_name")!.confidence) : null,
                prescriberRegNo: field("prescriber_reg_no") ? Number(field("prescriber_reg_no")!.confidence) : null,
                prescriptionDate: field("prescription_date") ? Number(field("prescription_date")!.confidence) : null,
              }}
              h1Defaults={{
                patientName: order.familyMember.name,
                patientAddress: addressWithArea(order.deliveryAddress, order.deliveryLocality.name),
                prescriberAddress: field("prescriber_address")?.value ?? "",
              }}
              threshold={threshold}
            />
          ) : (
            <Card>
              <CardHeader title="Decision recorded" description="This order is no longer waiting for a pharmacist decision." />
              <ul className="divide-y divide-line">
                {order.items.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                    <span className="font-semibold">
                      {i.product.name} × {i.approvedQuantity ?? i.quantity}
                    </span>
                    <ItemStatusBadge status={i.status} />
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <CardHeader
              title={
                <span className="inline-flex items-center gap-2">
                  <History aria-hidden className="size-5 text-muted" /> History & audit trail
                </span>
              }
              description="Append-only. Includes every view of the prescription file."
            />
            <div className="space-y-4 p-5">
              {order.reviews.map((r) => (
                <div key={r.id} className="rounded-xl border border-line p-3 text-[15px]">
                  <p>
                    <strong>{r.outcome.replaceAll("_", " ").toLowerCase()}</strong> by {r.reviewer.name} (reg. {r.reviewerRegNo}) · {dateTime(r.createdAt)}
                  </p>
                  {r.reason ? <p className="text-muted">Reason: {r.reason}</p> : null}
                  {r.prescriberName ? <p className="text-sm text-muted">Verified prescriber: {r.prescriberName}{r.prescriptionDate ? `, dated ${r.prescriptionDate.toISOString().slice(0, 10)}` : ""}</p> : null}
                </div>
              ))}
              <ol className="space-y-1.5 text-sm">
                {audit.map((a) => (
                  <li key={a.id} className="flex flex-wrap gap-x-2">
                    <span className="tabular-nums text-muted">{dateTime(a.createdAt)}</span>
                    <span className="font-medium">{a.action.replaceAll("_", " ").toLowerCase()}</span>
                    <span className="text-muted">— {a.actorName} ({a.actorRole.toLowerCase()})</span>
                  </li>
                ))}
              </ol>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
