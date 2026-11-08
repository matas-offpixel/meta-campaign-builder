import { daysBetween } from "./dates.ts";
import { stateIndex, type Release, type ReleaseState, type StateSource } from "./types.ts";

export function applyState(
  release: Release,
  next: ReleaseState,
  opts: { at: string; source: StateSource; user: string; confirmed: boolean },
): { release: Release; ask: boolean } {
  const backwards = stateIndex(next) < stateIndex(release.state);
  if (backwards && !opts.confirmed) return { release, ask: true };
  return {
    ask: false,
    release: { ...release, state: next, stateAt: opts.at, stateSource: opts.source, stateSetBy: opts.user },
  };
}

/**
 * A count is stored on the release either way. It is also a manual
 * tier_channel_sales row only when the capacity is already known, so the
 * nightly history snapshot still has a denominator.
 */
export function applyCount(
  release: Release,
  sold: number,
): { release: Release; tierSale: { tierName: string; channel: "manual"; ticketsSold: number } | null } {
  const next = { ...release, sold };
  if (release.capacity == null) return { release: next, tierSale: null };
  return { release: next, tierSale: { tierName: release.name, channel: "manual", ticketsSold: sold } };
}

/** Ochre "update?" after 3 days on sale or selling fast. Dependent claims lock after 7. */
export function freshness(release: Release, nowIso: string): { days: number; update: boolean; lock: boolean; line: string | null } {
  if (!release.stateAt) return { days: 0, update: false, lock: false, line: null };
  const days = daysBetween(release.stateAt, nowIso);
  const watching = release.state === "on_sale" || release.state === "selling_fast";
  const update = watching && days >= 3;
  const lock = watching && days >= 7;
  return { days, update, lock, line: lock ? `locked · state is ${days} days old` : null };
}

/** The big number. A sold total only when every release has a count. */
export function releaseHeadline(releases: readonly Release[]): { onSale: number; total: number; soldOut: number; sold: number | null } {
  const onSale = releases.filter((release) => release.state === "on_sale" || release.state === "selling_fast").length;
  const soldOut = releases.filter((release) => release.state === "sold_out").length;
  const complete = releases.length > 0 && releases.every((release) => release.sold != null);
  const sold = complete ? releases.reduce((sum, release) => sum + (release.sold ?? 0), 0) : null;
  return { onSale, total: releases.length, soldOut, sold };
}
