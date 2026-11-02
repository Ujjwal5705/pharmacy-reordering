"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Plus, UserRound } from "lucide-react";
import { selectPatientAction } from "@/app/actions/customer";
import { cn } from "@/lib/cn";
import { relationLabel } from "@/lib/relations";

/** Always-visible patient context: who this order is for. */
export function PatientSwitcher({ label, members, selectedId }: { label: string; members: { id: string; name: string; relation: string }[]; selectedId: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-2" aria-busy={pending}>
      <span className="shrink-0 text-sm font-semibold text-muted">{label}:</span>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
        {members.map((m) => {
          const active = m.id === selectedId;
          return (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={pending}
              onClick={() =>
                !active &&
                start(async () => {
                  const r = await selectPatientAction(m.id);
                  if (!r.ok) toast.error(r.error.message);
                  router.refresh();
                })
              }
              className={cn(
                "inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[15px] font-medium transition-colors",
                active ? "border-brand bg-brand text-white" : "border-line-strong bg-surface text-ink-soft hover:border-brand",
              )}
            >
              <UserRound aria-hidden className="size-4" />
              {m.name}
              <span className={cn("text-xs", active ? "text-white/85" : "text-muted")}>· {relationLabel(m.relation)}</span>
            </button>
          );
        })}
        <Link href="/family" className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-full border border-dashed border-line-strong px-3 text-sm font-medium text-muted hover:text-brand">
          <Plus aria-hidden className="size-4" /> Add
        </Link>
      </div>
    </div>
  );
}
