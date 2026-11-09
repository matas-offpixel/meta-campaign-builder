import type { Release } from "./types.ts";

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

/** Line 2 is the live release's own rung, shouted. */
export function liveClaimLine(release: Pick<Release, "name" | "state" | "remaining" | "capacity" | "sold">): string {
  const upper = release.name.trim().toUpperCase();
  const titled = /\bRELEASE\b/.test(upper) ? upper : `${upper} RELEASE`;
  if (release.state === "final_x") {
    const left =
      release.remaining ??
      (release.capacity != null && release.sold != null ? release.capacity - release.sold : null);
    if (left != null) return `FINAL ${left} ${titled} TICKETS`;
  }
  return `${titled} RUNNING LOW`;
}

const LIVE = new Set(["on_sale", "selling_fast"]);

/** Two or more sold out, and exactly one on sale or selling fast. */
export function rollCallWords(siblings: readonly Release[]): {
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
  const line2 = live.length === 1 ? liveClaimLine(live[0]!) : "";
  const liveWord = live[0]?.state === "selling_fast" ? "selling fast" : "on sale";
  const because = met
    ? `${sold.length} sold out, 1 ${liveWord}`
    : "needs two sold out and exactly one on sale or selling fast";
  return { met, line1, line2, claim: line2 ? `${line1}\n${line2}` : line1, because };
}
