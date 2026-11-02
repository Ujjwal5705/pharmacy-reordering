import type { Metadata } from "next";
import Link from "next/link";
import type { OrderStatus } from "@prisma/client";
import { Alert, Badge, Card, CardHeader, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { requirePageRole } from "@/server/auth/session";
import { getOpsDashboard } from "@/server/queries/staff";
import { dateTime } from "@/lib/format";
import { OpsActions, RetryRoutingButton } from "./ops-actions";

export const metadata: Metadata = { title: "Operations dashboard" };

const COLS: { label: string; statuses: OrderStatus[] }[] = [
  { label: "Awaiting pharmacist", statuses: ["AWAITING_PHARMACIST"] },
  { label: "On hold", statuses: ["NEEDS_REUPLOAD", "AWAITING_CUSTOMER_CONSENT"] },
  { label: "Approved / picking", statuses: ["APPROVED", "PICKING"] },
  { label: "Packed / out", statuses: ["PACKED", "HANDED_TO_DELIVERY"] },
  { label: "Delivered", statuses: ["DELIVERED"] },
  { label: "Rejected", statuses: ["REJECTED"] },
  { label: "Cancelled", statuses: ["CANCELLED"] },
];

export default async function OpsDashboard() {
  const actor = await requirePageRole(["OPS_ADMIN"]);
  const d = await getOpsDashboard(actor);
  const cell = (storeId: string | null, statuses: OrderStatus[]) =>
    d.byStore.filter((r) => r.storeId === storeId && statuses.includes(r.status)).reduce((s, r) => s + r._count, 0);
  const rows = [...d.stores.map((s) => ({ id: s.id as string | null, name: s.name })), { id: null, name: "Not routed (no stock)" }];

  return (
    <div className="space-y-5">
      <PageHeader title="Operations dashboard" description="All stores, last 30 days. Figures are calculated from the demo database (synthetic data)." action={<OpsActions />} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Median verification time", value: d.median === null ? "—" : `${d.median.toFixed(1)} min`, note: `${d.decidedCount} decisions · ${d.overTarget} over 10 min` },
          { label: "Awaiting pharmacist now", value: String(d.awaiting), note: "Across all stores" },
          { label: "Rejections & re-upload requests", value: String(d.rejections.length), note: `${d.itemRejections} item-level rejections` },
          { label: "Waiting for stock", value: String(d.noStock.length), note: "No single store can fulfil" },
        ].map((k) => (
          <Card key={k.label} className="p-5">
            <p className="text-sm font-medium text-muted">{k.label}</p>
            <p className="mt-1 text-3xl font-bold tabular-nums">{k.value}</p>
            <p className="mt-1 text-sm text-muted">{k.note}</p>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden">
        <CardHeader title="Orders by store" description="Count of orders created in the last 30 days, by current status." />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-[15px]">
            <thead className="border-b border-line bg-canvas text-sm text-muted">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-semibold">Store</th>
                {COLS.map((c) => (
                  <th key={c.label} scope="col" className="px-3 py-2.5 text-right font-semibold">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id ?? "none"}>
                  <th scope="row" className="px-4 py-2.5 font-medium">
                    {r.id ? <Link href={`/store?store=${r.id}`} className="hover:text-brand">{r.name}</Link> : r.name}
                  </th>
                  {COLS.map((c) => {
                    const n = cell(r.id, c.statuses);
                    return (
                      <td key={c.label} className={`px-3 py-2.5 text-right tabular-nums ${n ? "font-semibold" : "text-muted"}`}>{n}</td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Waiting for stock" description="Never split across stores. Import fresh stock, then retry routing." action={<LinkButton href="/ops/stock" variant="outline" size="sm">Import stock</LinkButton>} />
          {d.noStock.length === 0 ? (
            <EmptyState title="Every open order has a store" />
          ) : (
            <ul className="divide-y divide-line">
              {d.noStock.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-[15px]">
                  <div>
                    <p className="font-semibold">{o.orderNumber} <Badge tone="neutral">{o.status.replaceAll("_", " ").toLowerCase()}</Badge></p>
                    <p className="text-sm text-muted">{o.items.map((i) => `${i.product.name} × ${i.approvedQuantity ?? i.quantity}`).join(", ")} · {o.deliveryLocality.name}</p>
                  </div>
                  <RetryRoutingButton orderId={o.id} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Recent rejections and re-upload requests" />
          {d.rejections.length === 0 ? (
            <EmptyState title="None in the last 30 days" />
          ) : (
            <ul className="divide-y divide-line">
              {d.rejections.map((r) => (
                <li key={r.id} className="px-5 py-3 text-[15px]">
                  <p>
                    <strong>{r.order.orderNumber}</strong> · {r.order.store?.name ?? "no store"} · <Badge tone={r.outcome === "REJECTED" ? "bad" : "warn"}>{r.outcome === "REJECTED" ? "Rejected" : "Re-upload"}</Badge>
                  </p>
                  <p className="text-sm text-muted">{r.reason} · {dateTime(r.createdAt)}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Alert tone="info" title="About these numbers">
        This prototype measures verification time from customer submission to the first pharmacist decision. {d.notifications} mock notifications were logged in the period (none were sent).
      </Alert>
    </div>
  );
}
