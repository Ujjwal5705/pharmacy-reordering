const DAY_MS = 24 * 60 * 60 * 1000;

export type RefillInput = {
  packs: number;
  unitsPerPack: number;
  /** Pharmacist-confirmed units taken per day. Null when not confirmed. */
  unitsPerDay: number | null;
  /** When the supply started (delivery date). Null while not yet delivered. */
  startDate: Date | null;
  remindDaysBefore: number;
};

export type RefillEstimate =
  | { kind: "NEEDS_DOSAGE"; unitsSupplied: number; explanation: string }
  | { kind: "AWAITING_DELIVERY"; unitsSupplied: number; daysSupply: number; explanation: string }
  | {
      kind: "ESTIMATED";
      unitsSupplied: number;
      daysSupply: number;
      runOutDate: Date;
      remindAt: Date;
      explanation: string;
    };

export const MAX_UNITS_PER_DAY = 24;

/**
 * Estimates when a supply runs out: units supplied ÷ units per day. Only uses pharmacist-confirmed
 * dosage; never guesses a missing dosage and never recommends a dose.
 */
export function estimateRefill(input: RefillInput): RefillEstimate {
  const unitsSupplied = input.packs * input.unitsPerPack;
  const upd = input.unitsPerDay;
  if (upd === null || !Number.isFinite(upd) || upd <= 0 || upd > MAX_UNITS_PER_DAY) {
    return {
      kind: "NEEDS_DOSAGE",
      unitsSupplied,
      explanation: "Daily dosage has not been confirmed by a pharmacist, so no run-out date can be estimated.",
    };
  }
  const daysSupply = Math.floor(unitsSupplied / upd);
  const formula = `${unitsSupplied} units ÷ ${trim(upd)} per day = ${daysSupply} days`;
  if (!input.startDate) {
    return {
      kind: "AWAITING_DELIVERY",
      unitsSupplied,
      daysSupply,
      explanation: `${formula}. The estimate starts once the order is delivered.`,
    };
  }
  const runOutDate = new Date(input.startDate.getTime() + daysSupply * DAY_MS);
  const remindMs = Math.max(input.startDate.getTime(), runOutDate.getTime() - input.remindDaysBefore * DAY_MS);
  return {
    kind: "ESTIMATED",
    unitsSupplied,
    daysSupply,
    runOutDate,
    remindAt: new Date(remindMs),
    explanation: `${formula} from delivery. Reminder ${input.remindDaysBefore} days before.`,
  };
}

function trim(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}
