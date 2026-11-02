import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import { OfflineBanner } from "@/components/client-ui";
import { config } from "@/server/env";
import { getLocale, getT } from "@/lib/i18n/server";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Company A Pharmacy", template: "%s · Company A Pharmacy" },
  description: "Prototype: online reordering with pharmacist prescription checks. Synthetic demo data only.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0f6b5c" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [locale, t] = [await getLocale(), await getT()];
  const demo = config().APP_ENV !== "production";
  return (
    <html lang={locale === "bn" ? "bn" : locale === "hi" ? "hi" : "en-IN"}>
      <body className="min-h-dvh antialiased">
        <OfflineBanner />
        {demo ? (
          <div className="bg-warn-soft px-4 py-1.5 text-center text-[13px] font-medium text-warn" data-testid="demo-banner">
            {t("banner.demo")}
          </div>
        ) : null}
        {children}
        <Toaster position="top-center" richColors closeButton toastOptions={{ style: { fontSize: "15px" } }} />
      </body>
    </html>
  );
}
