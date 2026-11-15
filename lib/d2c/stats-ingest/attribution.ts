/**
 * lib/d2c/stats-ingest/attribution.ts
 *
 * Which show (if any) a send belongs to, and whether it went to ticket
 * holders. Pure.
 *
 * E5: "Per show: the broadcasts carrying the show's tag or list. A send
 * to the whole list shows under the client, not under every show."
 *
 *   - A Bird list or Mailchimp tag names a show when its name is the
 *     show's tag (`events.mailchimp_tag`) or `CQ-{events.cirqlin_page_slug}`,
 *     case-insensitive. A Mailchimp tag also has to sit on the show's
 *     audience when the event names one.
 *   - Bird includes are a union: every included list must name the same
 *     show. Excludes only narrow, so they never stop a show match.
 *   - Mailchimp `match: any` is a union too, so every condition must be a
 *     tag of that one show. `match: all` narrows, so one tag of the show
 *     is enough, as long as no other included tag names a different show.
 *   - Anything else (the whole list, a master list, a mix of shows, "all
 *     except the show's tag") sits under the client only.
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

function norm(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/** The names a show answers to: its tag and `cq-{slug}`, lowercased. */
export function showNames(show: D2CShowKey): string[] {
  const names = new Set<string>();
  const tag = norm(show.tag);
  if (tag) names.add(tag);
  const slug = norm(show.slug);
  if (slug) names.add(`cq-${slug}`);
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
 * Attribute one send. `accountClientId` is the client the account belongs
 * to when exactly one client's connection points at it (else null);
 * `listClientId` is the client that owns the Mailchimp audience, when one
 * does. A show match always wins; otherwise the send sits under the
 * client, or is unattributed when no single client owns the account.
 */
export function attributeSend(
  index: ShowIndex,
  audience: D2CAudience | null,
  opts: {
    accountClientIds: readonly string[];
    listClientId?: string | null;
    mailchimpListId?: string | null;
  },
): Attributed {
  const show = audience ? showForAudience(index, audience, opts) : null;
  if (show) return { attribution: "show", eventId: show.eventId, clientId: show.clientId };
  const clientId =
    opts.listClientId ??
    (opts.accountClientIds.length === 1 ? opts.accountClientIds[0]! : null);
  return clientId
    ? { attribution: "client", eventId: null, clientId }
    : { attribution: "unattributed", eventId: null, clientId: null };
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
  // shows' tags ANDed together is a mix and sits under the client.
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
