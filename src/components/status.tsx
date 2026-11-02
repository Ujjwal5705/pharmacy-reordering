import type { MedicineCategory, OrderItemStatus, OrderStatus } from "@prisma/client";
import { Ban, FileCheck2, FileWarning, ShieldCheck } from "lucide-react";
import type { T } from "@/lib/i18n/dictionaries";
import { Badge, type Tone } from "./ui";

const STATUS_TONE: Record<OrderStatus, Tone> = {
  AWAITING_PHARMACIST: "info",
  NEEDS_REUPLOAD: "warn",
  AWAITING_CUSTOMER_CONSENT: "warn",
  APPROVED: "ok",
  REJECTED: "bad",
  PICKING: "brand",
  PACKED: "brand",
  HANDED_TO_DELIVERY: "brand",
  DELIVERED: "ok",
  CANCELLED: "neutral",
};

export function OrderStatusBadge({ status, t }: { status: OrderStatus; t: T }) {
  return <Badge tone={STATUS_TONE[status]}>{t(`status.${status}`)}</Badge>;
}

export function CategoryBadge({ category, orderable, t }: { category: MedicineCategory; orderable: boolean; t: T }) {
  if (!orderable) {
    return (
      <Badge tone="bad">
        <Ban aria-hidden className="size-3.5" /> {t("rx.blocked")}
      </Badge>
    );
  }
  if (category === "SCHEDULE_H1") {
    return (
      <Badge tone="warn">
        <FileWarning aria-hidden className="size-3.5" /> {t("rx.h1")}
      </Badge>
    );
  }
  if (category === "SCHEDULE_H") {
    return (
      <Badge tone="info">
        <FileCheck2 aria-hidden className="size-3.5" /> {t("rx.required")}
      </Badge>
    );
  }
  return <Badge tone="neutral">{t("rx.otc")}</Badge>;
}

export const CATEGORY_LABEL: Record<MedicineCategory, string> = {
  OTC: "Non-scheduled",
  SCHEDULE_H: "Schedule H",
  SCHEDULE_H1: "Schedule H1",
  SCHEDULE_X: "Schedule X",
  NARCOTIC: "Narcotic",
};

const ITEM_STATUS: Record<OrderItemStatus, { tone: Tone; label: string }> = {
  PENDING_REVIEW: { tone: "info", label: "Awaiting pharmacist" },
  NOT_REQUIRED: { tone: "neutral", label: "No prescription needed" },
  APPROVED: { tone: "ok", label: "Pharmacist approved" },
  REJECTED: { tone: "bad", label: "Not approved" },
  AWAITING_CONSENT: { tone: "warn", label: "Awaiting your consent" },
};

export function ItemStatusBadge({ status }: { status: OrderItemStatus }) {
  const s = ITEM_STATUS[status];
  return (
    <Badge tone={s.tone}>
      {status === "APPROVED" ? <ShieldCheck aria-hidden className="size-3.5" /> : null}
      {s.label}
    </Badge>
  );
}

/** Confidence shown as words plus a percentage, so it is not conveyed by colour alone. */
export function ConfidenceBadge({ value, threshold = 0.8 }: { value: number | null | undefined; threshold?: number }) {
  if (value === null || value === undefined || value === 0) return <Badge tone="bad">Not legible</Badge>;
  const p = Math.round(value * 100);
  if (value >= Math.max(0.9, threshold)) return <Badge tone="ok">High {p}%</Badge>;
  if (value >= threshold) return <Badge tone="warn">Check {p}%</Badge>;
  return <Badge tone="bad">Low {p}%</Badge>;
}
