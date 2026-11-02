import type { Role } from "@prisma/client";
import type { ReactNode } from "react";
import { AppHeader, PermissionDenied } from "@/components/shell";
import { homeFor, requirePageActor } from "@/server/auth/session";
import type { Actor } from "@/server/actor";
import { getT } from "@/lib/i18n/server";

/** Role-gated layout for staff areas. The UI gate is a convenience; every action re-checks on the server. */
export async function StaffShell({ roles, children }: { roles: Role[]; children: (actor: Actor) => ReactNode }) {
  const actor = await requirePageActor();
  if (!roles.includes(actor.role)) return <PermissionDenied homeHref={homeFor(actor.role)} />;
  const t = await getT();
  const nav =
    actor.role === "PHARMACIST"
      ? [{ href: "/pharmacist", label: t("nav.queue") }]
      : actor.role === "STORE_STAFF"
        ? [{ href: "/store", label: t("nav.store") }]
        : [
            { href: "/ops", label: t("nav.dashboard"), exact: true },
            { href: "/store", label: t("nav.store") },
            { href: "/ops/stock", label: t("nav.stock") },
            { href: "/ops/policies", label: t("nav.policies") },
          ];
  const roleLabel = { PHARMACIST: actor.pharmacistRegNo ? `Reg. ${actor.pharmacistRegNo}` : "Pharmacist", STORE_STAFF: "Store staff", OPS_ADMIN: "Operations", CUSTOMER: "" }[actor.role];
  return (
    <>
      <AppHeader homeHref={homeFor(actor.role)} nav={nav} userLabel={`${actor.name} · ${roleLabel}`} signOutLabel={t("nav.signOut")} wide />
      <main className="mx-auto max-w-7xl px-4 py-6">{children(actor)}</main>
    </>
  );
}
