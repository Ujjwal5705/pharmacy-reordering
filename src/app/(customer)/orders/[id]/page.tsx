import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { OrderStatus } from "@prisma/client";
import { Check, Circle, Store } from "lucide-react";
import { CancelOrder, ConsentButtons, RefillOptIn, ReorderButton } from "@/components/customer/action-buttons";
import { ReuploadPanel } from "@/components/customer/reupload-panel";
import { PrescriptionPreview } from "@/components/prescription";
import { ItemStatusBadge, OrderStatusBadge } from "@/components/status";
import { Alert, Badge, Card, CardHeader, KeyValue, PageHeader } from "@/components/ui";
import { requirePageRole } from "@/server/auth/session";
import { isDomainError } from "@/server/errors";
import { getOrderDetail } from "@/server/queries/customer";
import { canTransition } from "@/server/domain/order-state";
import { dateOnly, dateTime, money } from "@/lib/format";
import { getT } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Order" };

const FLOW: OrderStatus[] = ["AWAITING_PHARMACIST", "APPROVED", "PICKING", "PACKED", "HANDED_TO_DELIVERY", "DELIVERED"];

const NEXT_STEP: Partial<Record<OrderStatus, string>> = {
  AWAITING_PHARMACIST: "A registered pharmacist is checking your prescription. Most checks finish within minutes during store hours.",
  NEEDS_REUPLOAD: "Upload a clearer photo of the prescription below. Your order stays on hold until then.",
  AWAITING_CUSTOMER_CONSENT: "The pharmacist suggested a generic alternative. Please choose below.",
  APPROVED: "The store will pick and pack your medicines.",
  PICKING: "The store is picking your medicines.",
  PACKED: "Packed and waiting for the delivery person.",
  HANDED_TO_DELIVERY: "On the way to you today.",
  DELIVERED: "Delivered. You can turn on refill reminders below.",
};

export default async function OrderDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ placed?: string }> }) {
  const actor = await requirePageRole(["CUSTOMER"]);
  const t = await getT();
  const { id } = await params;
  const { placed } = await searchParams;
  const order = await getOrderDetail(actor, id).catch((e) => {
    if (isDomainError(e)) notFound();
    throw e;
  });
  const latestReview = order.reviews[0];
  const pendingProposals = order.proposals.filter((p) => p.status === "PENDING_CONSENT");
  const reached = new Set(order.events.map((e) => e.toStatus));
  const offFlow = ["REJECTED", "CANCELLED", "NEEDS_REUPLOAD", "AWAITING_CUSTOMER_CONSENT"].includes(order.status);
  const cancellable = canTransition(order.status, "CANCELLED", "CUSTOMER");

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`For ${order.familyMember.name}`}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {order.orderNumber} <OrderStatusBadge status={order.status} t={t} />
          </span>
        }
        description={NEXT_STEP[order.status]}
      />

      {placed ? (
        <Alert tone="ok" title="Order placed">
          {order.requiresPharmacist ? "Your prescription is in the pharmacist’s queue. We will notify you at each step (test notifications)." : "No prescription items — the store can start packing."}
        </Alert>
      ) : null}
      {order.manualReviewRequired && order.status === "AWAITING_PHARMACIST" ? (
        <Alert tone="warn" title="The pharmacist will read your prescription manually">
          Automatic reading was not clear enough. This can take a little longer; the pharmacist may ask for a clearer photo.
        </Alert>
      ) : null}
      {order.routingStatus === "NO_STOCK" && !["REJECTED", "CANCELLED"].includes(order.status) ? (
        <Alert tone="warn" title="Waiting for stock">
          No single store has every item right now. Operations has been alerted; the order will be assigned to the nearest store once it is restocked.
        </Alert>
      ) : null}

      {order.status === "NEEDS_REUPLOAD" ? (
        <Card className="border-warn/40">
          <CardHeader title="Pharmacist asked for a new photo" description={latestReview?.reason ?? "Please upload a clearer prescription."} />
          <div className="p-5">
            <ReuploadPanel orderId={order.id} familyMemberId={order.familyMemberId} label={t("cta.reupload")} />
          </div>
        </Card>
      ) : null}

      {order.status === "REJECTED" ? (
        <Alert tone="bad" title="The pharmacist could not approve this order">
          {order.rejectionReason ?? latestReview?.reason ?? "See item notes below."} Any test payment has been reversed. Please speak to your doctor if you need a new prescription.
        </Alert>
      ) : null}

      {pendingProposals.map((p) => (
        <Card key={p.id} className="border-warn/40" data-testid="consent-card">
          <CardHeader title="Your consent is needed" description="The pharmacist approved an equivalent generic medicine. We will only change it if you agree." />
          <div className="space-y-4 p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-line p-4">
                <p className="text-sm text-muted">You ordered</p>
                <p className="font-semibold">{p.originalProduct.name}</p>
                <p className="text-sm text-muted">
                  {p.originalProduct.molecule} {p.originalProduct.strength} · {money(p.originalProduct.pricePaise)} per pack
                </p>
              </div>
              <div className="rounded-xl border border-brand/40 bg-brand-soft/40 p-4">
                <p className="text-sm text-muted">Pharmacist’s generic alternative</p>
                <p className="font-semibold">{p.substituteProduct.name}</p>
                <p className="text-sm text-muted">
                  {p.substituteProduct.molecule} {p.substituteProduct.strength} · {money(p.substituteProduct.pricePaise)} per pack
                </p>
              </div>
            </div>
            <p className="text-[15px] text-ink-soft">Same medicine, strength and form. If you say no, the pharmacist will review your order again with the medicine you asked for.</p>
            <ConsentButtons proposalId={p.id} orderId={order.id} />
          </div>
        </Card>
      ))}

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="Items" />
            <ul className="divide-y divide-line">
              {order.items.map((i) => {
                const note = order.reviews.flatMap((r) => r.items).find((d) => d.orderItemId === i.id && d.reason);
                return (
                  <li key={i.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">
                          {i.product.name} <span className="font-normal text-muted">× {i.approvedQuantity ?? i.quantity}</span>
                        </p>
                        {i.productId !== i.requestedProductId ? (
                          <p className="text-sm text-muted">Generic alternative (you consented) — you ordered {i.requestedProduct.name}</p>
                        ) : null}
                        {i.approvedQuantity && i.approvedQuantity < i.quantity ? <p className="text-sm text-warn">Pharmacist approved {i.approvedQuantity} of {i.quantity} requested.</p> : null}
                        {i.dosageInstruction ? <p className="text-sm text-muted">As prescribed: {i.dosageInstruction}</p> : null}
                        {i.status === "REJECTED" && note?.reason ? <p className="text-sm text-bad">Pharmacist’s note: {note.reason}</p> : null}
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <ItemStatusBadge status={i.status} />
                        <span className="tabular-nums text-muted">{money(i.unitPricePaise * (i.approvedQuantity ?? i.quantity))}</span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="flex justify-between border-t border-line px-5 py-3 text-lg">
              <span className="font-semibold">Total</span>
              <span className="font-bold tabular-nums">{money(order.subtotalPaise)}</span>
            </div>
          </Card>

          {order.refillPlans.length ? (
            <Card id="refills">
              <CardHeader title="Refill reminders" description="Optional. Estimates use the quantity supplied and the daily dose confirmed by the pharmacist. We never place an order for you." />
              <ul className="divide-y divide-line">
                {order.refillPlans.map((p) => (
                  <li key={p.id} className="space-y-2 px-5 py-4" data-testid="order-refill-plan">
                    <p className="font-semibold">{p.product.name}</p>
                    {p.status === "NEEDS_DOSAGE" ? (
                      <p className="text-[15px] text-ink-soft">No daily dose was confirmed by the pharmacist, so we cannot estimate when it runs out. Reminders are unavailable for this item.</p>
                    ) : (
                      <>
                        <p className="text-[15px] text-ink-soft">
                          {p.unitsSupplied} units ÷ {Number(p.unitsPerDay)} a day ≈ {Math.floor(p.unitsSupplied / Number(p.unitsPerDay))} days.{" "}
                          {p.runOutDate ? <>Estimated to run out <strong>{dateOnly(p.runOutDate)}</strong>; reminder from {dateOnly(p.remindAt)}.</> : "The estimate starts on delivery."}
                        </p>
                        <RefillOptIn planId={p.id} optedIn={p.optedIn} channel={p.channel} />
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <div className="flex flex-wrap gap-3">
            {["DELIVERED", "PACKED", "HANDED_TO_DELIVERY", "APPROVED", "PICKING"].includes(order.status) ? (
              <ReorderButton orderId={order.id} label={t("cta.reorder")} size="md" variant="secondary" />
            ) : null}
            {cancellable ? <CancelOrder orderId={order.id} /> : null}
          </div>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Progress" />
            <ol className="space-y-0 px-5 py-4" aria-label="Order progress">
              {order.events.map((e, idx) => (
                <li key={e.id} className="relative flex gap-3 pb-4 last:pb-0">
                  {idx < order.events.length - 1 ? <span aria-hidden className="absolute left-[11px] top-6 h-full w-px bg-line" /> : null}
                  <span className="relative grid size-6 shrink-0 place-items-center rounded-full bg-brand text-white">
                    <Check aria-hidden className="size-3.5" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold leading-6">{t(`status.${e.toStatus}`)}</p>
                    <p className="text-sm text-muted">{dateTime(e.createdAt)}</p>
                    {e.note && e.toStatus !== "AWAITING_PHARMACIST" ? <p className="text-sm text-ink-soft">{e.note}</p> : null}
                  </div>
                </li>
              ))}
              {!offFlow
                ? FLOW.filter((s) => !reached.has(s)).map((s) => (
                    <li key={s} className="flex gap-3 pb-4 text-muted last:pb-0">
                      <Circle aria-hidden className="size-6 shrink-0 text-line-strong" />
                      <p className="leading-6">{t(`status.${s}`)}</p>
                    </li>
                  ))
                : null}
            </ol>
          </Card>
          <Card>
            <CardHeader title="Details" />
            <div className="space-y-4 p-5">
              <KeyValue
                items={[
                  ["Store", order.store ? <span className="inline-flex items-center gap-1"><Store aria-hidden className="size-4" /> {order.store.name}</span> : "Not assigned yet"],
                  ["Deliver to", `${order.deliveryAddress}, ${order.deliveryLocality.name}`],
                  ["Payment", order.payment ? <span className="inline-flex flex-wrap items-center gap-1">{order.payment.method === "UPI_TEST" ? "UPI" : "Cash on delivery"} <Badge tone="warn">Test</Badge> {order.payment.status.replaceAll("_", " ").toLowerCase()}</span> : "—"],
                  ["Placed", dateTime(order.createdAt)],
                  ...(order.storeInvoiceNumber ? ([["Store invoice", order.storeInvoiceNumber]] as [string, string][]) : []),
                ]}
              />
              {order.prescription ? (
                <details className="rounded-xl border border-line p-3">
                  <summary className="cursor-pointer text-sm font-semibold">View the prescription on this order</summary>
                  <div className="mt-3">
                    <PrescriptionPreview id={order.prescription.id} mimeType={order.prescription.mimeType} alt="Prescription on this order" />
                  </div>
                </details>
              ) : null}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
