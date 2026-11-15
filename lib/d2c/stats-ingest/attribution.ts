/**
 * lib/d2c/stats-ingest/attribution.ts
 *
 * Which show (if any) a send belongs to, and whether it went to ticket
 * holders. Pure.
 *
 * E5: "Per show: the broadcasts carrying the show's tag or list. A send
 * to the whole list shows under the client, not under every show."
 *
 * Every state is a positive match; none is the fallback for "couldn't
 * match" except not_tied:
 *
 *   - show: every audience the send targets is that one show's list. A
 *     show's lists are `CQ-{events.cirqlin_page_slug}` and its CIRQLIN
 *     opt-in tiers (SHOW_LIST_TIER_SUFFIXES), or a list or tag whose name
 *     is exactly the show's `events.mailchimp_tag` or `events.event_code`,
 *     case-insensitive. A Mailchimp tag also has to sit on the show's
 *     audience when the event names one.
 *       - Bird includes are a union, and so is Mailchimp `match: any`:
 *         every included list must be one show's. Bird excludes only
 *         narrow, so they never stop a show match.
 *       - Mailchimp `match: all` is an intersection: one tag of the show
 *         is enough, as long as no other included tag names a different
 *         show.
 *   - client ("Whole list"): the send went to the client's whole list (a
 *     Bird send with no list, a Mailchimp send with no segment), or every
 *     included list is one of the client's master tags (CLIENT_MASTER_TAGS,
 *     e.g. "NX Loves").
 *   - not_tied: a send on the client's own account or audience that is
 *     neither: one-off lists, a mix of shows, "all except the show's tag",
 *     a widening condition, or no audience read. It counts in the client's
 *     channel totals and in no show.
 *   - unattributed: no show matched and no single client owns the account
 *     or the Mailchimp audience.
 *
 * Matching is on the list / tag NAME because the show's key is a name
 * (`CQ-{slug}`). Channels are never matched by name: a Brixton channel is
 * literally called "NX Loves". Channel ids are stored as they are.
 */

import type {
  D2CAudience,
  D2CAudienceKind,
  D2CShowKey,
  D2CStatsAttribution,
} from "./types.ts";

/**
 * The CIRQLIN opt-in tiers built from a show's page at sync:
 * `CQ-{slug}-Together` and `CQ-{slug}-opted-in` hold that show's signups
 * only, so a send to them is the show's. Drop a suffix here to stop
 * counting it.
 */
export const SHOW_LIST_TIER_SUFFIXES = ["-Together", "-opted-in"] as const;

/**
 * Each client's master tags or lists: a send to one of these, and nothing
 * else, is a whole-list send. Names, case-insensitive. Nothing stores
 * these yet, so they live here until a client setting does.
 */
export const CLIENT_MASTER_TAGS: Readonly<Record<string, readonly string[]>> = {
  // Electric Group
  "f9045034-2788-4b1d-94d1-1a5ab7fa5ac8": ["NX Loves"],
};

function norm(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/**
 * The names a show answers to, lowercased: its tag, its event code,
 * `cq-{slug}` and that list's opt-in tiers.
 */
export function showNames(show: D2CShowKey): string[] {
  const names = new Set<string>();
  const tag = norm(show.tag);
  if (tag) names.add(tag);
  const code = norm(show.code);
  if (code) names.add(code);
  const slug = norm(show.slug);
  if (slug) {
    names.add(`cq-${slug}`);
    for (const suffix of SHOW_LIST_TIER_SUFFIXES) names.add(`cq-${slug}${suffix.toLowerCase()}`);
  }
  return [...names];
}

export interface ShowIndex {
  /** name → shows answering to it (more than one = ambiguous, never matched). */
  byName: Map<string, D2CShowKey[]>;
}

export function buildShowIndex(shows: readonly D2CShowKey[]): ShowIndex {
  const byName = new Map<string, D2CShowKey[]>();
  for (const show of shows) {
    for (const name of showNames(show)) {
      const list = byName.get(name) ?? [];
      if (!list.some((s) => s.eventId === show.eventId)) list.push(show);
      byName.set(name, list);
    }
  }
  return { byName };
}

/**
 * The one show an audience name belongs to, or null. A name two shows
 * answer to is ambiguous and matches neither. `opts.clientIds` keeps a
 * shared account's lists to its own clients' shows; `opts.mailchimpListId`
 * drops a show whose tag lives on a different audience.
 */
export function matchShow(
  index: ShowIndex,
  name: string | null,
  opts: { clientIds?: readonly string[]; mailchimpListId?: string | null } = {},
): D2CShowKey | null {
  const key = norm(name);
  if (!key) return null;
  let candidates = index.byName.get(key) ?? [];
  if (opts.clientIds && opts.clientIds.length > 0) {
    const allowed = new Set(opts.clientIds);
    candidates = candidates.filter((s) => allowed.has(s.clientId));
  }
  if (opts.mailchimpListId) {
    candidates = candidates.filter(
      (s) => !s.mailchimpAudienceId || s.mailchimpAudienceId === opts.mailchimpListId,
    );
  }
  return candidates.length === 1 ? candidates[0]! : null;
}

export interface Attributed {
  attribution: D2CStatsAttribution;
  eventId: string | null;
  clientId: string | null;
}

/**
 * Attribute one send. `accountClientIds` are the clients whose connections
 * point at the account (one = it's that client's); `listClientId` is the
 * client that owns the Mailchimp audience, when one does. A show match
 * wins; then a positive whole-list or master-tag match is the client's
 * whole list; any other send the client owns is not_tied; with no single
 * owner it is unattributed.
 */
export function attributeSend(
  index: ShowIndex,
  audience: D2CAudience | null,
  opts: {
    accountClientIds: readonly string[];
    listClientId?: string | null;
    mailchimpListId?: string | null;
    masterTags?: Readonly<Record<string, readonly string[]>>;
  },
): Attributed {
  const show = audience ? showForAudience(index, audience, opts) : null;
  if (show) return { attribution: "show", eventId: show.eventId, clientId: show.clientId };
  const clientId =
    opts.listClientId ??
    (opts.accountClientIds.length === 1 ? opts.accountClientIds[0]! : null);
  if (!clientId) return { attribution: "unattributed", eventId: null, clientId: null };
  const master = opts.masterTags ?? CLIENT_MASTER_TAGS;
  return audience && isWholeList(audience, master[clientId] ?? [])
    ? { attribution: "client", eventId: null, clientId }
    : { attribution: "not_tied", eventId: null, clientId };
}

/** The whole list, or only the client's master tags (in either match mode). */
export function isWholeList(audience: D2CAudience, masterTags: readonly string[]): boolean {
  if (audience.wholeList) return true;
  if (audience.otherConditions > 0) return false;
  const includes = audience.refs.filter((r) => r.include);
  if (includes.length === 0) return false;
  const masters = new Set(masterTags.map(norm));
  return includes.every((r) => masters.has(norm(r.name)));
}

function showForAudience(
  index: ShowIndex,
  audience: D2CAudience,
  opts: { accountClientIds: readonly string[]; mailchimpListId?: string | null },
): D2CShowKey | null {
  if (audience.wholeList) return null;
  const match = (name: string | null) =>
    matchShow(index, name, {
      clientIds: opts.accountClientIds,
      mailchimpListId: opts.mailchimpListId,
    });
  const includes = audience.refs.filter((r) => r.include);
  if (includes.length === 0) return null;

  if (audience.mode === "any") {
    // A union: a widening condition (a Mailchimp "static_not" under
    // match: any, or a non-tag condition) lets people outside the show
    // in. The mappers count those in otherConditions. Bird excludes are
    // subtracted from the union, so they narrow and are ignored here.
    if (audience.otherConditions > 0) return null;
    const shows = includes.map((r) => match(r.name));
    if (shows.some((s) => s === null)) return null;
    const ids = new Set(shows.map((s) => s!.eventId));
    return ids.size === 1 ? shows[0]! : null;
  }

  // "all": an intersection. One tag of the show is enough; two different
  // shows' tags ANDed together is a mix and is not tied to a show.
  const shows = includes.map((r) => match(r.name)).filter((s): s is D2CShowKey => s !== null);
  if (shows.length === 0) return null;
  const ids = new Set(shows.map((s) => s.eventId));
  return ids.size === 1 ? shows[0]! : null;
}

/**
 * Ticket-holder lists and tags, by name. Invented here (E5 asks for the
 * split, not the rule): "Wilkinson ticket holders", "Purchasers",
 * "Buyers 2026" are ticket holders; everything else is marketing.
 */
export const TICKET_HOLDER_NAME = /\b(ticket[\s_-]*holders?|ticketholders?|purchasers?|buyers?|bookers?)\b/i;

export function audienceKind(audience: D2CAudience | null): D2CAudienceKind {
  if (!audience) return "marketing";
  return audience.refs.some((r) => r.include && r.name && TICKET_HOLDER_NAME.test(r.name))
    ? "ticket_holder"
    : "marketing";
}
