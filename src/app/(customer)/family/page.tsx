import type { Metadata } from "next";
import { UserRound } from "lucide-react";
import { relationLabel } from "@/lib/relations";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { requirePageRole } from "@/server/auth/session";
import { getFamily } from "@/server/queries/customer";
import { AddFamilyForm, ProfileForm } from "./forms";

export const metadata: Metadata = { title: "Family" };

export default async function FamilyPage() {
  const actor = await requirePageRole(["CUSTOMER"]);
  const { user, members, localities } = await getFamily(actor);
  return (
    <div className="space-y-5">
      <PageHeader title="Family & profile" description="Order for yourself, a parent or anyone you care for. Each person has their own cart, prescriptions and reminders." />
      <Card>
        <CardHeader title="People you order for" />
        <ul className="divide-y divide-line">
          {members.map((m) => (
            <li key={m.id} className="flex items-center gap-3 px-5 py-3.5">
              <span className="grid size-10 place-items-center rounded-full bg-brand-soft text-brand">
                <UserRound aria-hidden className="size-5" />
              </span>
              <div className="flex-1">
                <p className="font-semibold">{m.name}</p>
                <p className="text-sm text-muted">
                  {relationLabel(m.relation)}
                  {m.yearOfBirth ? ` · born ${m.yearOfBirth}` : ""}
                </p>
              </div>
              <Badge>{m._count.orders} orders</Badge>
            </li>
          ))}
        </ul>
        <div className="border-t border-line p-5">
          <AddFamilyForm />
        </div>
      </Card>
      <Card>
        <CardHeader title="Your details" description="Used for delivery and to find the nearest store with stock." />
        <div className="p-5">
          <ProfileForm name={user.name} addressLine={user.addressLine ?? ""} localityId={user.defaultLocalityId ?? ""} localities={localities.map((l) => ({ id: l.id, name: l.name }))} phone={user.phone} />
        </div>
      </Card>
    </div>
  );
}
