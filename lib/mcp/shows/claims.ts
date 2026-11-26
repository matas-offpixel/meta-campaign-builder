/**
 * lib/mcp/shows/claims.ts — the claims a show's ladder gives now (M3d-a,
 * get_releases and set_release).
 *
 * The same reckoning as the event page's Releases card
 * (components/dashboard/asset-bank/live.tsx): the client's ladder made
 * whole (completeLadder), each confirmed release's next rung (nextRung, the
 * furthest rung it has met, else the first one ahead marked unmet), then
 * the event-level derived proposals (derivedProposals). A claim whose
 * trigger isn't met is only ever returned as `met: false` with what it
 * needs, never as one Claude may use: a claim is never above its trigger.
 *
 * Pure. Relative imports only (node:test).
 */
import { completeLadder } from "../../releases/ladder.ts";
import { nextReleaseListAt, type CountRead } from "../../releases/derived.ts";
import { isBackfilled } from "../../releases/visibility.ts";
import { londonDayMonth } from "../../releases/london.ts";
import type { LadderRung, Release } from "../../releases/types.ts";
import { derivedProposals, nextRung, sellingFastDays, type DerivedContext } from "../../ticket-warnings/next-rung.ts";
import { SHOWS_WORDS } from "./words.ts";

export interface ReleasesData {
  releases: Release[];
  /** The client's stored ladder (loadClientLadder); [] when none. */
  ladder: LadderRung[];
  counts: CountRead[];
  artists: { name: string; addedAt: string }[];
  lastProposalAt: string | null;
  eventAt: string | null;
}

export interface ReleaseLine {
  id: string;
  name: string;
  state: string;
  stateLabel: string;
  /** When the state was set (YYYY-MM-DD in London is what the card shows; the instant is kept). */
  stateSetAt: string | null;
  sold: number | null;
  capacity: number | null;
  /** Backfilled from the event's dates and never confirmed: the card says no claim for it. */
  confirmed: boolean;
}

export interface ClaimLine {
  release: string | null;
  claim: string;
  /** True only when its trigger is met now. */
  met: boolean;
  /** "met" (a release's rung), "proposed" (a derived, event-level rung), or "later" (not met). */
  kind: "met" | "proposed" | "later";
  because: string;
  /** For a "later" claim: what it waits for, as a sentence. */
  note?: string;
}

export interface ClaimsView {
  releases: ReleaseLine[];
  claims: ClaimLine[];
  readAt: string;
  readAtLine: string;
}

const stateLabel = (state: string) => SHOWS_WORDS.state[state] ?? state;

/** "26 Nov 03:14" in London, for the read-at line. */
function londonWhen(iso: string): string {
  const day = londonDayMonth(iso);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
  return day ? `${day} ${time}` : iso;
}

export function claimsView(data: ReleasesData, nowIso: string): ClaimsView {
  const used = completeLadder(data.ladder);
  const rows = data.releases;
  const context: DerivedContext = {
    counts: data.counts,
    nextListAt: nextReleaseListAt(rows, nowIso),
    eventAt: data.eventAt,
    artists: data.artists,
    lastProposalAt: data.lastProposalAt,
    sellingFastDays: sellingFastDays(used),
  };
  const claims: ClaimLine[] = [];
  for (const release of rows) {
    if (isBackfilled(release)) continue;
    const rung = nextRung(release, used, rows, nowIso, context);
    if (!rung) continue;
    claims.push(
      rung.met
        ? { release: release.name, claim: rung.claim, met: true, kind: "met", because: rung.because }
        : { release: release.name, claim: rung.claim, met: false, kind: "later", because: rung.because, note: SHOWS_WORDS.claimLater(rung.because) },
    );
  }
  for (const proposal of derivedProposals(used, rows, nowIso, context)) {
    // derivedProposals returns met rungs only.
    if (!proposal.met) continue;
    claims.push({ release: null, claim: proposal.claim, met: true, kind: "proposed", because: proposal.because });
  }
  return {
    releases: rows.map((release) => ({
      id: release.id,
      name: release.name,
      state: release.state,
      stateLabel: stateLabel(release.state),
      stateSetAt: release.stateAt,
      sold: release.sold,
      capacity: release.capacity,
      confirmed: !isBackfilled(release),
    })),
    claims,
    readAt: nowIso,
    readAtLine: SHOWS_WORDS.readAt(londonWhen(nowIso)),
  };
}

export { stateLabel };
