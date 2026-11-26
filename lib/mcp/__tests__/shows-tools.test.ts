/**
 * M3d-a: the shows tools (create_event, create_client, set_lineup,
 * get_releases, set_release). Each calls only its app path (spies on
 * ctx.shows), refuses what the brief says before anything is written, and
 * never writes the database itself. The lineup save is also run through
 * the Lab's own saveLabLineup / addSpotifyToLineup on the Lab's fake
 * database, to show it replaces as the Lab does. The claims come from the
 * card's own reckoning, and a claim is never above its trigger.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { fakeDb } from "./fake-db.ts";
import { fakeReaders } from "./fixtures.ts";
import { MCP_TOOLS } from "../tools/index.ts";
import { createClientTool, createEventTool, getReleasesTool, setLineupTool, setReleaseTool } from "../tools/shows.ts";
import { claimsView, type ReleasesData } from "../shows/claims.ts";
import { SHOWS_FOR_DESIGN, SHOWS_WORDS } from "../shows/words.ts";
import { EVENT_WORDS } from "../meta/words.ts";
import { ToolInputError, type McpShowsDeps, type ToolContext } from "../tool-types.ts";
import { addSpotifyToLineup, saveLabLineup } from "../../creative-lab/lineup.ts";
import { fakeDb as labFakeDb } from "../../creative-lab/__tests__/fake-db.ts";
import type { ServiceRoleDb } from "../../creative-lab/load.ts";
import type { Release } from "../../releases/types.ts";

type Row = Record<string, unknown>;
type Call = { fn: string; input: Record<string, unknown> };

const MATAS = "b3ee4e5c-0000-4000-8000-000000000001";
const OTHER = "b3ee4e5c-0000-4000-8000-000000000002";
const DHB = "c1000000-0000-4000-8000-000000000001";
const THEIRS = "c1000000-0000-4000-8000-000000000002";
const ARCHIVED = "c1000000-0000-4000-8000-000000000003";
const EV = "e1000000-0000-4000-8000-000000000001";
const EV_THEIRS = "e1000000-0000-4000-8000-000000000002";
const NOW = new Date("2026-11-26T03:00:00Z");
const SPOTIFY_NEW = "0123456789abcdefABCDEF";

const ev = (r: Row): Row => ({
  name: null,
  venue_name: null,
  venue_city: null,
  event_date: null,
  announcement_at: null,
  presale_at: null,
  general_sale_at: null,
  status: "upcoming",
  meta_campaign_id: null,
  slug: null,
  ...r,
});

function tables(): Record<string, Row[]> {
  return {
    clients: [
      { id: DHB, user_id: MATAS, name: "Deep House Bible", slug: "deep-house-bible", status: "active", primary_type: "promoter" },
      { id: THEIRS, user_id: OTHER, name: "Their Promoter", slug: "their-promoter", status: "active", primary_type: "promoter" },
      { id: ARCHIVED, user_id: MATAS, name: "Old Client", slug: "old-client", status: "archived", primary_type: "venue" },
    ],
    events: [
      ev({ id: EV, user_id: MATAS, client_id: DHB, client: { name: "Deep House Bible" }, event_code: "AS27-LDN", name: "Ahmed Spins London", slug: "ahmed-spins-london", event_date: "2027-02-01" }),
      ev({ id: EV_THEIRS, user_id: OTHER, client_id: THEIRS, client: { name: "Their Promoter" }, event_code: "OT27-X", name: "Theirs", slug: "theirs", event_date: "2027-03-01" }),
    ],
    artists: [
      { id: "a-ahmed", user_id: MATAS, name: "Ahmed Spins", spotify_id: "AAAAAAAAAAAAAAAAAAAAAA" },
      { id: "a-enzo", user_id: MATAS, name: "Enzo Siragusa", spotify_id: null },
      { id: "a-twin-1", user_id: MATAS, name: "Twin", spotify_id: "TTTTTTTTTTTTTTTTTTTTT1" },
      { id: "a-twin-2", user_id: MATAS, name: "Twin", spotify_id: "TTTTTTTTTTTTTTTTTTTTT2" },
      { id: "a-theirs", user_id: OTHER, name: "Someone", spotify_id: null },
    ],
  };
}

const release = (r: Partial<Release> & { id: string; name: string }): Release => ({
  eventId: EV,
  position: 1,
  communityAt: null,
  listAt: "2026-11-01T10:00:00Z",
  state: "on_sale",
  stateAt: "2026-11-20T10:00:00Z",
  stateSource: "entry",
  stateSetBy: MATAS,
  price: 20,
  capacity: 100,
  sold: null,
  remaining: null,
  ...r,
});

function releasesData(releases: Release[]): ReleasesData {
  return { releases, ladder: [], counts: [], artists: [], lastProposalAt: null, eventAt: "2027-02-01" };
}

function showsSpy(opts: { releases?: Release[] | null; postStatus?: number; postAsk?: boolean; createThrows?: string; lineupThrows?: boolean } = {}) {
  const calls: Call[] = [];
  let data = opts.releases === undefined ? [release({ id: "r1", name: "Tier 1" })] : opts.releases;
  const shows: McpShowsDeps = {
    async createEvent(input) {
      calls.push({ fn: "createEvent", input: input as never });
      if (opts.createThrows) throw new Error(opts.createThrows);
      return { id: "e-new", slug: String(input.row.slug) };
    },
    async createClient(input) {
      calls.push({ fn: "createClient", input: input as never });
      if (opts.createThrows) throw new Error(opts.createThrows);
      return { id: "c-new", slug: String(input.row.slug) };
    },
    async addSpotifyArtist(input) {
      calls.push({ fn: "addSpotifyArtist", input: input as never });
      return { artistId: `a-new-${input.spotifyId}` };
    },
    async saveLineup(input) {
      calls.push({ fn: "saveLineup", input: input as never });
      if (opts.lineupThrows) throw new Error("db down");
      return { lineup: input.slots.map((s) => s.artistId), headliners: input.slots.filter((s) => s.isHeadliner).map((s) => s.artistId) };
    },
    async loadReleases(input) {
      calls.push({ fn: "loadReleases", input: input as never });
      return data == null ? null : releasesData(data);
    },
    async postRelease(input) {
      calls.push({ fn: "postRelease", input: input as never });
      if (opts.postAsk) return { status: 200, body: { ask: true } };
      const body = input.body as { releaseId: string; state?: Release["state"]; sold?: number };
      data = (data ?? []).map((r) => (r.id === body.releaseId ? { ...r, ...(body.state ? { state: body.state, stateAt: NOW.toISOString() } : {}), ...(body.sold != null ? { sold: body.sold } : {}) } : r));
      return { status: opts.postStatus ?? 200, body: { ask: false } };
    },
  };
  return { shows, calls };
}

function ctxFor(opts: { userId?: string; scope?: string; shows?: McpShowsDeps; t?: Record<string, Row[]> } = {}) {
  const db = fakeDb(opts.t ?? tables());
  const spy = showsSpy();
  const ctx: ToolContext = {
    db,
    readers: fakeReaders as never,
    userId: opts.userId ?? MATAS,
    scope: opts.scope ?? "mcp:read mcp:draft",
    draft: {} as never,
    shows: opts.shows ?? spy.shows,
    seesClientNames: true,
    today: "2026-11-26",
    now: NOW,
  };
  return { ctx, db, calls: spy.calls };
}

async function refused(p: Promise<unknown>): Promise<ToolInputError> {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof ToolInputError, `a plain refusal, not ${e instanceof Error ? e.message : String(e)}`);
    return e;
  }
  assert.fail("expected a refusal");
}

const EVENT_ARGS = {
  client: "Deep House Bible",
  code: "AS27-TORONTO",
  name: "Ahmed Spins Toronto",
  date: "2027-03-14",
  venue: "Rebel",
  city: "Toronto",
  country: "Canada",
  timezone: "America/Toronto",
  ticket_url: "https://example.com/tickets",
};

// ── shape ───────────────────────────────────────────────────────────────────

test("the five shows tools are draft tools, need mcp:draft, and each carries one example", async () => {
  for (const name of ["create_event", "create_client", "set_lineup", "get_releases", "set_release"]) {
    const tool = MCP_TOOLS.find((t) => t.name === name);
    assert.ok(tool, name);
    assert.equal(tool!.kind, "draft", name);
    assert.equal((tool!.description.match(/Example: /g) ?? []).length, 1, name);
  }
  const { ctx, calls } = ctxFor({ scope: "mcp:read" });
  const e = await refused(createEventTool.run(ctx, EVENT_ARGS));
  assert.equal((e.summary as Row).refused, "insufficient_scope");
  assert.equal(calls.length, 0);
});

test("every PENDING DESIGN string has a key and ends a refusal with Nothing was changed.", () => {
  assert.ok(SHOWS_FOR_DESIGN.length > 0);
  const keys = new Set<string>();
  for (const w of SHOWS_FOR_DESIGN) {
    assert.match(w.key, /^claude\.mcp\.shows\./, w.key);
    assert.ok(!keys.has(w.key), `one entry per key: ${w.key}`);
    keys.add(w.key);
    if (w.candidate.startsWith("Refused")) assert.match(w.candidate, /Nothing was changed\.$/, w.key);
  }
});

// ── create_event ────────────────────────────────────────────────────────────

test("create_event: the form's create with the caller's user_id and client, and nothing written by the tool itself", async () => {
  const { ctx, db, calls } = ctxFor();
  const out = await createEventTool.run(ctx, { ...EVENT_ARGS, meta_ad_account_id: "act_1234567890", meta_pixel_id: "998877665544" });
  assert.deepEqual(calls.map((c) => c.fn), ["createEvent"]);
  const row = (calls[0]!.input as { row: Row }).row;
  assert.equal(row.user_id, MATAS);
  assert.equal(row.client_id, DHB);
  assert.equal(row.event_code, "AS27-TORONTO");
  assert.equal(row.slug, "ahmed-spins-toronto");
  assert.equal(row.event_timezone, "America/Toronto");
  assert.equal(row.status, "upcoming");
  assert.equal(row.meta_ad_account_id, "1234567890", "stored as digits, as the app's rows are");
  assert.equal(row.meta_pixel_id, "998877665544");
  assert.deepEqual(db.writes, []);
  const data = out.data as Row;
  assert.match(String(data.message), /^Done: 1 event created · AS27-TORONTO\. Its Drive folders/);
});

test("create_event refuses an existing code (as written or upper-cased) before anything runs", async () => {
  for (const code of ["AS27-LDN", "as27-ldn"]) {
    const { ctx, calls } = ctxFor();
    const e = await refused(createEventTool.run(ctx, { ...EVENT_ARGS, code }));
    assert.equal(e.message, SHOWS_WORDS.codeExists(code));
    assert.equal(calls.length, 0);
  }
  // Another account's code too.
  const { ctx, calls } = ctxFor();
  await refused(createEventTool.run(ctx, { ...EVENT_ARGS, code: "OT27-X" }));
  assert.equal(calls.length, 0);
});

test("create_event refuses another account's client, an unknown one and an archived one", async () => {
  const cases: Array<[string, string]> = [
    ["Their Promoter", SHOWS_WORDS.clientOther("Their Promoter")],
    [THEIRS, SHOWS_WORDS.clientOther("Their Promoter")],
    ["Nobody", SHOWS_WORDS.clientUnknown("Nobody")],
    ["Old Client", SHOWS_WORDS.clientArchived("Old Client")],
  ];
  for (const [client, words] of cases) {
    const { ctx, calls } = ctxFor();
    const e = await refused(createEventTool.run(ctx, { ...EVENT_ARGS, client }));
    assert.equal(e.message, words, client);
    assert.equal(calls.length, 0);
  }
});

test("create_event refuses bad dates, timezones, links and ids, each ending Nothing changed", async () => {
  const bad: Array<[Row, string]> = [
    [{ date: "2027-02-30" }, SHOWS_WORDS.date],
    [{ date: "14/03/2027" }, SHOWS_WORDS.date],
    [{ timezone: "Toronto" }, SHOWS_WORDS.timezone("Toronto")],
    [{ timezone: "Mars/Olympus" }, SHOWS_WORDS.timezone("Mars/Olympus")],
    [{ ticket_url: "http://example.com" }, EVENT_WORDS.refusedLink("Ticket link")],
    [{ signup_url: "not a link" }, EVENT_WORDS.refusedLink("Signup link")],
    [{ meta_ad_account_id: "act_12" }, SHOWS_WORDS.adAccount("act_12")],
    [{ meta_pixel_id: "px-1" }, SHOWS_WORDS.digits("meta_pixel_id", "px-1")],
    [{ code: "!" }, EVENT_WORDS.refusedCode],
  ];
  for (const [patch, words] of bad) {
    const { ctx, calls } = ctxFor();
    const e = await refused(createEventTool.run(ctx, { ...EVENT_ARGS, ...patch }));
    assert.equal(e.message, words, JSON.stringify(patch));
    assert.match(e.message, /Nothing (was )?changed\.$/);
    assert.equal(calls.length, 0);
  }
});

test("create_event: a name the caller already has gets the code on its slug; a failed save is plain", async () => {
  const { ctx, calls } = ctxFor();
  await createEventTool.run(ctx, { ...EVENT_ARGS, name: "Ahmed Spins London" });
  assert.equal((calls[0]!.input as { row: Row }).row.slug, "ahmed-spins-london-as27-toronto");
  const failing = showsSpy({ createThrows: 'duplicate key value violates unique constraint "events_slug_unique_per_user"' });
  const e = await refused(createEventTool.run(ctxFor({ shows: failing.shows }).ctx, EVENT_ARGS));
  assert.equal(e.message, EVENT_WORDS.failed);
  assert.doesNotMatch(e.message, /duplicate|constraint/);
});

// ── create_client ───────────────────────────────────────────────────────────

test("create_client: a sub-brand is its own client linked to its parent, with its channel defaults", async () => {
  const { ctx, db, calls } = ctxFor();
  const out = await createClientTool.run(ctx, { name: "Ahmed Spins", parent_client: "Deep House Bible", meta_ad_account_id: "1234567890", page_id: "111222333", ig_id: "17841400000000" });
  assert.deepEqual(calls.map((c) => c.fn), ["createClient"]);
  const row = (calls[0]!.input as { row: Row }).row;
  assert.equal(row.user_id, MATAS);
  assert.equal(row.name, "Ahmed Spins");
  assert.equal(row.slug, "ahmed-spins");
  assert.equal(row.parent_client_id, DHB, "linked to the client it sits under");
  assert.equal(row.primary_type, "promoter");
  assert.deepEqual(row.types, ["promoter"]);
  assert.equal(row.status, "active");
  assert.deepEqual(row.default_page_ids, ["111222333"]);
  assert.equal(row.default_instagram_actor_id, "17841400000000");
  assert.deepEqual(db.writes, []);
  assert.equal((out.data as Row).message, "Done: 1 client created · Ahmed Spins. Ahmed Spins sits under Deep House Bible.");
  // A top-level client has no parent link at all.
  const top = ctxFor();
  await createClientTool.run(top.ctx, { name: "New Promoter" });
  assert.equal("parent_client_id" in (top.calls[0]!.input as { row: Row }).row, false);
});

test("create_client refuses a name the caller already has, an unknown parent and another account's parent", async () => {
  const cases: Array<[Row, string]> = [
    [{ name: "deep house bible" }, SHOWS_WORDS.clientExists("Deep House Bible")],
    [{ name: "Deep-House Bible" }, SHOWS_WORDS.clientExists("Deep House Bible")],
    [{ name: "Ahmed Spins", parent_client: "Nobody" }, SHOWS_WORDS.parentUnknown("Nobody", "Ahmed Spins")],
    [{ name: "Ahmed Spins", parent_client: "Their Promoter" }, SHOWS_WORDS.clientOther("Their Promoter")],
    [{ name: "Ahmed Spins", page_id: "abc" }, SHOWS_WORDS.digits("page_id", "abc")],
  ];
  for (const [args, words] of cases) {
    const { ctx, calls } = ctxFor();
    const e = await refused(createClientTool.run(ctx, args));
    assert.equal(e.message, words, JSON.stringify(args));
    assert.equal(calls.length, 0);
  }
});

test("create_client with a parent before migration 272 says so, and never shows the database error", async () => {
  const failing = showsSpy({ createThrows: "Could not find the 'parent_client_id' column of 'clients' in the schema cache" });
  const e = await refused(createClientTool.run(ctxFor({ shows: failing.shows }).ctx, { name: "Ahmed Spins", parent_client: "Deep House Bible" }));
  assert.equal(e.message, SHOWS_WORDS.parentNotReady);
  assert.doesNotMatch(e.message, /schema cache/);
});

// ── set_lineup ──────────────────────────────────────────────────────────────

test("set_lineup: library names by name, a new act by its spotify_id, saved in billing order through the Lab's paths", async () => {
  const { ctx, db, calls } = ctxFor();
  const out = await setLineupTool.run(ctx, {
    event: "AS27-LDN",
    acts: [
      { name: "Ahmed Spins", role: "headliner" },
      { name: "Enzo Siragusa", role: "support" },
      { name: "Brand New", role: "support", spotify_id: SPOTIFY_NEW },
    ],
  });
  assert.deepEqual(calls.map((c) => c.fn), ["addSpotifyArtist", "saveLineup"]);
  assert.deepEqual(calls[0]!.input, { userId: MATAS, eventId: EV, name: "Brand New", spotifyId: SPOTIFY_NEW });
  assert.deepEqual((calls[1]!.input as { slots: unknown }).slots, [
    { artistId: "a-ahmed", isHeadliner: true },
    { artistId: "a-enzo", isHeadliner: false },
    { artistId: `a-new-${SPOTIFY_NEW}`, isHeadliner: false },
  ]);
  assert.deepEqual(db.writes, []);
  assert.deepEqual((out.data as Row).addedToLibrary, ["Brand New"]);
});

test("set_lineup: a library act passed with its spotify_id is matched by the id, never added again", async () => {
  const { ctx, calls } = ctxFor();
  await setLineupTool.run(ctx, { event: "AS27-LDN", acts: [{ name: "Twin", role: "headliner", spotify_id: "TTTTTTTTTTTTTTTTTTTTT2" }] });
  assert.deepEqual(calls.map((c) => c.fn), ["saveLineup"]);
  assert.deepEqual((calls[0]!.input as { slots: unknown }).slots, [{ artistId: "a-twin-2", isHeadliner: true }]);
});

test("set_lineup refuses before anything is written: unknown, ambiguous, twice, empty, a bad spotify id, another account's show", async () => {
  const cases: Array<[Row, string]> = [
    [{ event: "AS27-LDN", acts: [{ name: "Ahmed Spins", role: "headliner" }, { name: "Nobody Known", role: "support" }] }, SHOWS_WORDS.lineupUnknown("Nobody Known")],
    [{ event: "AS27-LDN", acts: [{ name: "Twin", role: "headliner" }] }, SHOWS_WORDS.lineupAmbiguous("Twin", 2)],
    [{ event: "AS27-LDN", acts: [{ name: "Enzo Siragusa", role: "headliner" }, { name: "enzo siragusa", role: "support" }] }, SHOWS_WORDS.lineupTwice("enzo siragusa")],
    [{ event: "AS27-LDN", acts: [] }, SHOWS_WORDS.lineupEmpty],
    [{ event: "AS27-LDN", acts: [{ name: "X", role: "support", spotify_id: "short" }] }, SHOWS_WORDS.lineupSpotify("short")],
    [{ event: "OT27-X", acts: [{ name: "Someone", role: "headliner" }] }, EVENT_WORDS.refusedOtherAccount],
    [{ event: "ZZ27-NONE", acts: [{ name: "Someone", role: "headliner" }] }, EVENT_WORDS.refusedUnknown("ZZ27-NONE")],
  ];
  for (const [args, words] of cases) {
    const { ctx, calls } = ctxFor();
    const e = await refused(setLineupTool.run(ctx, args));
    assert.equal(e.message, words, JSON.stringify(args));
    assert.equal(calls.length, 0, `nothing ran for ${JSON.stringify(args)}`);
  }
  // Someone else's library artist isn't the caller's.
  const { ctx, calls } = ctxFor();
  await refused(setLineupTool.run(ctx, { event: "AS27-LDN", acts: [{ name: "Someone", role: "headliner" }] }));
  assert.equal(calls.length, 0);
});

test("set_lineup through the Lab's own saveLabLineup: it replaces the show's lab rows, keeps read-in rows, and writes the facts", async () => {
  const lab = labFakeDb({
    artists: [
      { id: "a-ahmed", user_id: MATAS, name: "Ahmed Spins", spotify_id: "AAAAAAAAAAAAAAAAAAAAAA" },
      { id: "a-enzo", user_id: MATAS, name: "Enzo Siragusa", spotify_id: null },
      { id: "a-gone", user_id: MATAS, name: "Dropped Act", spotify_id: null },
      { id: "a-copy", user_id: MATAS, name: "From Ad Copy", spotify_id: null },
    ],
    event_artists: [
      { id: "ea-1", event_id: EV, artist_id: "a-gone", source: "lab", billing_order: 1, is_headliner: true, created_at: "2026-11-01T10:00:00Z" },
      { id: "ea-2", event_id: EV, artist_id: "a-copy", source: "ad_copy", billing_order: 2, is_headliner: false, created_at: "2026-11-02T10:00:00Z" },
      { id: "ea-3", event_id: EV, artist_id: "a-enzo", source: "lab", billing_order: 3, is_headliner: false, created_at: "2026-11-03T10:00:00Z" },
    ],
    creative_lab_event_facts: [{ event_id: EV, user_id: MATAS, lineup: ["Dropped Act", "Enzo Siragusa"], headliners: ["Dropped Act"], allowed_dates: ["2027-02-01"] }],
  });
  const db = lab as unknown as ServiceRoleDb;
  const shows: McpShowsDeps = {
    ...showsSpy().shows,
    addSpotifyArtist: ({ userId, eventId, name, spotifyId }) =>
      addSpotifyToLineup(db, { userId, eventId, pick: { name, spotifyId, imageUrl: null, genres: [], instagramHandle: null, tiktokHandle: null, musicbrainzId: null, profileJson: {} } }),
    saveLineup: ({ userId, eventId, slots }) => saveLabLineup(db, { userId, eventId, slots }),
  };
  const { ctx } = ctxFor({ shows });
  const out = await setLineupTool.run(ctx, {
    event: "AS27-LDN",
    acts: [
      { name: "Ahmed Spins", role: "headliner" },
      { name: "Brand New", role: "support", spotify_id: SPOTIFY_NEW },
      { name: "Enzo Siragusa", role: "support" },
    ],
  });
  const rows = lab.tables.event_artists!.filter((r) => r.event_id === EV);
  const labRows = rows.filter((r) => r.source === "lab").sort((a, b) => Number(a.billing_order) - Number(b.billing_order));
  const newId = String(lab.tables.artists!.find((a) => a.spotify_id === SPOTIFY_NEW)!.id);
  assert.deepEqual(labRows.map((r) => [r.artist_id, r.billing_order, r.is_headliner]), [
    ["a-ahmed", 1, true],
    [newId, 2, false],
    ["a-enzo", 3, false],
  ]);
  assert.ok(!rows.some((r) => r.artist_id === "a-gone"), "the dropped lab act is gone, as in the Lab");
  assert.ok(rows.some((r) => r.artist_id === "a-copy" && r.source === "ad_copy"), "an act read in from ad copy stays");
  const facts = lab.tables.creative_lab_event_facts!.find((f) => f.event_id === EV)!;
  assert.deepEqual(facts.lineup, ["Ahmed Spins", "Brand New", "Enzo Siragusa"]);
  assert.deepEqual(facts.headliners, ["Ahmed Spins"]);
  assert.deepEqual(facts.allowed_dates, ["2027-02-01"], "the facts row's dates are kept");
  assert.equal((out.data as Row).message, "Done: AS27-LDN’s lineup is Ahmed Spins, Brand New, Enzo Siragusa. Headlining: Ahmed Spins. Added to the artist library: Brand New.");
});

test("set_lineup: a failed save is plain and says how to recover", async () => {
  const failing = showsSpy({ lineupThrows: true });
  const e = await refused(setLineupTool.run(ctxFor({ shows: failing.shows }).ctx, { event: "AS27-LDN", acts: [{ name: "Ahmed Spins", role: "headliner" }] }));
  assert.equal(e.message, SHOWS_WORDS.lineupFailed);
  assert.doesNotMatch(e.message, /db down/);
});

// ── the claims: never above the trigger ─────────────────────────────────────

test("claims: a count claim is the furthest count rung met, never one whose % isn't reached", () => {
  const at = (sold: number) => claimsView(releasesData([release({ id: "r1", name: "Tier 1", sold })]), NOW.toISOString()).claims.filter((c) => c.release === "Tier 1");
  // 55 % meets the 50 % rung ("75% sold"), not the 60 % one ("80% sold").
  const c55 = at(55);
  assert.equal(c55.length, 1);
  assert.deepEqual([c55[0]!.claim, c55[0]!.met], ["75% sold", true]);
  // 69 % still isn't the 70 % rung ("90% sold").
  assert.equal(at(69)[0]!.claim, "80% sold");
  // 90 % is the 90 % rung.
  assert.equal(at(90)[0]!.claim, "99% sold");
  // Under 50 % no % claim is met: it falls back to the release's live rung, which is met.
  const c40 = at(40)[0]!;
  assert.equal(c40.claim, "Tier 1 live");
  assert.ok(c40.met);
  for (const sold of [0, 10, 49]) assert.ok(!at(sold).some((c) => c.met && /% sold/.test(c.claim)), `${sold}: no % claim`);
});

test("claims: selling fast for 3 days doesn't reach the 14-day 90% rung; an unmet rung comes back marked not yet", () => {
  const sellingFast = release({ id: "r1", name: "Tier 1", state: "selling_fast", stateAt: "2026-11-23T10:00:00Z" });
  const view = claimsView(releasesData([sellingFast]), NOW.toISOString());
  const c = view.claims.find((x) => x.release === "Tier 1")!;
  assert.equal(c.claim, "Tier 1 selling fast");
  assert.ok(c.met);
  assert.ok(!view.claims.some((x) => x.met && /90% sold out/.test(x.claim)));
  // A release not yet on sale: its first rung, not met, with what it waits for.
  const notYet = claimsView(releasesData([release({ id: "r2", name: "Tier 2", state: "not_yet", listAt: "2026-12-01T10:00:00Z" })]), NOW.toISOString());
  const n = notYet.claims.find((x) => x.release === "Tier 2")!;
  assert.equal(n.met, false);
  assert.equal(n.kind, "later");
  assert.match(String(n.note), /^Not yet: .+\. Don’t use this claim until it’s met\.$/);
  assert.match(notYet.readAtLine, /^Read 26 Nov 03:00\.$/);
});

test("claims: a backfilled release (never confirmed) gives no claim, as on the card", () => {
  const view = claimsView(releasesData([release({ id: "r1", name: "Tier 1", sold: 95, stateSetBy: null })]), NOW.toISOString());
  assert.deepEqual(view.claims.filter((c) => c.release === "Tier 1"), []);
  assert.equal(view.releases[0]!.confirmed, false);
});

// ── get_releases / set_release ──────────────────────────────────────────────

test("get_releases reads the card and the claims, with when they were read; no releases says so", async () => {
  const { ctx, db, calls } = ctxFor();
  const out = (await getReleasesTool.run(ctx, { event: "AS27-LDN" })).data as Row;
  assert.deepEqual(calls.map((c) => c.fn), ["loadReleases"]);
  assert.deepEqual(calls[0]!.input, { eventId: EV, clientId: DHB });
  assert.equal(out.readAt, NOW.toISOString());
  assert.equal((out.releases as Row[])[0]!.stateLabel, "on sale");
  assert.deepEqual(db.writes, []);
  const none = showsSpy({ releases: [] });
  const empty = (await getReleasesTool.run(ctxFor({ shows: none.shows }).ctx, { event: "AS27-LDN" })).data as Row;
  assert.equal(empty.message, SHOWS_WORDS.releasesNone("AS27-LDN"));
});

test("set_release: the card's save, then the claims the ladder gives after it", async () => {
  const spy = showsSpy({ releases: [release({ id: "r1", name: "Tier 1", sold: 20 })] });
  const { ctx, db } = ctxFor({ shows: spy.shows });
  const out = (await setReleaseTool.run(ctx, { event: "AS27-LDN", release: "tier 1", count: 62 })).data as Row;
  assert.deepEqual(spy.calls.map((c) => c.fn), ["loadReleases", "postRelease", "loadReleases"]);
  assert.deepEqual(spy.calls[1]!.input, { userId: MATAS, eventId: EV, body: { releaseId: "r1", sold: 62, confirmed: false } });
  assert.equal(out.message, "Done: Tier 1: 62 sold. The claims are as the ladder gives them now.");
  const claim = (out.claims as Row[]).find((c) => c.release === "Tier 1")!;
  assert.deepEqual([claim.claim, claim.met], ["80% sold", true], "62 % meets 60 %, not 70 %");
  assert.deepEqual(db.writes, []);
});

test("set_release: a step back asks once (nothing is sent until confirmed), an unknown release names the show's releases", async () => {
  const spy = showsSpy({ releases: [release({ id: "r1", name: "Tier 1", state: "sold_out" })] });
  const e = await refused(setReleaseTool.run(ctxFor({ shows: spy.shows }).ctx, { event: "AS27-LDN", release: "Tier 1", state: "on_sale" }));
  assert.equal(e.message, SHOWS_WORDS.releaseBackwards("Tier 1", "sold out", "on sale"));
  assert.deepEqual(spy.calls.map((c) => c.fn), ["loadReleases"]);
  await setReleaseTool.run(ctxFor({ shows: spy.shows }).ctx, { event: "AS27-LDN", release: "Tier 1", state: "on_sale", confirmed: true });
  assert.equal((spy.calls.find((c) => c.fn === "postRelease")!.input as { body: Row }).body.confirmed, true);

  const unknown = await refused(setReleaseTool.run(ctxFor().ctx, { event: "AS27-LDN", release: "Tier 9", state: "on_sale" }));
  assert.equal(unknown.message, SHOWS_WORDS.releaseUnknown("Tier 9", "AS27-LDN", ["Tier 1"]));
  const empty = await refused(setReleaseTool.run(ctxFor().ctx, { event: "AS27-LDN", release: "Tier 1" }));
  assert.equal(empty.message, SHOWS_WORDS.releaseEmpty);
  const theirs = await refused(setReleaseTool.run(ctxFor().ctx, { event: "OT27-X", release: "Tier 1", state: "on_sale" }));
  assert.equal(theirs.message, EVENT_WORDS.refusedOtherAccount);
});

test("set_release: the route's own ask and a failed save come back plain", async () => {
  const ask = showsSpy({ postAsk: true });
  const e = await refused(setReleaseTool.run(ctxFor({ shows: ask.shows }).ctx, { event: "AS27-LDN", release: "Tier 1", state: "selling_fast" }));
  assert.equal((e.summary as Row).refused, "backwards");
  const bad = showsSpy({ postStatus: 500 });
  const f = await refused(setReleaseTool.run(ctxFor({ shows: bad.shows }).ctx, { event: "AS27-LDN", release: "Tier 1", state: "selling_fast" }));
  assert.equal(f.message, SHOWS_WORDS.releaseFailed);
});
