"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, Minus, Plus, RotateCcw, ShoppingBag, Trash2 } from "lucide-react";
import type { Channel } from "@prisma/client";
import {
  addToCartAction,
  cancelOrderAction,
  refillOptInAction,
  refillToCartAction,
  reorderAction,
  respondSubstitutionAction,
  setCartQuantityAction,
} from "@/app/actions/customer";
import { Button, Select, Textarea, type ButtonSize, type ButtonVariant } from "@/components/ui";

type Result = { ok: true; message?: string } | { ok: false; error: { message: string; details: string[] } };

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Result>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        if (r.message) toast.success(r.message);
        after?.();
        router.refresh();
      } else {
        toast.error(r.error.message, { description: r.error.details.join(" · ") || undefined });
      }
    });
  return { pending, run, router };
}

export function AddToCartButton({ familyMemberId, productId, label, disabled }: { familyMemberId: string; productId: string; label: string; disabled?: boolean }) {
  const { pending, run } = useRun();
  return (
    <Button size="md" variant="secondary" disabled={disabled || pending} onClick={() => run(() => addToCartAction(familyMemberId, productId))}>
      {pending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <ShoppingBag aria-hidden className="size-4" />}
      {label}
    </Button>
  );
}

export function QuantityStepper({ familyMemberId, productId, quantity, name }: { familyMemberId: string; productId: string; quantity: number; name: string }) {
  const { pending, run } = useRun();
  const set = (q: number) => run(() => setCartQuantityAction(familyMemberId, productId, q));
  return (
    <div className="flex items-center gap-2">
      <div className="inline-flex items-center rounded-xl border border-line-strong" aria-busy={pending}>
        <button type="button" aria-label={`Decrease ${name}`} disabled={pending || quantity <= 1} onClick={() => set(quantity - 1)} className="grid size-11 place-items-center disabled:opacity-40">
          <Minus aria-hidden className="size-4" />
        </button>
        <span className="w-8 text-center text-lg font-semibold tabular-nums" aria-live="polite">
          {quantity}
        </span>
        <button type="button" aria-label={`Increase ${name}`} disabled={pending || quantity >= 20} onClick={() => set(quantity + 1)} className="grid size-11 place-items-center disabled:opacity-40">
          <Plus aria-hidden className="size-4" />
        </button>
      </div>
      <button type="button" aria-label={`Remove ${name}`} disabled={pending} onClick={() => set(0)} className="grid size-11 place-items-center rounded-xl text-muted hover:bg-bad-soft hover:text-bad">
        <Trash2 aria-hidden className="size-4" />
      </button>
    </div>
  );
}

export function ReorderButton({ orderId, label, size = "lg", variant = "primary", className }: { orderId: string; label: string; size?: ButtonSize; variant?: ButtonVariant; className?: string }) {
  const { pending, run, router } = useRun();
  return (
    <Button
      size={size}
      variant={variant}
      className={className}
      disabled={pending}
      onClick={() =>
        run(async () => {
          const r = await reorderAction(orderId);
          if (r.ok) {
            if (r.data.skipped.length) toast.warning(`Not added (not available online): ${r.data.skipped.join(", ")}`);
            router.push("/cart?source=REORDER");
          }
          return r;
        })
      }
    >
      {pending ? <Loader2 aria-hidden className="size-5 animate-spin" /> : <RotateCcw aria-hidden className="size-5" />}
      {label}
    </Button>
  );
}

export function RefillToCartButton({ planId, label }: { planId: string; label: string }) {
  const { pending, run, router } = useRun();
  return (
    <Button
      size="md"
      disabled={pending}
      onClick={() =>
        run(async () => {
          const r = await refillToCartAction(planId);
          if (r.ok) router.push("/cart?source=REFILL_REMINDER");
          return r;
        })
      }
    >
      {pending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <RotateCcw aria-hidden className="size-4" />}
      {label}
    </Button>
  );
}

export function RefillOptIn({ planId, optedIn, channel }: { planId: string; optedIn: boolean; channel: Channel }) {
  const { pending, run } = useRun();
  const [ch, setCh] = useState<Channel>(channel);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-[15px] font-medium">
        <input
          type="checkbox"
          className="size-5 accent-[var(--color-brand)]"
          checked={optedIn}
          disabled={pending}
          onChange={(e) => run(() => refillOptInAction(planId, e.target.checked, ch))}
        />
        Remind me before this runs out
      </label>
      <label className="sr-only" htmlFor={`ch-${planId}`}>
        Reminder channel
      </label>
      <Select
        id={`ch-${planId}`}
        value={ch}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value as Channel;
          setCh(next);
          if (optedIn) run(() => refillOptInAction(planId, true, next));
        }}
        className="w-auto min-w-36 text-sm"
      >
        <option value="IN_APP">In the app</option>
        <option value="SMS">SMS (mock)</option>
        <option value="WHATSAPP">WhatsApp (mock)</option>
      </Select>
    </div>
  );
}

export function ConsentButtons({ proposalId, orderId }: { proposalId: string; orderId: string }) {
  const { pending, run } = useRun();
  return (
    <div className="flex flex-wrap gap-3">
      <Button disabled={pending} onClick={() => run(() => respondSubstitutionAction(proposalId, true, orderId))}>
        Yes, I consent to the generic
      </Button>
      <Button variant="outline" disabled={pending} onClick={() => run(() => respondSubstitutionAction(proposalId, false, orderId))}>
        No, keep what I ordered
      </Button>
    </div>
  );
}

export function CancelOrder({ orderId }: { orderId: string }) {
  const { pending, run } = useRun();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open) {
    return (
      <Button variant="danger-outline" onClick={() => setOpen(true)}>
        Cancel order
      </Button>
    );
  }
  return (
    <div className="w-full space-y-3 rounded-xl border border-bad/30 bg-bad-soft/40 p-4">
      <label htmlFor="cancel-reason" className="block text-sm font-semibold">
        Why are you cancelling?
      </label>
      <Textarea id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="For example: ordered by mistake" />
      <div className="flex gap-2">
        <Button variant="danger" disabled={pending || reason.trim().length < 3} onClick={() => run(() => cancelOrderAction(orderId, reason), () => setOpen(false))}>
          Confirm cancellation
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Keep order
        </Button>
      </div>
    </div>
  );
}
