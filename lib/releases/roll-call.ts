import { daysBetween } from "./dates.ts";
import type { LadderRung, Release } from "./types.ts";

/**
 * A14. Sold-out names in position order, commas and "&", the word RELEASE
 * once. A name that already ends in "release" keeps that word, so "Final
 * release" does not become "FINAL RELEASE RELEASE".
 */
export function soldOutLine(names: readonly string[]): string {
  const parts = names.map(namePart);
  const joined =
    parts.length <= 1
      ? (parts[0] ?? "")
      : parts.length === 2
        ? `${parts[0]} & ${parts[1]}`
        : `${parts.slice(0, -1).join(", ")} & ${parts[parts.length - 1]}`;
  return `${joined} RELEASE SOLD OUT`;
}

function namePart(name: string): string {
  return name.trim().replace(/\s+release$/i, "").toUpperCase();
}

function titledRelease(name: string): string {
  const upper = name.trim().toUpperCase();
  return /\bRELEASE\b/.test(upper) ? upper : `${upper} RELEASE`;
}

/** The floor, or final X when that release has a remaining figure. */
export function liveClaimLine(release: Pick<Release, "name" | "state" | "remaining" | "capacity" | "sold">): string {
  const titled = titledRelease(release.name);
  if (release.state === "final_x") {
    const left =
      release.remaining ??
      (release.capacity != null && release.sold != null ? release.capacity - release.sold : null);
    if (left != null) return `FINAL ${left} ${titled} TICKETS`;
  }
  return `${titled} SELLING FAST`;
}

function percentSold(release: Release): number | null {
  if (release.capacity == null || release.capacity <= 0 || release.sold == null) return null;
  return (release.sold / release.capacity) * 100;
}

function fillRelease(template: string, release: Release): string {
  return template.replaceAll("{release}", release.name);
}

/**
 * A rung that outranks the selling-fast floor, found by kind and value.
 * Null means this rung is not a higher line, or it is not met.
 */
function higherLine(release: Release, rung: LadderRung, nowIso: string): string | null {
  if (rung.triggerKind === "state" && rung.triggerValue === "final_x") {
    if (release.state !== "final_x") return null;
    return liveClaimLine(release);
  }
  if (rung.triggerKind === "state_days" && rung.triggerValue === "selling_fast") {
    if (release.sold != null) return null;
    if (release.state !== "selling_fast" && release.state !== "final_x") return null;
    if (!release.stateAt) return null;
    if (daysBetween(release.stateAt, nowIso) < (rung.options.days ?? 14)) return null;
    const words = rung.options.wording === "final_x" && rung.options.alt
      ? fillRelease(rung.options.alt, release)
      : fillRelease(rung.claimTemplate, release);
    return words.toUpperCase();
  }
  if (rung.triggerKind === "count_pct") {
    const pct = percentSold(release);
    if (pct == null || pct < Number(rung.triggerValue)) return null;
    if (rung.triggerValue === "90" && rung.options.wording === "final_x") return (rung.options.alt ?? "final X").toUpperCase();
    return fillRelease(rung.claimTemplate, release).toUpperCase();
  }
  if (rung.triggerKind === "page_remaining") {
    if (release.remaining == null || release.remaining > Number(rung.triggerValue)) return null;
    return fillRelease(rung.claimTemplate, release).toUpperCase();
  }
  return null;
}

/** The furthest met rung below sold out. Nothing above the floor stays at selling fast. */
export function rollCallLine2(release: Release, ladder: readonly LadderRung[], nowIso: string): string {
  const reached = [...ladder]
    .sort((a, b) => a.position - b.position)
    .map((rung) => higherLine(release, rung, nowIso))
    .filter((line): line is string => line != null);
  return reached[reached.length - 1] ?? liveClaimLine(release);
}

const LIVE = new Set(["on_sale", "selling_fast", "final_x"]);

/** Two or more sold out, and exactly one on sale, selling fast, or final X. */
export function rollCallWords(
  siblings: readonly Release[],
  context?: { ladder?: readonly LadderRung[]; nowIso?: string },
): {
  met: boolean;
  line1: string;
  line2: string;
  claim: string;
  because: string;
} {
  const ordered = [...siblings].sort((a, b) => a.position - b.position);
  const sold = ordered.filter((release) => release.state === "sold_out");
  const live = ordered.filter((release) => LIVE.has(release.state));
  const met = sold.length >= 2 && live.length === 1;
  const line1 = soldOutLine(sold.map((release) => release.name));
  const only = live.length === 1 ? live[0]! : null;
  const line2 = only
    ? context?.ladder && context.nowIso
      ? rollCallLine2(only, context.ladder, context.nowIso)
      : liveClaimLine(only)
    : "";
  const liveWord = live[0]?.state === "final_x" ? "final X" : live[0]?.state === "selling_fast" ? "selling fast" : "on sale";
  const because = met
    ? `${sold.length} sold out, 1 ${liveWord}`
    : "needs two sold out and exactly one on sale, selling fast, or final X";
  return { met, line1, line2, claim: line2 ? `${line1}\n${line2}` : line1, because };
}
