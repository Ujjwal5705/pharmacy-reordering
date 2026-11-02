"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { addFamilyMemberAction, updateProfileAction } from "@/app/actions/customer";
import { Button, Field, Input, Select } from "@/components/ui";

export function AddFamilyForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [form, setForm] = useState({ name: "", relation: "MOTHER", yearOfBirth: "" });
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Plus aria-hidden className="size-4" /> Add a family member
      </Button>
    );
  }
  return (
    <form
      className="grid gap-4 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const r = await addFamilyMemberAction(form);
          if (!r.ok) return setError(r.error.message);
          toast.success(r.message ?? "Added");
          setOpen(false);
          setForm({ name: "", relation: "MOTHER", yearOfBirth: "" });
          router.refresh();
        });
      }}
    >
      <Field label="Name" htmlFor="fm-name" error={error}>
        <Input id="fm-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={80} />
      </Field>
      <Field label="Relationship" htmlFor="fm-rel">
        <Select id="fm-rel" value={form.relation} onChange={(e) => setForm({ ...form, relation: e.target.value })}>
          {["MOTHER", "FATHER", "SPOUSE", "CHILD", "SIBLING", "GRANDPARENT", "OTHER"].map((r) => (
            <option key={r} value={r}>
              {r.charAt(0) + r.slice(1).toLowerCase()}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Year of birth (optional)" htmlFor="fm-yob">
        <Input id="fm-yob" inputMode="numeric" value={form.yearOfBirth} onChange={(e) => setForm({ ...form, yearOfBirth: e.target.value.replace(/\D/g, "").slice(0, 4) })} />
      </Field>
      <div className="flex gap-2 sm:col-span-3">
        <Button type="submit" disabled={pending || form.name.trim().length < 2}>
          Save
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function ProfileForm(props: { name: string; addressLine: string; localityId: string; localities: { id: string; name: string }[]; phone: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [form, setForm] = useState({ name: props.name, addressLine: props.addressLine, localityId: props.localityId });
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const r = await updateProfileAction(form);
          if (!r.ok) return setError(r.error.message);
          toast.success(r.message ?? "Saved");
          router.refresh();
        });
      }}
    >
      <Field label="Your name" htmlFor="pf-name">
        <Input id="pf-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} />
      </Field>
      <Field label="Mobile" htmlFor="pf-phone" hint="Used for sign-in codes.">
        <Input id="pf-phone" value={`+91 ${props.phone}`} disabled />
      </Field>
      <Field label="Area" htmlFor="pf-area">
        <Select id="pf-area" value={form.localityId} onChange={(e) => setForm({ ...form, localityId: e.target.value })}>
          <option value="">Choose your area</option>
          {props.localities.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Delivery address" htmlFor="pf-addr" error={error}>
        <Input id="pf-addr" value={form.addressLine} onChange={(e) => setForm({ ...form, addressLine: e.target.value })} maxLength={200} />
      </Field>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          Save details
        </Button>
      </div>
    </form>
  );
}
