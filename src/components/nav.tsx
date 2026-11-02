"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";
import { Globe } from "lucide-react";
import { setLanguageAction } from "@/app/actions/auth";
import { LOCALES, type Locale } from "@/lib/i18n/dictionaries";
import { cn } from "@/lib/cn";

export type NavItem = { href: string; label: string; badge?: number; icon?: React.ReactNode; exact?: boolean };

function isActive(pathname: string, item: NavItem) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function NavLinks({ items, className }: { items: NavItem[]; className?: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className={cn("items-center gap-1", className)}>
      {items.map((item) => {
        const active = isActive(pathname, item);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[15px] font-medium",
              active ? "bg-brand-soft text-brand-strong" : "text-ink-soft hover:bg-canvas",
            )}
          >
            {item.icon}
            {item.label}
            {item.badge ? <span className="rounded-full bg-brand px-1.5 text-xs font-bold text-white">{item.badge}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}

/** Mobile bottom tab bar for the customer app: large targets, labels always visible. */
export function BottomTabs({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
      <ul className="mx-auto grid max-w-lg" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((item) => {
          const active = isActive(pathname, item);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn("relative flex min-h-16 flex-col items-center justify-center gap-0.5 text-[13px] font-medium", active ? "text-brand-strong" : "text-muted")}
              >
                {item.icon}
                {item.label}
                {item.badge ? (
                  <span className="absolute right-[22%] top-2 min-w-5 rounded-full bg-brand px-1 text-center text-[11px] font-bold leading-5 text-white">{item.badge}</span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function LanguageSwitcher({ locale }: { locale: Locale }) {
  const form = useRef<HTMLFormElement>(null);
  return (
    <form ref={form} action={setLanguageAction} className="flex items-center">
      <label htmlFor="lang-switch" className="sr-only">
        Language
      </label>
      <Globe aria-hidden className="mr-1 size-4 text-muted" />
      <select
        id="lang-switch"
        name="lang"
        defaultValue={locale}
        onChange={() => form.current?.requestSubmit()}
        className="min-h-10 rounded-lg border border-line bg-surface px-1.5 text-sm"
      >
        {Object.entries(LOCALES).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
    </form>
  );
}
