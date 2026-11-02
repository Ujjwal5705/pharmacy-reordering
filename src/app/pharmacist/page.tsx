import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardCheck, Clock } from "lucide-react";
import { CATEGORY_LABEL, OrderStatusBadge } from "@/components/status";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requirePageRole } from "@/server/auth/session";
import { getPharmacistQueue, QUEUE_VIEWS, type QueueView } from "@/server/queries/staff";
import { age, dateTime } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Verification queue" };

const TARGET_MINUTES = 10;

export default async function PharmacistQueue({ searchParams }: { searchParams: Promise<{ view?: string; store?: string }> }) {
  const actor = await requirePageRole(["PHARMACIST"]);
  const t = await getT();
  const sp = await searchParams;
  const view: QueueView = sp.view && sp.view in QUEUE_VIEWS ? (sp.view as QueueView) : "waiting";
  const { orders, counts, stores } = await getPharmacistQueue(actor, view, sp.store);
  const qs = (v: string, s?: string) => `/pharmacist?view=${v}${s ? `&store=${s}` : ""}`;

  return (
    <div>
      <PageHeader
        title={t("nav.queue")}
        description={actor.storeId ? `Orders routed to your store. Oldest first.` : "Orders from all stores. Oldest first. Target: a decision within 10 minutes."}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <nav aria-label="Queue filter" className="flex flex-wrap gap-2">
          {(Object.keys(QUEUE_VIEWS) as QueueView[]).map((v) => {
            const n = v === "waiting" ? counts.AWAITING_PHARMACIST : v === "onhold" ? counts.NEEDS_REUPLOAD : v === "consent" ? counts.AWAITING_CUSTOMER_CONSENT : undefined;
            return (
              <Link
                key={v}
                href={qs(v, sp.store)}
                aria-current={v === view ? "page" : undefined}
                className={cn("inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm font-semibold", v === view ? "border-brand bg-brand-soft text-brand-strong" : "border-line bg-surface text-ink-soft hover:border-line-strong")}
              >
                {QUEUE_VIEWS[v].label}
                {n ? <span className="rounded-full bg-brand px-1.5 text-xs text-white">{n}</span> : null}
              </Link>
            );
          })}
        </nav>
        {!actor.storeId ? (
          <form className="ml-auto flex items-center gap-2" action="/pharmacist">
            <input type="hidden" name="view" value={view} />
            <label htmlFor="store" className="text-sm font-medium text-muted">
              Store
            </label>
            <select id="store" name="store" defaultValue={sp.store ?? ""} className="min-h-10 rounded-lg border border-line-strong bg-surface px-2 text-sm">
              <option value="">All stores</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <button type="submit" className="min-h-10 rounded-lg border border-line-strong bg-surface px-3 text-sm font-semibold">
              Apply
            </button>
          </form>
        ) : null}
      </div>

      <Card className="overflow-hidden">
        {orders.length === 0 ? (
          <EmptyState icon={<ClipboardCheck className="size-6" />} title={view === "waiting" ? "Queue is clear" : "Nothing here"}>
            {view === "waiting" ? "New prescription orders will appear here as customers submit them." : "No orders match this filter."}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-[15px]">
              <thead className="border-b border-line bg-canvas text-sm text-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">Waiting</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Order</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Patient</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Items</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Store</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Flags</th>
                  <th scope="col" className="px-4 py-3"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {orders.map((o) => {
                  const mins = (Date.now() - o.submittedAt.getTime()) / 60_000;
                  const run = o.prescription?.extractionRuns[0];
                  const over = view === "waiting" && mins > TARGET_MINUTES;
                  return (
                    <tr key={o.id} className="hover:bg-canvas/60" data-testid="queue-row">
                      <td className="px-4 py-3">
                        <span className={cn("inline-flex items-center gap-1 font-semibold tabular-nums", over ? "text-bad" : "text-ink")}>
                          <Clock aria-hidden className="size-4" /> {age(o.submittedAt)}
                        </span>
                        {over ? <span className="block text-xs font-semibold text-bad">Over 10-min target</span> : null}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-semibold">{o.orderNumber}</span>
                        <div className="mt-0.5"><OrderStatusBadge status={o.status} t={t} /></div>
                      </td>
                      <td className="px-4 py-3">{o.familyMember.name}</td>
                      <td className="px-4 py-3">
                        {o.items.map((i) => (
                          <div key={i.id} className="whitespace-nowrap">
                            {i.product.name} × {i.quantity} <span className="text-xs text-muted">{CATEGORY_LABEL[i.category]}</span>
                          </div>
                        ))}
                      </td>
                      <td className="px-4 py-3">{o.store?.name ?? <Badge tone="warn">No stock yet</Badge>}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {o.manualReviewRequired ? <Badge tone="warn">Manual read</Badge> : null}
                          {run?.status === "SUCCEEDED" ? <Badge tone="ok">Draft ready</Badge> : null}
                          {o.items.some((i) => i.h1RegisterRequired) ? <Badge tone="warn">H1 register</Badge> : null}
                          {o.source !== "CATALOGUE" ? <Badge tone="neutral">Reorder</Badge> : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link href={`/pharmacist/orders/${o.id}`} className="inline-flex min-h-10 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-strong">
                          {o.status === "AWAITING_PHARMACIST" ? "Review" : "Open"}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="mt-3 text-sm text-muted">Showing up to 100 orders. Times are since the customer submitted. Last refreshed {dateTime(new Date())}.</p>
    </div>
  );
}
