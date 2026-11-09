import { daysBetween } from "./dates.ts";

export type CountRead = { at: string; sold: number };

/**
 * Sales velocity. Locked until two counts exist, a window apart.
 * The card names that with "needs a second count".
 */
export function velocityRung(
  reads: readonly CountRead[],
  nowIso: string,
  windowDays = 14,
  threshold = 500,
): { locked: boolean; met: boolean; because: string; claim: string } {
  const span = windowDays === 14 ? "2 WEEKS" : `${windowDays} DAYS`;
  if (reads.length < 2) return { locked: true, met: false, because: "needs a second count", claim: "" };
  const now = Date.parse(nowIso);
  const then = now - windowDays * 86_400_000;
  const ordered = [...reads].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const current = ordered.filter((read) => Date.parse(read.at) <= now).at(-1);
  const earlier = ordered.filter((read) => Date.parse(read.at) <= then).at(-1);
  if (!current || !earlier || current.at === earlier.at) {
    return { locked: true, met: false, because: "needs a second count", claim: "" };
  }
  const delta = current.sold - earlier.sold;
  const rounded = Math.floor(delta / 100) * 100;
  const claim = `${rounded.toLocaleString("en-GB")}+ TICKETS SOLD IN THE LAST ${span}`;
  return {
    locked: false,
    met: delta >= threshold,
    because: `${current.sold} on ${current.at.slice(0, 10)} minus ${earlier.sold} on ${earlier.at.slice(0, 10)}`,
    claim,
  };
}

function riseDay(nowIso: string, nextIso: string): string {
  if (daysBetween(nowIso, nextIso) === 1) return "TOMORROW";
  const date = new Date(`${nextIso.slice(0, 10)}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" }).format(date).toUpperCase();
}

function money(price: number): string {
  return Number.isInteger(price) ? String(price) : price.toFixed(2);
}

/** The next release's list time within n days. The price qualifier only when this release has one. */
export function priceRiseRung(
  nowIso: string,
  nextListAt: string | null,
  price: number | null,
  withinDays = 4,
): { met: boolean; claim: string | null } {
  if (!nextListAt) return { met: false, claim: null };
  const days = daysBetween(nowIso, nextListAt);
  if (days < 0 || days > withinDays) return { met: false, claim: null };
  const claim = `PRICES RISE ${riseDay(nowIso, nextListAt)}`;
  if (price == null) return { met: true, claim };
  return { met: true, claim: `${claim}\nLAST CHANCE AT £${money(price)}` };
}

/** Selling fast for the ladder's days, with no count, stands in for the 90% rung. */
export function percentStandIn(
  release: { state: string; stateAt: string | null; sold: number | null },
  nowIso: string,
  days: number | null,
): boolean {
  if (days == null || release.sold != null || release.state !== "selling_fast" || !release.stateAt) return false;
  return daysBetween(release.stateAt, nowIso) >= days;
}

export function countdownRung(
  nowIso: string,
  eventAt: string | null,
  pctMet: boolean,
  withinDays = 14,
  standInMet = false,
): { met: boolean; claim: string } {
  const claim = "LESS THAN 2 WEEKS TO GO\nOVER 90% SOLD OUT";
  if (!eventAt || (!pctMet && !standInMet)) return { met: false, claim };
  const days = daysBetween(nowIso, eventAt);
  return { met: days >= 0 && days <= withinDays, claim };
}

/**
 * A new typed lineup row since the last proposal refreshes the lineup slot
 * and every ALONGSIDE list. It does not file a new cell.
 */
export function lineupRung(
  artists: readonly { name: string; addedAt: string }[],
  lastProposalAt: string | null,
): { met: boolean; claim: string | null; artist: string | null; newCell: false } {
  const since = lastProposalAt ? Date.parse(lastProposalAt) : 0;
  const added = artists.filter((artist) => Date.parse(artist.addedAt) > since);
  const artist = added.reduce<(typeof artists)[number] | undefined>((latest, row) => {
    if (!latest || Date.parse(row.addedAt) > Date.parse(latest.addedAt)) return row;
    return latest;
  }, undefined);
  if (!artist) return { met: false, claim: null, artist: null, newCell: false };
  const name = artist.name.toUpperCase();
  return { met: true, claim: `${name} (JUST ANNOUNCED)`, artist: name, newCell: false };
}

/** The soonest list time still ahead. Price-rise reads this, not a release's own date. */
export function nextReleaseListAt(releases: readonly { listAt: string | null }[], nowIso: string): string | null {
  const now = Date.parse(nowIso);
  const upcoming = releases
    .map((release) => release.listAt)
    .filter((at): at is string => at != null && Date.parse(at) > now)
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  return upcoming[0] ?? null;
}
