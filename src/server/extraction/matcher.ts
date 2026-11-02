import type { MatchCandidate } from "./types";

export type CatalogueEntry = {
  id: string;
  name: string;
  molecule: string;
  strength: string;
  form: string;
  genericGroup: string | null;
  active: boolean;
};

const FORM_WORDS = /\b(tab|tabs|tablet|tablets|cap|caps|capsule|capsules|syp|syrup|inj|injection)\b/g;

export function normaliseName(s: string) {
  return s.toLowerCase().replace(FORM_WORDS, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

/** "500 mg", "500mg", "50 µg" → "500mg" / "50mcg" for exact comparison. */
export function normaliseStrength(s: string | null) {
  if (!s) return null;
  return s.toLowerCase().replace(/µg|ug/g, "mcg").replace(/\s+/g, "");
}

function bigrams(s: string) {
  const t = s.replace(/\s+/g, " ");
  const out: string[] = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  return out;
}

/** Sørensen–Dice similarity on character bigrams, 0..1. */
export function similarity(a: string, b: string) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.length || !B.length) return 0;
  const counts = new Map<string, number>();
  for (const g of A) counts.set(g, (counts.get(g) ?? 0) + 1);
  let overlap = 0;
  for (const g of B) {
    const c = counts.get(g) ?? 0;
    if (c > 0) {
      overlap++;
      counts.set(g, c - 1);
    }
  }
  return (2 * overlap) / (A.length + B.length);
}

/** Product name without its strength, e.g. "Glucofine 500" → "glucofine". */
function brandStem(p: CatalogueEntry) {
  return normaliseName(p.name.replace(/\d+(\.\d+)?\s*(mg|mcg|g|ml|iu)?/gi, " "));
}

export type MatchResult = {
  status: "MATCHED" | "AMBIGUOUS" | "UNMATCHED";
  productId: string | null;
  score: number | null;
  reason: string;
  candidates: MatchCandidate[];
};

/**
 * Proposes catalogue products for one extracted line. Equivalent products (same generic group)
 * are treated as one medicine; different medicines scoring close together stay AMBIGUOUS.
 * The result is a suggestion for the pharmacist only.
 */
export function matchToCatalogue(
  line: { medicineName: string | null; strength: string | null },
  catalogue: CatalogueEntry[],
  minScore: number,
): MatchResult {
  if (!line.medicineName) {
    return { status: "UNMATCHED", productId: null, score: null, reason: "Medicine name not legible.", candidates: [] };
  }
  const name = normaliseName(line.medicineName);
  const strength = normaliseStrength(line.strength);

  const scored = catalogue
    .filter((p) => p.active)
    .map((p) => {
      const stemScore = similarity(name, brandStem(p));
      const nameScore = Math.max(similarity(name, normaliseName(p.molecule)), stemScore);
      const pStrength = normaliseStrength(p.strength);
      let score = nameScore;
      let reason: string;
      if (!strength) {
        score = nameScore * 0.6;
        reason = "name similar; strength not legible";
      } else if (pStrength === strength) {
        reason = nameScore === 1 ? "exact name and strength" : `name ${(nameScore * 100).toFixed(0)}% similar; strength matches`;
      } else {
        score = nameScore * 0.4;
        reason = `name similar; strength differs (${p.strength})`;
      }
      return { p, score: round3(score), nameScore, stemScore, reason };
    })
    .filter((c) => c.nameScore >= 0.5)
    // Ties (brand vs generic of the same molecule) go to the product literally named on the prescription.
    .sort((a, b) => b.score - a.score || b.stemScore - a.stemScore);

  const candidates: MatchCandidate[] = scored
    .slice(0, 5)
    .map((c) => ({ productId: c.p.id, label: `${c.p.name} (${c.p.strength})`, score: c.score, reason: c.reason }));

  if (!scored.length) {
    return { status: "UNMATCHED", productId: null, score: null, reason: "No similar product in the catalogue.", candidates };
  }
  const best = scored[0];
  if (best.score < minScore) {
    return {
      status: strength ? "UNMATCHED" : "AMBIGUOUS",
      productId: null,
      score: best.score,
      reason: strength ? "Closest catalogue products are below the match threshold." : "Strength not legible; several products possible.",
      candidates,
    };
  }
  const group = (c: (typeof scored)[number]) => c.p.genericGroup ?? c.p.id;
  const rival = scored.find((c) => group(c) !== group(best) && best.score - c.score < 0.1);
  if (rival) {
    return {
      status: "AMBIGUOUS",
      productId: null,
      score: best.score,
      reason: `Could be ${best.p.name} or ${rival.p.name}.`,
      candidates,
    };
  }
  return { status: "MATCHED", productId: best.p.id, score: best.score, reason: best.reason, candidates };
}

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}
