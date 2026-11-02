import Link from "next/link";
import { BellRing, CalendarClock, ChevronRight, Info, Search } from "lucide-react";
import { ReorderButton, RefillToCartButton } from "@/components/customer/action-buttons";
import { relationLabel } from "@/lib/relations";
import { OrderStatusBadge } from "@/components/status";
import { Alert, Badge, Card, CardHeader, EmptyState, LinkButton } from "@/components/ui";
import { requirePageRole } from "@/server/auth/session";
import { getSelectedPatient } from "@/server/customer-context";
import { getHome } from "@/server/queries/customer";
import { dateOnly, daysUntil, money } from "@/lib/format";
import { getT } from "@/lib/i18n/server";

export default async function CustomerHome() {
  const actor = await requirePageRole(["CUSTOMER"]);
  const t = await getT();
  const { selected } = await getSelectedPatient(actor);
  if (!selected) return <EmptyState title="Add a patient profile to start">Go to Family to add yourself or a family member.</EmptyState>;
  const { orders, plans, lastOrder, profileIncomplete } = await getHome(actor, selected.id);
  const due = plans.filter((p) => p.optedIn && p.status === "ACTIVE" && p.remindAt && p.remindAt <= new Date());
  const firstName = actor.name.split(" ")[0];

  return (
    <div className="space-y-6">
      <div>
        <p className="text-lg text-muted">
          {t("home.greeting")}, {firstName}
        </p>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          {selected.relation === "SELF" ? "Your medicines" : `Medicines for ${selected.name}`}
          <span className="ml-2 align-middle text-base font-medium text-muted">({relationLabel(selected.relation)})</span>
        </h1>
      </div>

      {profileIncomplete ? (
        <Alert tone="info" title="Add your delivery address" action={<LinkButton href="/family" variant="outline" size="sm">Complete profile</LinkButton>}>
          We use your area to find the nearest store that has your medicines in stock.
        </Alert>
      ) : null}

      <Card className="overflow-hidden border-brand/25">
        <div className="bg-brand-soft/60 p-5 sm:p-6">
          {lastOrder && lastOrder.items.length ? (
            <>
              <ReorderButton orderId={lastOrder.id} label={t("home.reorderCta")} size="lg" className="w-full sm:w-auto" />
              <p className="mt-3 text-[15px] text-ink-soft">
                Last order {lastOrder.orderNumber} ({dateOnly(lastOrder.createdAt)}): {lastOrder.items.map((i) => `${i.product.name} × ${i.approvedQuantity ?? i.quantity}`).join(", ")}
              </p>
              <p className="mt-1 text-sm text-muted">{t("home.reorderHint")} A pharmacist checks the prescription on every order.</p>
            </>
          ) : (
            <>
              <LinkButton href="/medicines" size="lg" className="w-full sm:w-auto">
                <Search aria-hidden className="size-5" /> {t("home.findMedicines")}
              </LinkButton>
              <p className="mt-3 text-[15px] text-ink-soft">No previous orders for {selected.name} yet. Search for a medicine to start an order.</p>
            </>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          title={
            <span className="inline-flex items-center gap-2">
              <BellRing aria-hidden className="size-5 text-brand" /> {t("home.refills")}
            </span>
          }
          description="Estimated from the quantity supplied and the daily dose a pharmacist confirmed. Reminders are suggestions — nothing is ordered automatically."
        />
        {plans.length === 0 ? (
          <EmptyState title="No refill reminders yet">After a pharmacist approves an order, you can turn on a reminder for each medicine.</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {plans.map((p) => {
              const isDue = due.includes(p);
              const left = p.runOutDate ? daysUntil(p.runOutDate) : null;
              return (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4" data-testid="refill-plan">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{p.product.name}</p>
                      {isDue ? <Badge tone="warn">Reorder soon</Badge> : null}
                      {!p.optedIn && p.status !== "NEEDS_DOSAGE" ? <Badge tone="neutral">Reminder off</Badge> : null}
                    </div>
                    {p.status === "ACTIVE" && p.runOutDate ? (
                      <p className="mt-0.5 text-[15px] text-ink-soft">
                        <CalendarClock aria-hidden className="mr-1 inline size-4 align-[-2px]" />
                        Estimated to run out {dateOnly(p.runOutDate)}
                        {left !== null ? <strong className="ml-1">({left <= 0 ? "now" : `${left} days left`})</strong> : null}
                        <span className="block text-sm text-muted">
                          {p.unitsSupplied} units ÷ {Number(p.unitsPerDay)} a day, from delivery on {dateOnly(p.startDate)}.
                        </span>
                      </p>
                    ) : p.status === "NEEDS_DOSAGE" ? (
                      <p className="mt-0.5 text-[15px] text-ink-soft">
                        <Info aria-hidden className="mr-1 inline size-4 align-[-2px] text-info" />
                        No run-out date: a daily dose was not confirmed by the pharmacist. Your pharmacist can confirm it on your next order.
                      </p>
                    ) : (
                      <p className="mt-0.5 text-[15px] text-ink-soft">The estimate starts when order {p.sourceOrder.orderNumber} is delivered.</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {isDue ? <RefillToCartButton planId={p.id} label={t("cta.reorder")} /> : null}
                    <LinkButton href={`/orders/${p.sourceOrder.id}#refills`} variant="ghost" size="sm">
                      Settings
                    </LinkButton>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title={t("home.activeOrders")} action={<LinkButton href="/orders" variant="ghost" size="sm">All orders</LinkButton>} />
        {orders.length === 0 ? (
          <EmptyState title="No active orders">Orders you place for {selected.name} will appear here.</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {orders.map((o) => (
              <li key={o.id}>
                <Link href={`/orders/${o.id}`} className="flex items-center gap-4 px-5 py-4 hover:bg-canvas">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{o.orderNumber}</span>
                      <OrderStatusBadge status={o.status} t={t} />
                      {o.routingStatus === "NO_STOCK" ? <Badge tone="warn">Waiting for stock</Badge> : null}
                    </div>
                    <p className="mt-0.5 truncate text-[15px] text-muted">
                      {o.items.map((i) => i.product.name).join(", ")} · {money(o.subtotalPaise)}
                      {o.store ? ` · ${o.store.name}` : ""}
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
