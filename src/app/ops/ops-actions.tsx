"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { BellRing, Loader2, Route } from "lucide-react";
import { retryRoutingAction, runRemindersAction } from "@/app/actions/staff";
import { Button } from "@/components/ui";

export function OpsActions() {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await runRemindersAction();
          if (!r.ok) return void toast.error(r.error.message);
          toast.success(`Reminder job ran: ${r.data.sent} mock notification(s) logged, ${r.data.checked} due.`, { description: "No real SMS/WhatsApp was sent and no orders were created." });
        })
      }
    >
      {pending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <BellRing aria-hidden className="size-4" />}
      Run refill reminder job (mock)
    </Button>
  );
}

export function RetryRoutingButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await retryRoutingAction(orderId);
          if (!r.ok) return void toast.warning(r.error.message);
          toast.success(r.message ?? "Routed");
          router.refresh();
        })
      }
    >
      {pending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Route aria-hidden className="size-4" />}
      Retry routing
    </Button>
  );
}
