"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createPolicyAction } from "@/app/actions/staff";
import { Alert, Button, Field, Input, Select } from "@/components/ui";

const today = () => new Date().toISOString().slice(0, 10);

export function PolicyForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<{ message: string; details: string[] } | null>(null);
  const [f, setF] = useState({
    category: "SCHEDULE_H",
    effectiveFrom: today(),
    effectiveTo: "",
    onlineOrderable: true,
    prescriptionRequired: true,
    pharmacistApprovalRequired: true,
    h1RegisterRequired: false,
    description: "",
  });
  const check = (k: "onlineOrderable" | "prescriptionRequired" | "pharmacistApprovalRequired" | "h1RegisterRequired", label: string) => (
    <label className="inline-flex min-h-11 items-center gap-2 text-[15px]">
      <input type="checkbox" className="size-5 accent-[var(--color-brand)]" checked={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} />
      {label}
    </label>
  );
  return (
    <form
      className="grid gap-4 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const r = await createPolicyAction(f);
          if (!r.ok) return setError(r.error);
          toast.success(r.message ?? "Saved");
          setF({ ...f, description: "" });
          router.refresh();
        });
      }}
    >
      <Field label="Category" htmlFor="pol-cat">
        <Select id="pol-cat" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
          <option value="OTC">Non-scheduled (OTC)</option>
          <option value="SCHEDULE_H">Schedule H</option>
          <option value="SCHEDULE_H1">Schedule H1</option>
          <option value="SCHEDULE_X">Schedule X</option>
          <option value="NARCOTIC">Narcotic</option>
        </Select>
      </Field>
      <Field label="Effective from" htmlFor="pol-from">
        <Input id="pol-from" type="date" value={f.effectiveFrom} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })} />
      </Field>
      <Field label="Effective to (optional)" htmlFor="pol-to">
        <Input id="pol-to" type="date" value={f.effectiveTo} onChange={(e) => setF({ ...f, effectiveTo: e.target.value })} />
      </Field>
      <div className="flex flex-wrap gap-x-6 sm:col-span-3">
        {check("onlineOrderable", "Sold online")}
        {check("prescriptionRequired", "Prescription required")}
        {check("pharmacistApprovalRequired", "Pharmacist approval required")}
        {check("h1RegisterRequired", "H1 register required")}
      </div>
      <Field label="Reason for this version" htmlFor="pol-desc" className="sm:col-span-3" hint={f.description.trim().length < 5 ? `At least 5 characters (${f.description.trim().length}/5) to save.` : "Kept in the version history."}>
        <Input id="pol-desc" value={f.description} maxLength={300} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="e.g. Updated after notification of final online pharmacy rules" />
      </Field>
      <div className="sm:col-span-3">
        <Button type="submit" disabled={pending || f.description.trim().length < 5}>
          Save new version
        </Button>
      </div>
      {error ? (
        <Alert tone="bad" title={error.message} className="sm:col-span-3">
          {error.details.length ? <ul className="list-disc pl-5">{error.details.map((d) => <li key={d}>{d}</li>)}</ul> : null}
        </Alert>
      ) : null}
    </form>
  );
}
