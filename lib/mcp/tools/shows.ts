/**
 * lib/mcp/tools/shows.ts — M3d-a, shows and setup (scope mcp:draft,
 * operators): create_event, create_client, set_lineup, get_releases,
 * set_release.
 *
 * Each is the app's own path, reached through ctx.shows (lib/mcp/shows-deps.ts):
 *   - create_event is the event form's create (insertEventRow: the insert
 *     and its key-moments seed). The Drive tree comes from the
 *     creative-lab-drive-tick, as for an event made in the app; nothing
 *     here calls Drive. Refuses a code that is already an event's, a client
 *     that isn't the caller's, an archived client, and bad dates, links,
 *     timezones and ids.
 *   - create_client is the clients form's create (insertClientRow). A
 *     sub-brand (XMPL Sub-brand under XMPL Promoter) is its own client with
 *     parent_client_id set to the client it sits under (migration 272: the
 *     app had no client-to-client link before; a promoter's brands were
 *     event codes under one client). page_id and ig_id are the client's channel
 *     defaults (default_page_ids, default_instagram_actor_id), as the
 *     Channel defaults card stores them.
 *   - set_lineup is the Lab's lineup save (saveLabLineup): it replaces the
 *     event's lab rows (event_artists source lab) in the order given, as the
 *     Lab does. A name must be in the artist library; with a spotify_id an
 *     act that isn't is added the way the Lab's "add from Spotify" adds it
 *     (addSpotifyToLineup). Every name is checked before anything is written.
 *   - get_releases reads the Releases card (loadEventReleases and the
 *     client's ladder) and gives the claims the ladder gives now
 *     (lib/mcp/shows/claims.ts, the card's own reckoning), with when they
 *     were read. A claim whose trigger isn't met comes back marked not met.
 *   - set_release is the Releases card's save (POST /api/events/[id]/releases
 *     through postReleaseAs): a state, a count, or both; a step back asks
 *     once, as the card does (confirmed: true). It returns the claims the
 *     ladder gives after the save.
 *
 * App database only: nothing reaches Meta, Drive, CIRQLIN, Mailchimp or
 * Bird, and nothing spends. Writes need the event (or the client) to be the
 * caller's.
 *
 * Relative imports only (node:test).
 */
import { z } from "zod";
import { requireDraftScope } from "../drafts/common.ts";
import { normaliseLink } from "../meta/event-write.ts";
import { normalizeAdAccountId } from "../../meta/ad-account.ts";
import { ARCHIVED } from "../../db/client-status.ts";
import { RELEASE_STATES, stateIndex, type ReleaseState } from "../../releases/types.ts";
import { applyCount, applyState } from "../../releases/entry.ts";
import { deriveSaleDates } from "../../releases/dates.ts";
import { ToolInputError, type McpShowsDeps, type McpTool, type ToolContext } from "../tool-types.ts";
import { claimsView, stateLabel } from "../shows/claims.ts";
import { SHOWS_ROWS, SHOWS_WORDS, SHOW_THINGS } from "../shows/words.ts";
import { loadEventByCode, normaliseCode } from "./shared.ts";

type Row = Record<string, unknown>;

export const NAME_MAX = 120;
export const EVENT_NAME_MAX = 200;
export const PLACE_MAX = 120;
export const LINEUP_MAX = 40;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIGITS = /^\d{5,32}$/;
const SPOTIFY_ID = /^[0-9A-Za-z]{22}$/;

const text = (row: Row | null | undefined, key: string): string => (row?.[key] == null ? "" : String(row[key]));
const key = (name: string) => name.trim().toLowerCase();

/** The clients form's slug (lib/db/clients.ts slugify). */
export function clientSlug(raw: string): string {
  return raw.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}

/** The event form's slug (lib/db/events.ts slugifyEvent). */
export function eventSlug(raw: string): string {
  return raw.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

/** mcp:draft (the server answers 403 first), and the shows paths wired. */
export function requireShows(ctx: ToolContext): McpShowsDeps {
  requireDraftScope(ctx);
  if (!ctx.shows) throw new Error("shows deps missing");
  return ctx.shows;
}

/** A trimmed string of at most `max` characters, or a refusal. */
function needName(value: unknown, max: number): string {
  const s = typeof value === "string" ? value.trim() : "";
  if (!s || [...s].length > max) throw new ToolInputError(SHOWS_WORDS.name(max), { refused: "bad_name" });
  return s;
}

function place(field: string, value: unknown): string {
  const s = typeof value === "string" ? value.trim() : "";
  if (!s) throw new ToolInputError(SHOWS_WORDS.textTooLong(field, PLACE_MAX), { refused: "bad_place", field });
  if ([...s].length > PLACE_MAX) throw new ToolInputError(SHOWS_WORDS.textTooLong(field, PLACE_MAX), { refused: "too_long", field });
  return s;
}

export function showDate(value: unknown): string {
  const s = typeof value === "string" ? value.trim() : "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new ToolInputError(SHOWS_WORDS.date, { refused: "bad_date" });
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (d.toISOString().slice(0, 10) !== s) throw new ToolInputError(SHOWS_WORDS.date, { refused: "bad_date" });
  return s;
}

export function timezone(value: unknown): string {
  const s = typeof value === "string" ? value.trim() : "";
  // An IANA zone has a slash (Europe/London) or is UTC; Intl refuses an unknown one.
  if (!s || !(s.includes("/") || s === "UTC")) throw new ToolInputError(SHOWS_WORDS.timezone(s || "(none)"), { refused: "bad_timezone" });
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: s });
  } catch {
    throw new ToolInputError(SHOWS_WORDS.timezone(s), { refused: "bad_timezone" });
  }
  return s;
}

/** An ad account id as the app stores it: digits only (lib/meta/ad-account.ts reads either form). */
function adAccount(value: unknown): string | null {
  if (value == null || value === "") return null;
  const raw = String(value).trim();
  const act = normalizeAdAccountId(raw);
  if (!act) throw new ToolInputError(SHOWS_WORDS.adAccount(raw.slice(0, 40)), { refused: "bad_ad_account" });
  return act.slice(4);
}

function digitsId(field: string, value: unknown): string | null {
  if (value == null || value === "") return null;
  const raw = String(value).trim();
  if (!DIGITS.test(raw)) throw new ToolInputError(SHOWS_WORDS.digits(field, raw.slice(0, 40)), { refused: "bad_id", field });
  return raw;
}

function optionalLink(field: "ticket_url" | "signup_url", value: unknown): string | null {
  if (value == null || value === "") return null;
  return normaliseLink(field, value);
}

interface ClientRef {
  id: string;
  name: string;
  status: string;
  primaryType: string;
}

/**
 * The caller's client by id, name or slug. Another account's client is
 * refused by name; an unknown one is refused as unknown.
 */
async function resolveClient(ctx: ToolContext, value: unknown): Promise<ClientRef> {
  const v = typeof value === "string" ? value.trim() : "";
  if (!v) throw new ToolInputError(SHOWS_WORDS.clientUnknown("(none)"), { refused: "client_unknown" });
  const mine = await ctx.db.from("clients").select("id, name, slug, status, primary_type, user_id").eq("user_id", ctx.userId).range(0, 1999);
  if (mine.error) throw new Error(`clients: ${mine.error.message}`);
  const rows = (mine.data ?? []) as Row[];
  const hit = UUID.test(v)
    ? rows.find((r) => text(r, "id") === v)
    : rows.find((r) => key(text(r, "name")) === key(v)) ?? rows.find((r) => text(r, "slug") === clientSlug(v));
  if (hit) return { id: text(hit, "id"), name: text(hit, "name"), status: text(hit, "status"), primaryType: text(hit, "primary_type") || "promoter" };
  // Someone else's?
  const other = UUID.test(v)
    ? await ctx.db.from("clients").select("id, name, user_id").eq("id", v).limit(1)
    : await ctx.db.from("clients").select("id, name, user_id").eq("slug", clientSlug(v)).limit(1);
  if (other.error) throw new Error(`clients: ${other.error.message}`);
  const theirs = ((other.data ?? []) as Row[])[0];
  if (theirs) throw new ToolInputError(SHOWS_WORDS.clientOther(text(theirs, "name") || v), { refused: "client_other_account", clientId: text(theirs, "id") });
  throw new ToolInputError(SHOWS_WORDS.clientUnknown(v), { refused: "client_unknown" });
}

interface ShowEvent {
  id: string;
  code: string;
  userId: string | null;
  clientId: string | null;
  eventDate: string | null;
}

async function loadShow(ctx: ToolContext, value: unknown): Promise<ShowEvent> {
  let code: string;
  try {
    code = normaliseCode(value);
  } catch {
    throw new ToolInputError(SHOWS_ROWS.badCode, { refused: "bad_code" });
  }
  const found = await loadEventByCode(ctx.db, code);
  if (!found) throw new ToolInputError(SHOWS_ROWS.unknownEvent(code), { code, refused: "event_not_found" });
  const res = await ctx.db.from("events").select("id, user_id, client_id, event_date").eq("id", found.primary.id).maybeSingle();
  if (res.error) throw new Error(`events: ${res.error.message}`);
  const row = res.data as Row | null;
  if (!row) throw new ToolInputError(SHOWS_ROWS.unknownEvent(code), { code, refused: "event_not_found" });
  return {
    id: text(row, "id"),
    code: found.primary.event_code ?? code,
    userId: (row.user_id as string | null) ?? null,
    clientId: (row.client_id as string | null) ?? null,
    eventDate: (row.event_date as string | null) ?? null,
  };
}

function requireOwner(ctx: ToolContext, event: ShowEvent) {
  if (event.userId !== ctx.userId) throw new ToolInputError(SHOWS_ROWS.otherAccount, { code: event.code, refused: "not_owner" });
}

// ── create_event ─────────────────────────────────────────────────────────────

export const createEventTool: McpTool = {
  name: "create_event",
  title: "Make an event",
  kind: "draft",
  readOnly: false,
  idempotent: false,
  failedText: SHOWS_ROWS.eventFailed,
  description: [
    "Makes a new event (a show) under one of your clients, as the event form's Create does: code, name, show date, venue, city, country and timezone, with the ticket and signup links and the event's own Meta ad account and pixel if it has them.",
    "Refuses a code that's already an event's (change that one with update_event). The event's Drive folders are made a few minutes later, as for an event made in the app. Nothing goes to Meta.",
    'Example: create_event({ client: "XMPL Promoter", code: "XMPL27-LDN", name: "XMPL Artist London", date: "2027-03-14", venue: "XMPL Venue", city: "London", country: "United Kingdom", timezone: "Europe/London", ticket_url: "https://example.com/tickets" }).',
  ].join(" "),
  inputSchema: {
    client: z.string().min(1).max(120).describe("The client's name or id (one of yours)."),
    code: z.string().min(2).max(41).describe('The new event code, e.g. "XMPL27-LDN".'),
    name: z.string().min(1).max(EVENT_NAME_MAX).describe("The event's name."),
    date: z.string().max(20).describe("The show day, YYYY-MM-DD."),
    venue: z.string().min(1).max(PLACE_MAX),
    city: z.string().min(1).max(PLACE_MAX),
    country: z.string().min(1).max(PLACE_MAX),
    timezone: z.string().min(1).max(64).describe('The venue\'s IANA timezone, e.g. "Europe/London".'),
    ticket_url: z.string().max(2000).optional(),
    signup_url: z.string().max(2000).optional(),
    meta_ad_account_id: z.string().max(40).optional().describe("The event's own ad account, when it isn't the client's."),
    meta_pixel_id: z.string().max(40).optional().describe("The event's own pixel, when it isn't the client's."),
  },
  async run(ctx, args) {
    const shows = requireShows(ctx);
    let code: string;
    try {
      code = normaliseCode(args.code);
    } catch {
      throw new ToolInputError(SHOWS_ROWS.badCode, { refused: "bad_code" });
    }
    const name = needName(args.name, EVENT_NAME_MAX);
    const date = showDate(args.date);
    const venue = place("venue", args.venue);
    const city = place("city", args.city);
    const country = place("country", args.country);
    const tz = timezone(args.timezone);
    const ticketUrl = optionalLink("ticket_url", args.ticket_url);
    const signupUrl = optionalLink("signup_url", args.signup_url);
    const account = adAccount(args.meta_ad_account_id);
    const pixel = digitsId("meta_pixel_id", args.meta_pixel_id);

    const client = await resolveClient(ctx, args.client);
    if (client.status === ARCHIVED) throw new ToolInputError(SHOWS_WORDS.clientArchived(client.name), { refused: "client_archived", clientId: client.id });

    // A code that is any event's (an archived client's too) is refused.
    const codes = [...new Set([code, code.toUpperCase()])];
    const taken = await ctx.db.from("events").select("id").in("event_code", codes).limit(1);
    if (taken.error) throw new Error(`events: ${taken.error.message}`);
    if (((taken.data ?? []) as Row[]).length > 0) throw new ToolInputError(SHOWS_WORDS.codeExists(code), { code, refused: "code_exists" });

    // The form's slug from the name; when the caller already has it (unique per user), the code is added.
    let slug = eventSlug(name);
    const clash = await ctx.db.from("events").select("id").eq("user_id", ctx.userId).eq("slug", slug).limit(1);
    if (clash.error) throw new Error(`events: ${clash.error.message}`);
    if (((clash.data ?? []) as Row[]).length > 0) slug = eventSlug(`${name} ${code}`);

    const row: Record<string, unknown> = {
      user_id: ctx.userId,
      client_id: client.id,
      name,
      slug,
      event_code: code,
      event_date: date,
      venue_name: venue,
      venue_city: city,
      venue_country: country,
      event_timezone: tz,
      ticket_url: ticketUrl,
      signup_url: signupUrl,
      status: "upcoming",
      ...(account ? { meta_ad_account_id: account } : {}),
      ...(pixel ? { meta_pixel_id: pixel } : {}),
    };
    let created: { id: string; slug: string };
    try {
      created = await shows.createEvent({ userId: ctx.userId, row });
    } catch (e) {
      throw new ToolInputError(SHOWS_ROWS.eventFailed, { code, refused: "save_failed", error: e instanceof Error ? e.message.slice(0, 200) : "error" });
    }
    return {
      data: {
        event: code,
        eventId: created.id,
        client: client.name,
        message: `${SHOWS_ROWS.done(SHOWS_ROWS.created(SHOW_THINGS.event, [code]))} ${SHOWS_WORDS.eventDriveNote}`,
      },
      eventId: created.id,
      clientId: client.id,
      summary: { code, eventId: created.id, clientId: client.id, fields: Object.keys(row).filter((k) => row[k] != null && k !== "user_id") },
    };
  },
};

// ── create_client ────────────────────────────────────────────────────────────

export const createClientTool: McpTool = {
  name: "create_client",
  title: "Make a client",
  kind: "draft",
  readOnly: false,
  idempotent: false,
  failedText: SHOWS_WORDS.clientFailed,
  description: [
    "Makes a new client, as the clients form's Create does, with its Meta ad account, pixel, Facebook page and Instagram account if you have them.",
    "A sub-brand is its own client: pass parent_client with the client it sits under (XMPL Sub-brand under XMPL Promoter). Refuses a name you already have.",
    "Nothing goes to Meta.",
    'Example: create_client({ name: "XMPL Sub-brand", parent_client: "XMPL Promoter", meta_ad_account_id: "act_1234567890" }).',
  ].join(" "),
  inputSchema: {
    name: z.string().min(1).max(NAME_MAX).describe("The client's name."),
    parent_client: z.string().max(120).optional().describe("For a sub-brand: the name or id of the client it sits under."),
    meta_ad_account_id: z.string().max(40).optional(),
    meta_pixel_id: z.string().max(40).optional(),
    page_id: z.string().max(40).optional().describe("The client's Facebook page id."),
    ig_id: z.string().max(40).optional().describe("The client's Instagram account id."),
  },
  async run(ctx, args) {
    const shows = requireShows(ctx);
    const name = needName(args.name, NAME_MAX);
    const account = adAccount(args.meta_ad_account_id);
    const pixel = digitsId("meta_pixel_id", args.meta_pixel_id);
    const page = digitsId("page_id", args.page_id);
    const ig = digitsId("ig_id", args.ig_id);

    const mine = await ctx.db.from("clients").select("id, name, slug").eq("user_id", ctx.userId).range(0, 1999);
    if (mine.error) throw new Error(`clients: ${mine.error.message}`);
    const slug = clientSlug(name);
    if (!slug) throw new ToolInputError(SHOWS_WORDS.name(NAME_MAX), { refused: "bad_name" });
    const dup = ((mine.data ?? []) as Row[]).find((r) => key(text(r, "name")) === key(name) || text(r, "slug") === slug);
    if (dup) throw new ToolInputError(SHOWS_WORDS.clientExists(text(dup, "name") || name), { refused: "client_exists", clientId: text(dup, "id") });

    let parent: ClientRef | null = null;
    const parentArg = typeof args.parent_client === "string" ? args.parent_client.trim() : "";
    if (parentArg) {
      try {
        parent = await resolveClient(ctx, parentArg);
      } catch (e) {
        if (e instanceof ToolInputError && (e.summary as Row | null)?.refused === "client_unknown") {
          throw new ToolInputError(SHOWS_WORDS.parentUnknown(parentArg, name), { refused: "parent_unknown" });
        }
        throw e;
      }
    }

    // The form's defaults: a promoter, active; a sub-brand takes its parent's type.
    const primaryType = parent?.primaryType || "promoter";
    const row: Record<string, unknown> = {
      user_id: ctx.userId,
      name,
      slug,
      primary_type: primaryType,
      types: [primaryType],
      status: "active",
      meta_ad_account_id: account,
      meta_pixel_id: pixel,
      ...(page ? { default_page_ids: [page] } : {}),
      ...(ig ? { default_instagram_actor_id: ig } : {}),
      ...(parent ? { parent_client_id: parent.id } : {}),
    };
    let created: { id: string; slug: string };
    try {
      created = await shows.createClient({ userId: ctx.userId, row });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (parent && /parent_client_id/i.test(message)) throw new ToolInputError(SHOWS_WORDS.parentNotReady, { refused: "parent_not_ready", error: message.slice(0, 200) });
      throw new ToolInputError(SHOWS_WORDS.clientFailed, { refused: "save_failed", error: message.slice(0, 200) });
    }
    const lines = [SHOWS_ROWS.done(SHOWS_ROWS.created(SHOW_THINGS.client, [name]))];
    if (parent) lines.push(SHOWS_WORDS.subBrand(name, parent.name));
    return {
      data: { client: name, clientId: created.id, ...(parent ? { parent: parent.name, parentId: parent.id } : {}), message: lines.join(" ") },
      clientId: created.id,
      summary: { clientId: created.id, parentId: parent?.id ?? null, fields: Object.keys(row).filter((k) => row[k] != null && k !== "user_id") },
    };
  },
};

// ── set_lineup ───────────────────────────────────────────────────────────────

interface ActInput {
  name: string;
  role: "headliner" | "support";
  spotifyId: string | null;
}

export const setLineupTool: McpTool = {
  name: "set_lineup",
  title: "Set a show's lineup",
  kind: "draft",
  readOnly: false,
  idempotent: true,
  failedText: SHOWS_WORDS.lineupFailed,
  description: [
    "Sets a show's lineup in the Lab, in billing order, as the Lab's lineup save does: it replaces the acts the Lab holds for the show (acts read in from ad copy or campaign names stay).",
    "Each act is a name from the artist library, headliner or support. An act that isn't in the library needs its spotify_id, and is added as the Lab's add-from-Spotify adds it. Every name is checked before anything is saved.",
    'Example: set_lineup({ event: "XMPL27-LDN", acts: [{ name: "XMPL Artist", role: "headliner" }, { name: "XMPL Support", role: "support", spotify_id: "0123456789abcdefABCDEF" }] }).',
  ].join(" "),
  inputSchema: {
    event: z.string().min(2).max(41).describe('The event code, e.g. "XMPL27-LDN".'),
    acts: z
      .array(
        z.object({
          name: z.string().min(1).max(NAME_MAX),
          role: z.enum(["headliner", "support"]),
          spotify_id: z.string().max(40).optional(),
        }),
      )
      .max(LINEUP_MAX)
      .describe("The whole lineup, in billing order."),
  },
  async run(ctx, args) {
    const shows = requireShows(ctx);
    const event = await loadShow(ctx, args.event);
    requireOwner(ctx, event);
    const given = Array.isArray(args.acts) ? (args.acts as Row[]) : [];
    if (given.length === 0) throw new ToolInputError(SHOWS_WORDS.lineupEmpty, { code: event.code, refused: "empty" });
    const acts: ActInput[] = [];
    const seen = new Set<string>();
    for (const a of given) {
      const name = needName(a.name, NAME_MAX);
      if (seen.has(key(name))) throw new ToolInputError(SHOWS_WORDS.lineupTwice(name), { code: event.code, refused: "twice" });
      seen.add(key(name));
      const sid = typeof a.spotify_id === "string" && a.spotify_id.trim() ? a.spotify_id.trim() : null;
      if (sid && !SPOTIFY_ID.test(sid)) throw new ToolInputError(SHOWS_WORDS.lineupSpotify(sid.slice(0, 40)), { code: event.code, refused: "bad_spotify_id" });
      acts.push({ name, role: a.role === "headliner" ? "headliner" : "support", spotifyId: sid });
    }

    // The caller's artist library (saveLabLineup keeps only the caller's artists).
    const lib = await ctx.db.from("artists").select("id, name, spotify_id").eq("user_id", ctx.userId).range(0, 9999);
    if (lib.error) throw new Error(`artists: ${lib.error.message}`);
    const library = (lib.data ?? []) as Row[];
    const plan: Array<{ act: ActInput; artistId: string | null }> = [];
    for (const act of acts) {
      if (act.spotifyId) {
        const bySpotify = library.find((r) => text(r, "spotify_id") === act.spotifyId);
        plan.push({ act, artistId: bySpotify ? text(bySpotify, "id") : null });
        continue;
      }
      const named = library.filter((r) => key(text(r, "name")) === key(act.name));
      if (named.length === 0) throw new ToolInputError(SHOWS_WORDS.lineupUnknown(act.name), { code: event.code, refused: "unknown_artist" });
      if (named.length > 1) throw new ToolInputError(SHOWS_WORDS.lineupAmbiguous(act.name, named.length), { code: event.code, refused: "ambiguous_artist" });
      plan.push({ act, artistId: text(named[0]!, "id") });
    }

    const added: string[] = [];
    let facts: { lineup: string[]; headliners: string[] };
    try {
      for (const p of plan) {
        if (p.artistId) continue;
        const made = await shows.addSpotifyArtist({ userId: ctx.userId, eventId: event.id, name: p.act.name, spotifyId: p.act.spotifyId! });
        p.artistId = made.artistId;
        added.push(p.act.name);
      }
      facts = await shows.saveLineup({ userId: ctx.userId, eventId: event.id, slots: plan.map((p) => ({ artistId: p.artistId!, isHeadliner: p.act.role === "headliner" })) });
    } catch (e) {
      throw new ToolInputError(SHOWS_WORDS.lineupFailed, { code: event.code, refused: "save_failed", added: added.length, error: e instanceof Error ? e.message.slice(0, 200) : "error" });
    }
    const lines = [SHOWS_WORDS.lineupDone(event.code, facts.lineup, facts.headliners)];
    if (added.length) lines.push(SHOWS_WORDS.lineupAdded(added));
    return {
      data: { event: event.code, lineup: facts.lineup, headliners: facts.headliners, ...(added.length ? { addedToLibrary: added } : {}), message: lines.join(" ") },
      eventId: event.id,
      clientId: event.clientId,
      summary: { code: event.code, eventId: event.id, acts: facts.lineup.length, headliners: facts.headliners.length, addedToLibrary: added.length },
    };
  },
};

// ── get_releases / set_release ───────────────────────────────────────────────

async function readClaims(shows: McpShowsDeps, event: ShowEvent, now: Date) {
  let data: Awaited<ReturnType<McpShowsDeps["loadReleases"]>>;
  try {
    data = await shows.loadReleases({ eventId: event.id, clientId: event.clientId });
  } catch (e) {
    throw new ToolInputError(SHOWS_WORDS.releasesUnavailable, { code: event.code, refused: "read_failed", error: e instanceof Error ? e.message.slice(0, 200) : "error" });
  }
  if (!data || data.releases.length === 0) return null;
  return { data, view: claimsView({ ...data, eventAt: data.eventAt ?? event.eventDate }, now.toISOString()) };
}

export const getReleasesTool: McpTool = {
  name: "get_releases",
  title: "Read a show's releases and claims",
  kind: "draft",
  readOnly: true,
  idempotent: true,
  description: [
    "Reads a show's ticket releases from its Releases card (each release's state, when it was set, the count), and the claims its ladder gives now, with when they were read.",
    "A claim marked met can go in copy; one marked not yet says what it waits for and must not be used until it's met.",
    'Example: get_releases({ event: "XMPL27-LDN" }).',
  ].join(" "),
  inputSchema: {
    event: z.string().min(2).max(41).describe('The event code, e.g. "XMPL27-LDN".'),
  },
  async run(ctx, args) {
    const shows = requireShows(ctx);
    const event = await loadShow(ctx, args.event);
    const read = await readClaims(shows, event, ctx.now);
    if (!read) return { data: { event: event.code, releases: [], claims: [], message: SHOWS_WORDS.releasesNone(event.code) }, eventId: event.id, clientId: event.clientId, summary: { code: event.code, releases: 0 } };
    return {
      data: { event: event.code, ...read.view },
      eventId: event.id,
      clientId: event.clientId,
      summary: { code: event.code, releases: read.view.releases.length, claimsMet: read.view.claims.filter((c) => c.met).length, claimsLater: read.view.claims.filter((c) => !c.met).length },
    };
  },
};

type ReleasesRows = NonNullable<Awaited<ReturnType<McpShowsDeps["loadReleases"]>>>["releases"];

const sameInstant = (a: string | null, b: string | null) => (a == null || b == null ? a == b : Date.parse(a) === Date.parse(b));

/**
 * Would the card's save move the event's presale or general sale time? The
 * route's own steps, pure: applyState (when a state is given), applyCount
 * (when a count is), then deriveSaleDates over every release, against what
 * the event holds now.
 */
async function saleTimesMoved(
  ctx: ToolContext,
  eventId: string,
  releases: ReleasesRows,
  releaseId: string,
  change: { state: ReleaseState | null; count: number | null; confirmed: boolean; userId: string; now: Date },
) {
  const res = await ctx.db.from("events").select("presale_at, general_sale_at").eq("id", eventId).maybeSingle();
  if (res.error) throw new Error(`events: ${res.error.message}`);
  const row = (res.data ?? {}) as { presale_at?: string | null; general_sale_at?: string | null };
  const now = { presaleAt: row.presale_at ?? null, generalSaleAt: row.general_sale_at ?? null };
  const current = releases.find((r) => r.id === releaseId)!;
  let next = current;
  if (change.state) {
    const remembered = releases.find((r) => r.stateSource)?.stateSource ?? "entry";
    next = applyState(current, change.state, { at: change.now.toISOString(), source: remembered, user: change.userId, confirmed: true }).release;
  }
  if (change.count != null) next = applyCount(next, change.count).release;
  const after = deriveSaleDates(releases.map((r) => (r.id === next.id ? next : r)));
  return { now, after, presale: !sameInstant(now.presaleAt, after.presaleAt), general: !sameInstant(now.generalSaleAt, after.generalSaleAt) };
}

export const setReleaseTool: McpTool = {
  name: "set_release",
  title: "Set a release's state or count",
  kind: "draft",
  readOnly: false,
  idempotent: true,
  failedText: SHOWS_WORDS.releaseFailed,
  description: [
    "Sets one ticket release's state (not_yet, on_sale, selling_fast, final_x, sold_out), its sold count, or both, as a tap on the Releases card does. A change that would move the event's presale or general sale time is refused: those move only through update_event, with Matas's yes.",
    "A step back (sold_out to on_sale) asks once, as the card does: ask Matas, then send it again with confirmed: true. Returns the claims the ladder gives after the change, with when they were read.",
    'Example: set_release({ event: "XMPL27-LDN", release: "Tier 2", state: "selling_fast" }).',
  ].join(" "),
  inputSchema: {
    event: z.string().min(2).max(41).describe('The event code, e.g. "XMPL27-LDN".'),
    release: z.string().min(1).max(120).describe("The release's name as get_releases gives it, or its id."),
    state: z.enum(RELEASE_STATES).optional(),
    count: z.number().int().min(0).max(1_000_000).optional().describe("Tickets sold on this release."),
    confirmed: z.boolean().optional().describe("True only after Matas said yes to a step back."),
  },
  async run(ctx, args) {
    const shows = requireShows(ctx);
    const event = await loadShow(ctx, args.event);
    requireOwner(ctx, event);
    const state = typeof args.state === "string" ? (args.state as ReleaseState) : null;
    const count = typeof args.count === "number" ? args.count : null;
    if (state == null && count == null) throw new ToolInputError(SHOWS_WORDS.releaseEmpty, { code: event.code, refused: "empty" });

    const before = await readClaims(shows, event, ctx.now);
    if (!before) throw new ToolInputError(SHOWS_WORDS.releasesNone(event.code), { code: event.code, refused: "no_releases" });
    const wanted = String(args.release ?? "").trim();
    const release = before.data.releases.find((r) => r.id === wanted) ?? before.data.releases.find((r) => key(r.name) === key(wanted));
    if (!release) {
      throw new ToolInputError(SHOWS_WORDS.releaseUnknown(wanted, event.code, before.data.releases.map((r) => r.name)), { code: event.code, refused: "release_unknown" });
    }
    const confirmed = args.confirmed === true;
    // The card's rule (applyState): a step back asks once. Checked here too so nothing is sent.
    if (state && stateIndex(state) < stateIndex(release.state) && !confirmed) {
      throw new ToolInputError(SHOWS_WORDS.releaseBackwards(release.name, stateLabel(release.state), stateLabel(state)), { code: event.code, releaseId: release.id, refused: "backwards" });
    }

    // Matas, 26 Nov: set_release never moves the event's times. The card's save
    // re-derives presale_at and general_sale_at from the releases (deriveSaleDates);
    // the same pure steps run here first, and a change that would move either is
    // refused before anything is saved. Times move only through update_event.
    const moved = await saleTimesMoved(ctx, event.id, before.data.releases, release.id, { state, count, confirmed, userId: ctx.userId, now: ctx.now });
    if (moved.presale || moved.general) {
      throw new ToolInputError(SHOWS_WORDS.releaseMovesTimes(event.code, moved.presale, moved.general), {
        code: event.code,
        releaseId: release.id,
        refused: "moves_sale_times",
        presale: moved.presale ? { now: moved.now.presaleAt, after: moved.after.presaleAt } : null,
        general: moved.general ? { now: moved.now.generalSaleAt, after: moved.after.generalSaleAt } : null,
      });
    }

    let res: { status: number; body: Record<string, unknown> };
    try {
      res = await shows.postRelease({
        userId: ctx.userId,
        eventId: event.id,
        body: { releaseId: release.id, ...(state ? { state } : {}), ...(count != null ? { sold: count } : {}), confirmed },
      });
    } catch (e) {
      throw new ToolInputError(SHOWS_WORDS.releaseFailed, { code: event.code, releaseId: release.id, refused: "save_failed", error: e instanceof Error ? e.message.slice(0, 200) : "error" });
    }
    if (res.body.ask === true) {
      throw new ToolInputError(SHOWS_WORDS.releaseBackwards(release.name, stateLabel(release.state), stateLabel(state ?? release.state)), { code: event.code, releaseId: release.id, refused: "backwards" });
    }
    if (res.status >= 400) {
      throw new ToolInputError(SHOWS_WORDS.releaseFailed, { code: event.code, releaseId: release.id, refused: "save_failed", status: res.status });
    }

    const after = await readClaims(shows, event, ctx.now);
    const changes: string[] = [];
    if (state && state !== release.state) changes.push(`${stateLabel(release.state)} → ${stateLabel(state)}`);
    else if (state) changes.push(stateLabel(state));
    if (count != null) changes.push(SHOWS_WORDS.releaseCount(count));
    return {
      data: {
        event: event.code,
        release: release.name,
        message: SHOWS_WORDS.releaseDone(release.name, changes.join(", ")),
        ...(after ? after.view : { releases: [], claims: [] }),
      },
      eventId: event.id,
      clientId: event.clientId,
      summary: {
        code: event.code,
        releaseId: release.id,
        before: { state: release.state, sold: release.sold },
        after: { state: state ?? release.state, sold: count ?? release.sold },
        claimsMet: after ? after.view.claims.filter((c) => c.met).length : 0,
      },
    };
  },
};

export const SHOWS_TOOLS: readonly McpTool[] = [createEventTool, createClientTool, setLineupTool, getReleasesTool, setReleaseTool];
