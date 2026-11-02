import type { Metadata } from "next";
import { ShoppingBag } from "lucide-react";
import { QuantityStepper } from "@/components/customer/action-buttons";
import { CategoryBadge } from "@/components/status";
import { Alert, Card, CardHeader, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { requirePageRole } from "@/server/auth/session";
import { getSelectedPatient } from "@/server/customer-context";
import { getCart } from "@/server/queries/customer";
import { money } from "@/lib/format";
import { getT } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Cart" };

export default async function CartPage({ searchParams }: { searchParams: Promise<{ source?: string }> }) {
  const actor = await requirePageRole(["CUSTOMER"]);
  const t = await getT();
  const { source } = await searchParams;
  const { selected } = await getSelectedPatient(actor);
  if (!selected) return null;
  const cart = await getCart(actor, selected.id);
  const checkoutHref = `/checkout${source === "REORDER" || source === "REFILL_REMINDER" ? `?source=${source}` : ""}`;

  return (
    <div>
      <PageHeader title={t("nav.cart")} eyebrow={`${t("home.orderingFor")}: ${selected.name}`} />
      {cart.lines.length === 0 ? (
        <Card>
          <EmptyState icon={<ShoppingBag className="size-6" />} title={`${selected.name}'s cart is empty`} action={<LinkButton href="/medicines">{t("home.findMedicines")}</LinkButton>}>
            Carts are kept separately for each family member.
          </EmptyState>
        </Card>
      ) : (
        <div className="space-y-5">
          {source === "REORDER" || source === "REFILL_REMINDER" ? (
            <Alert tone="info" title="Check the quantities before you continue">
              We filled the cart from your previous order. Nothing has been ordered yet.
            </Alert>
          ) : null}
          <Card>
            <CardHeader title={`Items for ${selected.name}`} />
            <ul className="divide-y divide-line">
              {cart.lines.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4" data-testid="cart-line">
                  <div className="min-w-0">
                    <p className="font-semibold">{l.product.name}</p>
                    <p className="text-[15px] text-muted">
                      {l.product.packLabel} · {money(l.product.pricePaise)} each
                    </p>
                    <div className="mt-1.5">
                      <CategoryBadge category={l.product.category} orderable={l.decision.orderable} t={t} />
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <QuantityStepper familyMemberId={selected.id} productId={l.productId} quantity={l.quantity} name={l.product.name} />
                    <span className="w-20 text-right font-semibold tabular-nums">{money(l.product.pricePaise * l.quantity)}</span>
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between border-t border-line px-5 py-4 text-lg">
              <span className="font-semibold">Total</span>
              <span className="font-bold tabular-nums">{money(cart.subtotal)}</span>
            </div>
          </Card>

          {cart.blocked.length ? (
            <Alert tone="bad" title="Remove items that cannot be sold online">
              {cart.blocked.map((b) => b.product.name).join(", ")}
            </Alert>
          ) : null}
          {cart.needsPrescription ? (
            <Alert tone="info" title={t("rx.required")}>
              Some items need a valid prescription. You will upload it (or use one already on file) at the next step. A registered pharmacist checks it before anything is packed.
            </Alert>
          ) : null}

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
            <LinkButton href="/medicines" variant="outline" size="lg">
              Add more medicines
            </LinkButton>
            {cart.blocked.length ? null : (
              <LinkButton href={checkoutHref} size="lg">
                {t("cta.checkout")}
              </LinkButton>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
