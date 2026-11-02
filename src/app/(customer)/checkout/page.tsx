import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requirePageRole } from "@/server/auth/session";
import { getSelectedPatient } from "@/server/customer-context";
import { normaliseName, normaliseStrength } from "@/server/extraction/matcher";
import { getCheckout } from "@/server/queries/customer";
import { getT } from "@/lib/i18n/server";
import { PageHeader } from "@/components/ui";
import { CheckoutForm } from "./checkout-form";

export const metadata: Metadata = { title: "Checkout" };

export default async function CheckoutPage({ searchParams }: { searchParams: Promise<{ area?: string; rx?: string; source?: string }> }) {
  const actor = await requirePageRole(["CUSTOMER"]);
  const t = await getT();
  const sp = await searchParams;
  const { selected } = await getSelectedPatient(actor);
  if (!selected) redirect("/family");
  const data = await getCheckout(actor, selected.id, { localityId: sp.area, prescriptionId: sp.rx });
  if (data.cart.lines.length === 0) redirect("/cart");

  const run = data.selectedRx?.extractionRuns[0] ?? null;
  // Compare cart lines with the medicines read from the prescription (same molecule + strength).
  const onPrescription = data.cart.lines.map((l) => {
    if (!run || !l.decision.prescriptionRequired) return { productId: l.productId, found: null as boolean | null };
    const found = run.lines.some(
      (x) =>
        x.medicineName &&
        (normaliseName(x.medicineName) === normaliseName(l.product.molecule) || x.matchedProduct?.genericGroup === l.product.genericGroup) &&
        normaliseStrength(x.strength) === normaliseStrength(l.product.strength),
    );
    return { productId: l.productId, found };
  });

  return (
    <div>
      <PageHeader title="Checkout" eyebrow={`${t("home.orderingFor")}: ${selected.name}`} />
      <CheckoutForm
        patient={{ id: selected.id, name: selected.name }}
        source={sp.source === "REORDER" || sp.source === "REFILL_REMINDER" ? sp.source : "CATALOGUE"}
        lines={data.cart.lines.map((l) => ({
          productId: l.productId,
          name: l.product.name,
          packLabel: l.product.packLabel,
          quantity: l.quantity,
          linePaise: l.product.pricePaise * l.quantity,
          prescriptionRequired: l.decision.prescriptionRequired,
          h1: l.decision.h1RegisterRequired,
          onPrescription: onPrescription.find((o) => o.productId === l.productId)?.found ?? null,
        }))}
        subtotal={data.cart.subtotal}
        needsPrescription={data.cart.needsPrescription}
        prescriptions={data.prescriptions.map((p) => ({
          id: p.id,
          uploadedAt: p.uploadedAt.toISOString(),
          mimeType: p.mimeType,
          extractionStatus: p.extractionRuns[0]?.status ?? null,
          lastReview: p.reviews[0]?.outcome ?? null,
        }))}
        selectedRx={data.selectedRx ? { id: data.selectedRx.id, mimeType: data.selectedRx.mimeType } : null}
        viewKey={randomUUID()}
        run={run ? JSON.parse(JSON.stringify(run)) : null}
        localities={data.localities.map((l) => ({ id: l.id, name: l.name, pincode: l.pincode }))}
        localityId={data.localityId}
        defaultAddress={data.user.addressLine ?? ""}
        routing={data.routing ? { store: data.routing.store, unavailable: data.cart.lines.filter((l) => data.routing!.unavailableProductIds.includes(l.productId)).map((l) => l.product.name) } : null}
        labels={{ submit: t("cta.submitOrder"), upload: t("cta.upload"), testMode: t("payment.testMode"), rxRequired: t("rx.required") }}
      />
    </div>
  );
}
