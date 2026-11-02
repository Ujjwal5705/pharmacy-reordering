import "server-only";
import { cookies } from "next/headers";
import { isLocale, translator, type Locale } from "./dictionaries";

export const LANG_COOKIE = "lang";

export async function getLocale(): Promise<Locale> {
  const v = (await cookies()).get(LANG_COOKIE)?.value;
  return isLocale(v) ? v : "en";
}

export async function getT() {
  return translator(await getLocale());
}
