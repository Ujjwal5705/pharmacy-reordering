import type { Metadata } from "next";
import { MapPin, Search } from "lucide-react";
import { AddToCartButton } from "@/components/customer/action-buttons";
import { CategoryBadge } from "@/components/status";
import { Alert, Badge, Card, EmptyState, Input, PageHeader } from "@/components/ui";
import { requirePageRole } from "@/server/auth/session";
import { getSelectedPatient } from "@/server/customer-context";
import { searchCatalogue } from "@/server/queries/customer";
import { money } from "@/lib/format";
import { getT } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Medicines" };

const AVAILABILITY = {
  NEARBY: { tone: "ok", label: "In stock near you" },
  FURTHER: { tone: "info", label: "In stock at a store further away" },
  OUT: { tone: "neutral", label: "Out of stock" },
  UNKNOWN_AREA: { tone: "info", label: "In stock" },
} as const;

export default async function MedicinesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const actor = await requirePageRole(["CUSTOMER"]);
  const t = await getT();
  const { q = "" } = await searchParams;
  const { selected } = await getSelectedPatient(actor);
  const { items, locality } = await searchCatalogue(actor, q);

  return (
    <div>
      <PageHeader title={t("nav.medicines")} description={selected ? `Adding to ${selected.name}'s cart.` : undefined} />
      <form role="search" className="mb-5 flex gap-2" action="/medicines">
        <label htmlFor="q" className="sr-only">
          Search medicines
        </label>
        <Input id="q" name="q" type="search" defaultValue={q} placeholder="Search by medicine or brand, e.g. metformin" className="text-lg" autoComplete="off" />
        <button type="submit" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand px-4 font-semibold text-white hover:bg-brand-strong">
          <Search aria-hidden className="size-5" />
          <span className="hidden sm:inline">Search</span>
        </button>
      </form>
      <p className="mb-4 flex items-center gap-1.5 text-sm text-muted">
        <MapPin aria-hidden className="size-4" />
        {locality ? `Availability shown for ${locality} (straight-line distance to stores).` : "Add your area in Family → profile to see stock near you."}
      </p>

      {items.length === 0 ? (
        <Card>
          <EmptyState icon={<Search className="size-6" />} title={`No medicines match “${q}”`}>
            Check the spelling, or search by the medicine name written on the prescription.
          </EmptyState>
        </Card>
      ) : (
        <ul className="space-y-3">
          {items.map(({ product: p, decision, availability, nearestKm }) => {
            const av = AVAILABILITY[availability];
            return (
              <li key={p.id}>
                <Card className="flex flex-wrap items-center gap-4 p-4 sm:p-5" data-testid="product-card">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold">{p.name}</h2>
                      <CategoryBadge category={p.category} orderable={decision.orderable} t={t} />
                    </div>
                    <p className="mt-0.5 text-[15px] text-ink-soft">
                      {p.molecule} {p.strength} · {p.form} · {p.packLabel} · {p.isGeneric ? "Generic" : `Brand (${p.manufacturer})`}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="text-lg font-bold">{money(p.pricePaise)}</span>
                      {decision.orderable ? (
                        <Badge tone={av.tone}>
                          {av.label}
                          {availability === "FURTHER" && nearestKm ? ` (~${nearestKm.toFixed(1)} km)` : ""}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  <div className="w-full sm:w-auto">
                    {decision.orderable && selected ? (
                      <AddToCartButton familyMemberId={selected.id} productId={p.id} label={t("cta.addToCart")} disabled={availability === "OUT"} />
                    ) : null}
                  </div>
                  {!decision.orderable ? (
                    <Alert tone="bad" className="w-full" title="This medicine cannot be ordered online">
                      Under the rules configured for this category it is not sold online. Please visit a store with your prescription.
                    </Alert>
                  ) : null}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
