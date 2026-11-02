import Link from "next/link";
import type { ReactNode } from "react";
import { LogOut, Pill } from "lucide-react";
import { signOutAction } from "@/app/actions/auth";
import { getLocale } from "@/lib/i18n/server";
import { LanguageSwitcher, NavLinks, type NavItem } from "./nav";

export async function AppHeader({ homeHref, nav, userLabel, signOutLabel, wide = false, extra }: { homeHref: string; nav: NavItem[]; userLabel: string; signOutLabel: string; wide?: boolean; extra?: ReactNode }) {
  const locale = await getLocale();
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
      <div className={`mx-auto flex h-16 items-center gap-4 px-4 ${wide ? "max-w-7xl" : "max-w-4xl"}`}>
        <Link href={homeHref} className="flex shrink-0 items-center gap-2 font-bold text-brand-strong">
          <span className="rounded-lg bg-brand p-1.5 text-white">
            <Pill aria-hidden className="size-5" />
          </span>
          <span className="hidden sm:inline">Company A Pharmacy</span>
        </Link>
        <NavLinks items={nav} className="hidden md:flex" />
        <div className="ml-auto flex items-center gap-2">
          {extra}
          <LanguageSwitcher locale={locale} />
          <span className="hidden max-w-48 truncate text-sm text-muted lg:inline" title={userLabel}>
            {userLabel}
          </span>
          <form action={signOutAction}>
            <button type="submit" className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-ink-soft hover:bg-canvas">
              <LogOut aria-hidden className="size-4" />
              <span className="hidden sm:inline">{signOutLabel}</span>
            </button>
          </form>
        </div>
      </div>
      {nav.length ? (
        <div className={`mx-auto px-2 pb-2 md:hidden ${wide ? "max-w-7xl" : "max-w-4xl"} ${wide ? "" : "hidden"}`}>
          <NavLinks items={nav} className="flex overflow-x-auto" />
        </div>
      ) : null}
    </header>
  );
}

export function PermissionDenied({ homeHref }: { homeHref: string }) {
  return (
    <main className="mx-auto max-w-lg px-4 py-20 text-center">
      <h1 className="text-2xl font-bold">You don’t have access to this page</h1>
      <p className="mt-2 text-muted">This area is for a different role. If you think this is wrong, sign in with the right account.</p>
      <div className="mt-6 flex justify-center gap-3">
        <Link href={homeHref} className="font-semibold text-brand underline underline-offset-4">
          Go to your home page
        </Link>
      </div>
    </main>
  );
}
