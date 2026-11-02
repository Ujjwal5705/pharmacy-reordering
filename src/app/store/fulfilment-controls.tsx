"use client";

import type { OrderStatus } from "@prisma/client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { fulfilmentAction } from "@/app/actions/staff";
import { Button, Field, Input } from "@/components/ui";
import type { FulfilmentInput } from "@/server/services/orders";

export function FulfilmentControls({ orderId, status }: { orderId: string; status: OrderStatus }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [invoice, setInvoice] = useState("");
  const [partner, setPartner] = useState("");
  const run = (input: FulfilmentInput) =>
    start(async () => {
      const r = await fulfilmentAction(orderId, input);
      if (!r.ok) return void toast.error(r.error.message, { description: r.error.details.join(" · ") || undefined });
      toast.success(r.message ?? "Updated");
      router.refresh();
    });
  const spin = pending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null;

  if (status === "APPROVED") return <Button className="w-full" disabled={pending} onClick={() => run({ step: "START_PICKING" })}>{spin}Start picking</Button>;
  if (status === "PICKING") {
    return (
      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); run({ step: "MARK_PACKED", storeInvoiceNumber: invoice }); }}>
        <Field label="Store invoice number" htmlFor={`inv-${orderId}`} hint="From the store billing system.">
          <Input id={`inv-${orderId}`} value={invoice} onChange={(e) => setInvoice(e.target.value)} placeholder="e.g. BH-INV-2026-0123" maxLength={30} />
        </Field>
        <Button type="submit" className="w-full" disabled={pending || invoice.trim().length < 3}>{spin}Mark packed</Button>
      </form>
    );
  }
  if (status === "PACKED") {
    return (
      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); run({ step: "HAND_OVER", deliveryPartner: partner }); }}>
        <Field label="Handed to" htmlFor={`dp-${orderId}`}>
          <Input id={`dp-${orderId}`} value={partner} onChange={(e) => setPartner(e.target.value)} placeholder="Delivery person or partner" maxLength={60} />
        </Field>
        <Button type="submit" className="w-full" disabled={pending || partner.trim().length < 2}>{spin}Hand over to delivery</Button>
      </form>
    );
  }
  if (status === "HANDED_TO_DELIVERY") return <Button variant="secondary" className="w-full" disabled={pending} onClick={() => run({ step: "MARK_DELIVERED" })}>{spin}Mark delivered</Button>;
  return null;
}
