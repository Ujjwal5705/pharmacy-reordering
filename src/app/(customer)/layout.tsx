import { ClipboardList, Home, Search, ShoppingBag, Users } from "lucide-react";
import { BottomTabs } from "@/components/nav";
import { PatientSwitcher } from "@/components/customer/patient-switcher";
import { AppHeader, PermissionDenied } from "@/components/shell";
import { homeFor, requirePageActor } from "@/server/auth/session";
import { getSelectedPatient } from "@/server/customer-context";
import { cartCount } from "@/server/queries/customer";
import { getT } from "@/lib/i18n/server";

export default async function CustomerLayout({ children }: { children: React.ReactNode }) {
  const actor = await requirePageActor();
  if (actor.role !== "CUSTOMER") return <PermissionDenied homeHref={homeFor(actor.role)} />;
  const t = await getT();
  const { members, selected } = await getSelectedPatient(actor);
  const count = await cartCount(actor, selected?.id);
  const icon = "size-5";
  const nav = [
    { href: "/", label: t("nav.home"), icon: <Home aria-hidden className={icon} />, exact: true },
    { href: "/medicines", label: t("nav.medicines"), icon: <Search aria-hidden className={icon} /> },
    { href: "/cart", label: t("nav.cart"), icon: <ShoppingBag aria-hidden className={icon} />, badge: count || undefined },
    { href: "/orders", label: t("nav.orders"), icon: <ClipboardList aria-hidden className={icon} /> },
    { href: "/family", label: t("nav.family"), icon: <Users aria-hidden className={icon} /> },
  ];
  return (
    <>
      <AppHeader homeHref="/" nav={nav} userLabel={actor.name} signOutLabel={t("nav.signOut")} />
      <div className="border-b border-line bg-surface">
        <div className="mx-auto max-w-4xl px-4 py-2.5">
          <PatientSwitcher
            label={t("home.orderingFor")}
            members={members.map((m) => ({ id: m.id, name: m.name, relation: m.relation }))}
            selectedId={selected?.id ?? null}
          />
        </div>
      </div>
      <main className="mx-auto max-w-4xl px-4 pb-28 pt-6 text-[17px] lg:pb-12">{children}</main>
      <BottomTabs items={nav} />
    </>
  );
}
