const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2, minimumFractionDigits: 0 });

export function money(paise: number) {
  return inr.format(paise / 100);
}

const IST = "Asia/Kolkata";

export function dateTime(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: IST }).format(new Date(d));
}

export function dateOnly(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: IST }).format(new Date(d));
}

/** "4 min", "2 h 5 min", "3 days" */
export function age(from: Date | string, to: Date = new Date()) {
  const mins = Math.max(0, Math.round((to.getTime() - new Date(from).getTime()) / 60_000));
  if (mins < 60) return `${mins} min`;
  if (mins < 60 * 24) return `${Math.floor(mins / 60)} h ${mins % 60} min`;
  return `${Math.floor(mins / 1440)} days`;
}

export function daysUntil(d: Date | string, now: Date = new Date()) {
  return Math.ceil((new Date(d).getTime() - now.getTime()) / 86_400_000);
}

export function pct(n: number | null | undefined) {
  return n === null || n === undefined ? "—" : `${Math.round(n * 100)}%`;
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

/** Avoids "…, Salt Lake, Salt Lake" when the address line already names the area. */
export function addressWithArea(address: string, area: string) {
  return address.toLowerCase().includes(area.toLowerCase()) ? address : `${address}, ${area}`;
}

/** Ends free text (e.g. a pharmacist's reason) with punctuation before more text follows it. */
export function withFullStop(text: string) {
  const t = text.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}
