import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, ClipboardList } from "lucide-react";
import { OrderStatusBadge } from "@/components/status";
import { Badge, Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { requirePageRole } from "@/server/auth/session";
import { listOrders } from "@/server/queries/customer";
import { dateTime, money } from "@/lib/format";
import { getT } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Orders" };

export default async function OrdersPage() {
  const actor = await requirePageRole(["CUSTOMER"]);
  const t = await getT();
  const orders = await listOrders(actor);
  return (
    <div>
      <PageHeader title={t("nav.orders")} description="Orders for everyone in your family." />
      <Card>
        {orders.length === 0 ? (
          <EmptyState icon={<ClipboardList className="size-6" />} title="No orders yet" action={<LinkButton href="/medicines">{t("home.findMedicines")}</LinkButton>} />
        ) : (
          <ul className="divide-y divide-line">
            {orders.map((o) => (
              <li key={o.id}>
                <Link href={`/orders/${o.id}`} className="flex items-center gap-4 px-5 py-4 hover:bg-canvas">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{o.orderNumber}</span>
                      <OrderStatusBadge status={o.status} t={t} />
                      {o.routingStatus === "NO_STOCK" && !["REJECTED", "CANCELLED"].includes(o.status) ? <Badge tone="warn">Waiting for stock</Badge> : null}
                    </div>
                    <p className="mt-0.5 truncate text-[15px] text-muted">
                      For {o.familyMember.name} · {o.items.map((i) => i.product.name).join(", ")}
                    </p>
                    <p className="text-sm text-muted">
                      {dateTime(o.createdAt)} · {money(o.subtotalPaise)}
                    </p>
                  </div>
                  <ChevronRight aria-hidden className="size-5 shrink-0 text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
