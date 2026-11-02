import type { Metadata } from "next";
import { PackageCheck } from "lucide-react";
import { OrderStatusBadge } from "@/components/status";
import { Alert, Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requirePageRole } from "@/server/auth/session";
import { getStoreQueue } from "@/server/queries/staff";
import { age } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import { FulfilmentControls } from "./fulfilment-controls";

export const metadata: Metadata = { title: "Store orders" };

const COLUMNS = [
  { key: "ready", title: "Ready to pick", statuses: ["APPROVED"] },
  { key: "picking", title: "Picking", statuses: ["PICKING"] },
  { key: "packed", title: "Packed — awaiting handover", statuses: ["PACKED"] },
  { key: "out", title: "Out for delivery", statuses: ["HANDED_TO_DELIVERY"] },
] as const;

export default async function StorePage({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const actor = await requirePageRole(["STORE_STAFF", "OPS_ADMIN"]);
  const t = await getT();
  const { store: storeParam } = await searchParams;
  const { store, stores, orders, gates, deliveredToday } = await getStoreQueue(actor, storeParam);
  const waiting = orders.filter((o) => ["AWAITING_PHARMACIST", "NEEDS_REUPLOAD", "AWAITING_CUSTOMER_CONSENT"].includes(o.status));

  return (
    <div>
      <PageHeader
        title={store.name}
        description={`Pick, pack with the store invoice number, and hand over. ${deliveredToday} delivered today.`}
        action={
          stores.length ? (
            <form action="/store" className="flex items-center gap-2">
              <label htmlFor="store" className="text-sm font-medium text-muted">Store</label>
              <select id="store" name="store" defaultValue={store.id} className="min-h-10 rounded-lg border border-line-strong bg-surface px-2 text-sm">
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <button type="submit" className="min-h-10 rounded-lg border border-line-strong bg-surface px-3 text-sm font-semibold">View</button>
            </form>
          ) : null
        }
      />
      <div className="grid gap-4 xl:grid-cols-4 md:grid-cols-2">
        {COLUMNS.map((col) => {
          const list = orders.filter((o) => (col.statuses as readonly string[]).includes(o.status));
          return (
            <section key={col.key} aria-labelledby={`col-${col.key}`} className="space-y-3">
              <h2 id={`col-${col.key}`} className="flex items-center gap-2 font-semibold">
                {col.title} <Badge>{list.length}</Badge>
              </h2>
              {list.length === 0 ? (
                <Card className="p-4 text-sm text-muted">Nothing here.</Card>
              ) : (
                list.map((o) => {
                  const violations = gates.get(o.id) ?? [];
                  return (
                    <Card key={o.id} className="space-y-3 p-4" data-testid="store-order">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold">{o.orderNumber}</span>
                        <OrderStatusBadge status={o.status} t={t} />
                      </div>
                      <ul className="text-[15px]">
                        {o.items.filter((i) => i.status !== "REJECTED").map((i) => (
                          <li key={i.id}>
                            {i.product.name} × <strong>{i.approvedQuantity ?? i.quantity}</strong>
                          </li>
                        ))}
                      </ul>
                      <p className="text-sm text-muted">
                        {o.deliveryLocality.name} · for {o.familyMember.name} · {age(o.submittedAt)} ago
                        {o.storeInvoiceNumber ? ` · Invoice ${o.storeInvoiceNumber}` : ""}
                        {o.deliveryPartner ? ` · With ${o.deliveryPartner}` : ""}
                      </p>
                      {violations.length ? (
                        <Alert tone="bad" title="Dispatch blocked">
                          <ul className="list-disc pl-5">{violations.map((v) => <li key={v}>{v}</li>)}</ul>
                        </Alert>
                      ) : (
                        <FulfilmentControls orderId={o.id} status={o.status} />
                      )}
                    </Card>
                  );
                })
              )}
            </section>
          );
        })}
      </div>

      <Card className="mt-6">
        <div className="border-b border-line px-5 py-3">
          <h2 className="font-semibold">Waiting for the pharmacist or customer — do not pick</h2>
          <p className="text-sm text-muted">Stock is reserved for these orders. They cannot be picked until a pharmacist approves the prescription.</p>
        </div>
        {waiting.length === 0 ? (
          <EmptyState icon={<PackageCheck className="size-6" />} title="No orders waiting" />
        ) : (
          <ul className="divide-y divide-line">
            {waiting.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-[15px]">
                <span>
                  <strong>{o.orderNumber}</strong> · {o.items.map((i) => `${i.product.name} × ${i.quantity}`).join(", ")}
                </span>
                <OrderStatusBadge status={o.status} t={t} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
