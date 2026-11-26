/**
 * lib/mcp/shows/words.ts — what the M3d-a tools (create_event,
 * create_client, set_lineup, get_releases, set_release) tell Claude.
 *
 * Two kinds of string:
 *   - rows from design's lists, word for word, imported from where they
 *     already live (claude.mcp.event.* for an event's code, links, other
 *     account and a failed save; claude.mcp.done; today.mcp.result.created /
 *     .created.one and today.mcp.result / .one);
 *   - PENDING DESIGN: every string with no row yet. Each is in
 *     SHOWS_FOR_DESIGN with its key, where it shows and the builder's
 *     candidate; the PR body's "For design" table is that list. When design
 *     rules them, the ruled words replace the candidates here and the
 *     entries leave SHOWS_FOR_DESIGN.
 *
 * No raw error (a database or route message) is ever put in one of these.
 * Claude gets names, counts, ids and links.
 *
 * Relative imports only (node:test).
 */
import { EVENT_WORDS, MCP_WORDS } from "../meta/words.ts";

export interface PendingWord {
  key: string;
  where: string;
  candidate: string;
}

/** Every PENDING DESIGN string, in one list (the PR body's "For design" table). */
export const SHOWS_FOR_DESIGN: PendingWord[] = [];

/** Registers a PENDING DESIGN string and returns its template. */
function pending(key: string, where: string, candidate: string): string {
  SHOWS_FOR_DESIGN.push({ key, where, candidate });
  return candidate;
}

const fill = (t: string, v: Record<string, string | number>) => t.replace(/\{([a-z_]+)\}/g, (m, k: string) => (k in v ? String(v[k]) : m));

// ── Rows from design's lists (word for word) ─────────────────────────────────

export const SHOWS_ROWS = {
  /** claude.mcp.event.refused.code */
  badCode: EVENT_WORDS.refusedCode,
  /** claude.mcp.event.refused.unknown */
  unknownEvent: (code: string) => EVENT_WORDS.refusedUnknown(code),
  /** claude.mcp.event.refused.other_account */
  otherAccount: EVENT_WORDS.refusedOtherAccount,
  /** claude.mcp.event.refused.link */
  badLink: (field: string) => EVENT_WORDS.refusedLink(field),
  /** claude.mcp.event.field.ticket_url / .signup_url */
  field: EVENT_WORDS.field,
  /** claude.mcp.event.failed: the event row couldn't be saved. */
  eventFailed: EVENT_WORDS.failed,
  /** claude.mcp.done */
  done: (result: string) => MCP_WORDS.done(result),
  /** today.mcp.result.created / .created.one ({things} are the builder's plain words, TD's hand-back). */
  created: (things: [string, string], ids: readonly string[]) =>
    ids.length === 1 ? `1 ${things[0]} created · ${ids[0]}` : `${ids.length} ${things[1]} created · ${ids.join(", ")}`,
  /** today.mcp.result / .one */
  changed: (things: [string, string], ids: readonly string[]) =>
    ids.length === 1 ? `1 ${things[0]} changed · ${ids[0]}` : `${ids.length} ${things[1]} changed · ${ids.join(", ")}`,
} as const;

/** The builder's plain words for {thing}/{things} (TD's hand-back): event (M3a's), client, lineup, release. */
export const SHOW_THINGS = {
  event: ["event", "events"] as [string, string],
  client: ["client", "clients"] as [string, string],
  release: ["release", "releases"] as [string, string],
};

// ── PENDING DESIGN ───────────────────────────────────────────────────────────

const T = {
  codeExists: pending(
    "claude.mcp.shows.event.refused.code_exists",
    "Told to Claude, create_event: the code is already an event's",
    "Refused: an event with code {code} already exists. Change it with update_event, or pick another code. Nothing was changed.",
  ),
  clientUnknown: pending(
    "claude.mcp.shows.refused.client_unknown",
    "Told to Claude, create_event and create_client: no client of yours by that name or id",
    "Refused: no client called {client}. Make it with create_client first. Nothing was changed.",
  ),
  clientOther: pending(
    "claude.mcp.shows.refused.client_other_account",
    "Told to Claude, create_event and create_client: the client is another account's",
    "Refused: {client} belongs to another account, so nothing can be made under it from here. Nothing was changed.",
  ),
  clientArchived: pending(
    "claude.mcp.shows.refused.client_archived",
    "Told to Claude, create_event: the client is archived",
    "Refused: {client} is archived. Matas sets it back to active on the client’s page first. Nothing was changed.",
  ),
  name: pending(
    "claude.mcp.shows.refused.name",
    "Told to Claude, create_event and create_client: a name missing or too long",
    "Refused: give a name of at most {max} characters. Nothing was changed.",
  ),
  date: pending(
    "claude.mcp.shows.event.refused.date",
    "Told to Claude, create_event: the show date isn't a real date",
    "Refused: date is the show day, like 2027-03-14. Nothing was changed.",
  ),
  timezone: pending(
    "claude.mcp.shows.event.refused.timezone",
    "Told to Claude, create_event: not an IANA timezone",
    "Refused: {timezone} isn’t a timezone. Give one like Europe/London or America/Toronto. Nothing was changed.",
  ),
  textTooLong: pending(
    "claude.mcp.shows.refused.too_long",
    "Told to Claude, create_event: venue, city or country over its limit",
    "Refused: {field} is at most {max} characters. Nothing was changed.",
  ),
  adAccount: pending(
    "claude.mcp.shows.refused.ad_account",
    "Told to Claude, create_event and create_client: not a Meta ad account id",
    "Refused: {value} isn’t a Meta ad account id (digits, with or without act_). Nothing was changed.",
  ),
  digits: pending(
    "claude.mcp.shows.refused.digits",
    "Told to Claude, create_event and create_client: a pixel, page or Instagram id that isn't digits",
    "Refused: {field} is digits only, and {value} isn’t. Nothing was changed.",
  ),
  eventDriveNote: pending(
    "claude.mcp.shows.event.drive_note",
    "Told to Claude, after create_event: when its Drive folders appear",
    "Its Drive folders are made in the next few minutes, as for an event made in the app.",
  ),
  clientExists: pending(
    "claude.mcp.shows.client.refused.exists",
    "Told to Claude, create_client: the caller already has a client by that name",
    "Refused: you already have a client called {name}. Nothing was changed.",
  ),
  parentUnknown: pending(
    "claude.mcp.shows.client.refused.parent_unknown",
    "Told to Claude, create_client: no client to put the sub-brand under",
    "Refused: no client called {parent} to put {name} under. Nothing was changed.",
  ),
  parentNotReady: pending(
    "claude.mcp.shows.client.refused.parent_not_ready",
    "Told to Claude, create_client with a parent: migration 272 isn't applied",
    "Refused: a sub-brand needs a database update that isn’t applied yet. Make it without parent_client, or wait for the update. Nothing was changed.",
  ),
  clientFailed: pending(
    "claude.mcp.shows.client.failed",
    "Told to Claude, create_client: the row couldn't be saved",
    "The client couldn’t be saved. Try again. Nothing was changed.",
  ),
  subBrand: pending(
    "claude.mcp.shows.client.sub_brand",
    "Told to Claude, after create_client with a parent",
    "{name} sits under {parent}.",
  ),
  lineupEmpty: pending(
    "claude.mcp.shows.lineup.refused.empty",
    "Told to Claude, set_lineup: no acts given",
    "Refused: give at least one act. Nothing was changed.",
  ),
  lineupTwice: pending(
    "claude.mcp.shows.lineup.refused.twice",
    "Told to Claude, set_lineup: one act listed twice",
    "Refused: {name} is in the lineup twice. Nothing was changed.",
  ),
  lineupUnknown: pending(
    "claude.mcp.shows.lineup.refused.unknown",
    "Told to Claude, set_lineup: a name not in the artist library and no spotify_id",
    "Refused: {name} isn’t in the artist library. Pass its spotify_id to add it, or add it in the Lab. Nothing was changed.",
  ),
  lineupAmbiguous: pending(
    "claude.mcp.shows.lineup.refused.ambiguous",
    "Told to Claude, set_lineup: two library artists share the name",
    "Refused: {n} artists in the library are called {name}. Pass its spotify_id to pick one. Nothing was changed.",
  ),
  lineupSpotify: pending(
    "claude.mcp.shows.lineup.refused.spotify_id",
    "Told to Claude, set_lineup: a spotify_id that isn't one",
    "Refused: {value} isn’t a Spotify artist id. Nothing was changed.",
  ),
  lineupDone: pending(
    "claude.mcp.shows.lineup.done",
    "Told to Claude, after set_lineup: the lineup as the Lab now holds it",
    "Done: {code}’s lineup is {lineup}. Headlining: {headliners}.",
  ),
  lineupNoHeadliner: pending(
    "claude.mcp.shows.lineup.no_headliner",
    "Told to Claude, after set_lineup, in place of the headliners",
    "no one",
  ),
  lineupAdded: pending(
    "claude.mcp.shows.lineup.added",
    "Told to Claude, after set_lineup: acts added to the artist library from their Spotify ids",
    "Added to the artist library: {names}.",
  ),
  lineupFailed: pending(
    "claude.mcp.shows.lineup.failed",
    "Told to Claude, set_lineup: the save failed part way",
    "The lineup couldn’t be saved. Read it with get_event and try again: an act already added to the artist library isn’t added twice.",
  ),
  releasesNone: pending(
    "claude.mcp.shows.releases.none",
    "Told to Claude, get_releases and set_release: the show has no releases",
    "{code} has no releases yet. They’re set up on the event page’s Releases card.",
  ),
  releasesUnavailable: pending(
    "claude.mcp.shows.releases.unavailable",
    "Told to Claude, get_releases and set_release: the releases couldn't be read",
    "The releases couldn’t be read. Try again. Nothing was changed.",
  ),
  releaseUnknown: pending(
    "claude.mcp.shows.release.refused.unknown",
    "Told to Claude, set_release: no release by that name or id on the show",
    "Refused: no release called {release} on {code}. Its releases: {names}. Nothing was changed.",
  ),
  releaseBackwards: pending(
    "claude.mcp.shows.release.refused.backwards",
    "Told to Claude, set_release: a step back, which the card asks about once",
    "Refused: {release} would go back from {from} to {to}. Ask Matas, then send it again with confirmed: true. Nothing was changed.",
  ),
  releaseEmpty: pending(
    "claude.mcp.shows.release.refused.empty",
    "Told to Claude, set_release: neither a state nor a count",
    "Refused: give a state, a count, or both. Nothing was changed.",
  ),
  releaseDone: pending(
    "claude.mcp.shows.release.done",
    "Told to Claude, after set_release",
    "Done: {release}: {change}. The claims are as the ladder gives them now.",
  ),
  releaseCount: pending(
    "claude.mcp.shows.release.count",
    "Told to Claude, after set_release with a count, inside {change}",
    "{n} sold",
  ),
  releaseFailed: pending(
    "claude.mcp.shows.release.failed",
    "Told to Claude, set_release: the card's save failed",
    "The release couldn’t be saved. Try again. Nothing was changed.",
  ),
  claimLater: pending(
    "claude.mcp.shows.claim.later",
    "Told to Claude, get_releases and set_release: a claim whose trigger isn't met",
    "Not yet: {because}. Don’t use this claim until it’s met.",
  ),
  readAt: pending(
    "claude.mcp.shows.claims.read_at",
    "Told to Claude, get_releases and set_release: when the claims were read",
    "Read {when}.",
  ),
  stateNotYet: pending("claude.mcp.shows.state.not_yet", "{state} in set_release and get_releases", "not on sale yet"),
  stateOnSale: pending("claude.mcp.shows.state.on_sale", "{state} in set_release and get_releases", "on sale"),
  stateSellingFast: pending("claude.mcp.shows.state.selling_fast", "{state} in set_release and get_releases", "selling fast"),
  stateFinalX: pending("claude.mcp.shows.state.final_x", "{state} in set_release and get_releases", "final X"),
  stateSoldOut: pending("claude.mcp.shows.state.sold_out", "{state} in set_release and get_releases", "sold out"),
} as const;

export const SHOWS_WORDS = {
  codeExists: (code: string) => fill(T.codeExists, { code }),
  clientUnknown: (client: string) => fill(T.clientUnknown, { client }),
  clientOther: (client: string) => fill(T.clientOther, { client }),
  clientArchived: (client: string) => fill(T.clientArchived, { client }),
  name: (max: number) => fill(T.name, { max }),
  date: T.date,
  timezone: (timezone: string) => fill(T.timezone, { timezone }),
  textTooLong: (field: string, max: number) => fill(T.textTooLong, { field, max }),
  adAccount: (value: string) => fill(T.adAccount, { value }),
  digits: (field: string, value: string) => fill(T.digits, { field, value }),
  eventDriveNote: T.eventDriveNote,
  clientExists: (name: string) => fill(T.clientExists, { name }),
  parentUnknown: (parent: string, name: string) => fill(T.parentUnknown, { parent, name }),
  parentNotReady: T.parentNotReady,
  clientFailed: T.clientFailed,
  subBrand: (name: string, parent: string) => fill(T.subBrand, { name, parent }),
  lineupEmpty: T.lineupEmpty,
  lineupTwice: (name: string) => fill(T.lineupTwice, { name }),
  lineupUnknown: (name: string) => fill(T.lineupUnknown, { name }),
  lineupAmbiguous: (name: string, n: number) => fill(T.lineupAmbiguous, { name, n }),
  lineupSpotify: (value: string) => fill(T.lineupSpotify, { value }),
  lineupDone: (code: string, lineup: readonly string[], headliners: readonly string[]) =>
    fill(T.lineupDone, { code, lineup: lineup.join(", "), headliners: headliners.length ? headliners.join(", ") : T.lineupNoHeadliner }),
  lineupAdded: (names: readonly string[]) => fill(T.lineupAdded, { names: names.join(", ") }),
  lineupFailed: T.lineupFailed,
  releasesNone: (code: string) => fill(T.releasesNone, { code }),
  releasesUnavailable: T.releasesUnavailable,
  releaseUnknown: (release: string, code: string, names: readonly string[]) => fill(T.releaseUnknown, { release, code, names: names.join(", ") }),
  releaseBackwards: (release: string, from: string, to: string) => fill(T.releaseBackwards, { release, from, to }),
  releaseEmpty: T.releaseEmpty,
  releaseDone: (release: string, change: string) => fill(T.releaseDone, { release, change }),
  releaseCount: (n: number) => fill(T.releaseCount, { n }),
  releaseFailed: T.releaseFailed,
  claimLater: (because: string) => fill(T.claimLater, { because }),
  readAt: (when: string) => fill(T.readAt, { when }),
  state: {
    not_yet: T.stateNotYet,
    on_sale: T.stateOnSale,
    selling_fast: T.stateSellingFast,
    final_x: T.stateFinalX,
    sold_out: T.stateSoldOut,
  } as Record<string, string>,
} as const;
