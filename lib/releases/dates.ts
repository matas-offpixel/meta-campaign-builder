import type { Release, ReleaseState } from "./types.ts";

/** Whole calendar days from `fromIso` to `toIso`. The clock is ignored. */
export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export function addCalendarDays(ymd: string, n: number): string {
  const d = new Date(`${ymd.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * A1'. presale_at is the first release's community time.
 * general_sale_at is the general-sale release's list time.
 * Nothing else writes those columns.
 */
export function deriveSaleDates(releases: readonly Pick<Release, "position" | "name" | "communityAt" | "listAt">[]): {
  presaleAt: string | null;
  generalSaleAt: string | null;
} {
  const ordered = [...releases].sort((a, b) => a.position - b.position);
  const general = ordered.find((release) => /general sale/i.test(release.name));
  return {
    presaleAt: ordered[0]?.communityAt ?? null,
    generalSaleAt: general?.listAt ?? null,
  };
}

function passed(listAt: string | null, nowIso: string): boolean {
  return listAt != null && Date.parse(listAt) <= Date.parse(nowIso);
}

/** Two rows per event. on_sale once that row's list time has passed, otherwise not_yet. */
export function backfillReleases(
  event: { presaleAt: string | null; generalSaleAt: string | null },
  nowIso: string,
): Array<{ position: number; name: string; communityAt: string | null; listAt: string | null; state: ReleaseState }> {
  const presaleState: ReleaseState = passed(event.presaleAt, nowIso) ? "on_sale" : "not_yet";
  const generalState: ReleaseState = passed(event.generalSaleAt, nowIso) ? "on_sale" : "not_yet";
  return [
    { position: 1, name: "Presale", communityAt: event.presaleAt, listAt: event.presaleAt, state: presaleState },
    { position: 2, name: "General sale", communityAt: null, listAt: event.generalSaleAt, state: generalState },
  ];
}
