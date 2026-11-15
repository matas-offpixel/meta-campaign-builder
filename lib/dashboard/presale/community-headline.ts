/**
 * lib/dashboard/presale/community-headline.ts
 *
 * The adapter HE2's panel reads for the community tile's headline: it adds
 * HE4's hand-entered member count (migration 249) to the page-audience
 * figures that lib/cirqlin/page-audience/read.ts's pageAudienceForShow
 * returns (#1248). PB4: the entered count lives here, not on HE2's row.
 *
 * lib/cirqlin/** is not imported: #1248 is open while this is written, so
 * the adapter types only the fields it reads (`CommunityAudienceFigures`,
 * a structural subset of #1248's PageAudienceFigures) and takes HE2's
 * reader as a function argument. Any PageAudienceFigures passes.
 *
 * The headline order is PA3's (2026-11-15-dashboard-v2-he2-page-audience.html):
 *   1. the entered member count  ("{n} members · entered {date}", with
 *      "{j} joined from signups · CIRQLIN" under it when CIRQLIN has it);
 *   2. community_joined           ("CIRQLIN · exact", no "est.");
 *   3. community link clicks      ("community link clicks · est."), only
 *      when the page's read has no community_joined.
 * The words are the panel's; this returns which source leads and its
 * figures. The join rate stays community_joined ÷ WhatsApp reach (PA3):
 * an entered count is never its numerator.
 *
 * Design's ruling on #1255: a community_joined of 0 reads "0 joined from
 * signups", and the link-click estimate leads only when a page has no
 * community_joined. Migration 247 stores community_joined NOT NULL, so a
 * #1248 row always has it and the estimate only leads when a caller passes
 * communityJoined as null. A 0 is never read as "not read".
 *
 * The entered count carries the person's name for "entered by {name},
 * {date}" (./names.ts; service role, else the name reads null).
 *
 * Relative imports only: the `node --test` runner can't resolve `@/`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { enteredByWords, type Entered, type EnteredNames, type MemberCountRow } from "./model.ts";
import { adminNameLookup, resolveEnteredNames, type NameLookup } from "./names.ts";
import { loadMemberCounts } from "./read.ts";

type Db = Pick<SupabaseClient, "from">;

/** The fields of #1248's PageAudienceFigures this adapter reads. */
export interface CommunityAudienceFigures {
  eventId: string;
  /** Null only when the read had no community_joined (never from a 247 row, which stores it NOT NULL). */
  communityJoined: number | null;
  communityLinkClicks: number;
}

export interface EnteredMemberCount {
  members: number;
  countedOn: string;
  entered: Entered;
}

export type CommunityHeadline =
  | { source: "entered"; members: number; countedOn: string; entered: Entered; joinedFromSignups: number | null }
  | { source: "community_joined"; joined: number }
  | { source: "link_clicks_est"; clicks: number }
  | { source: "none" };

export type WithEnteredMemberCount<F extends CommunityAudienceFigures> = F & {
  /** HE4's latest entered count for the show, or null. */
  enteredMemberCount: EnteredMemberCount | null;
  headline: CommunityHeadline;
};

/** The latest entered count: the newest counted_on, then the newest entry. */
export function latestMemberCount(rows: readonly MemberCountRow[], names?: EnteredNames): EnteredMemberCount | null {
  const sorted = [...rows].sort((a, b) => b.counted_on.localeCompare(a.counted_on) || b.entered_at.localeCompare(a.entered_at));
  const r = sorted[0];
  if (!r) return null;
  const name = (r.entered_by && names?.get(r.entered_by)) || null;
  return { members: r.members, countedOn: r.counted_on, entered: { by: r.entered_by, at: r.entered_at, name } };
}

export interface CommunityHeadlineWords {
  /** The tile's headline. */
  headline: string;
  /** The line under it: the source, or "entered by {name}, {date}". */
  source: string;
  /** For an entered count: CIRQLIN's joins under it, when CIRQLIN has them. */
  joinedLine: string | null;
}

const n = (v: number) => Math.round(v).toLocaleString("en-GB");

/** PA3's words for the headline, with design's #1255 rulings. Null when there is nothing to say. */
export function communityHeadlineWords(h: CommunityHeadline, timeZone = "Europe/London"): CommunityHeadlineWords | null {
  switch (h.source) {
    case "entered":
      return {
        headline: `${n(h.members)} members`,
        source: enteredByWords(h.entered, timeZone),
        joinedLine: h.joinedFromSignups == null ? null : `${n(h.joinedFromSignups)} joined from signups · CIRQLIN`,
      };
    case "community_joined":
      return { headline: `${n(h.joined)} joined from signups`, source: "CIRQLIN · exact", joinedLine: null };
    case "link_clicks_est":
      return { headline: `${n(h.clicks)} community link clicks`, source: "est.", joinedLine: null };
    case "none":
      return null;
  }
}

/** PA3's order, pure. `figures` is null when the show has no page-audience row. */
export function communityHeadline(figures: CommunityAudienceFigures | null, entered: EnteredMemberCount | null): CommunityHeadline {
  const joined = figures?.communityJoined ?? null;
  if (entered) {
    return { source: "entered", members: entered.members, countedOn: entered.countedOn, entered: entered.entered, joinedFromSignups: joined };
  }
  if (!figures) return { source: "none" };
  if (joined != null) return { source: "community_joined", joined };
  return { source: "link_clicks_est", clicks: figures.communityLinkClicks };
}

/** Pure: page-audience figures plus the entered count and the headline. */
export function withEnteredMemberCount<F extends CommunityAudienceFigures>(figures: F, rows: readonly MemberCountRow[], names?: EnteredNames): WithEnteredMemberCount<F> {
  const enteredMemberCount = latestMemberCount(rows, names);
  return { ...figures, enteredMemberCount, headline: communityHeadline(figures, enteredMemberCount) };
}

/**
 * For pageAudienceForShow callers: pass HE2's reader, get its figures with
 * `enteredMemberCount` and the headline. Null when the show has no page
 * audience row; `enteredMemberCountForShow` covers a show with an entered
 * count and no CIRQLIN page.
 *
 *   import { pageAudienceForShow } from "@/lib/cirqlin/page-audience/read";
 *   const fig = await pageAudienceWithEnteredCount(db, eventId, pageAudienceForShow);
 */
export async function pageAudienceWithEnteredCount<F extends CommunityAudienceFigures>(
  db: Db,
  eventId: string,
  readPageAudience: (db: Db, eventId: string) => Promise<F | null>,
  lookupName?: NameLookup | null,
): Promise<WithEnteredMemberCount<F> | null> {
  const [figures, counts] = await Promise.all([readPageAudience(db, eventId), loadMemberCounts(db, [eventId])]);
  if (!figures) return null;
  const rows = counts.get(eventId) ?? [];
  const latest = latestMemberCount(rows);
  const names = await resolveEnteredNames([latest?.entered.by], lookupName === undefined ? adminNameLookup(db) : lookupName);
  return withEnteredMemberCount(figures, rows, names);
}

/** The latest entered member count for each show (absent = none entered), with the person's name. */
export async function enteredMemberCounts(db: Db, eventIds: readonly string[], lookupName?: NameLookup | null): Promise<Map<string, EnteredMemberCount>> {
  const rows = await loadMemberCounts(db, eventIds);
  const latest = new Map<string, EnteredMemberCount>();
  for (const [eventId, list] of rows) {
    const l = latestMemberCount(list);
    if (l) latest.set(eventId, l);
  }
  const names = await resolveEnteredNames(
    [...latest.values()].map((l) => l.entered.by),
    lookupName === undefined ? adminNameLookup(db) : lookupName,
  );
  const out = new Map<string, EnteredMemberCount>();
  for (const [eventId, l] of latest) out.set(eventId, { ...l, entered: { ...l.entered, name: (l.entered.by && names.get(l.entered.by)) || null } });
  return out;
}

export async function enteredMemberCountForShow(db: Db, eventId: string, lookupName?: NameLookup | null): Promise<EnteredMemberCount | null> {
  return (await enteredMemberCounts(db, [eventId], lookupName)).get(eventId) ?? null;
}
