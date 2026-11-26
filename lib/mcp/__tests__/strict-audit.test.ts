/**
 * strict_audit (M3d-d): live ad sets running strict while their drafts
 * asked for Advantage+ suggestions. Driven by the 25 Nov fallback list
 * (fixtures/advantage-fallback-ids-2026-11-25.tsv: draft, campaign and ad
 * set ids only — 94 rows, 93 ad sets, 49 drafts), a fake database and the
 * real lib/mcp/graph-reads.ts behind a GET-only fetch spy.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AD_SET_BATCH, readAdSetsById, type FetchLike } from "../graph-reads.ts";
import { strictAuditTool } from "../tools/strict-audit.ts";
import { READ_TOOLS } from "../tools/index.ts";
import { ToolInputError, type McpGraphReads } from "../tool-types.ts";
import { STRICT_WORDS } from "../audit/words.ts";
import { CLIENT_NX, CLIENT_OLD, EV_ARCH, EV_DOD, ctx, tables } from "./fixtures.ts";
import { fakeDb } from "./fake-db.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOKEN = "EAAtest-token-never-logged";
const V = "v21.0";

type Fix = { draftId: string; campaignId: string; adsetId: string };
const FIXTURE: Fix[] = readFileSync(join(HERE, "fixtures/advantage-fallback-ids-2026-11-25.tsv"), "utf8")
  .trim()
  .split("\n")
  .slice(1)
  .map((line) => {
    const [draftId, campaignId, adsetId] = line.split("\t");
    return { draftId: draftId!, campaignId: campaignId!, adsetId: adsetId! };
  });
const ADSETS = [...new Set(FIXTURE.map((f) => f.adsetId))];

/** What Meta says now, by the ad set's place in the list: 0 live strict, 1 paused strict, 2 live on Advantage+, 3 in process strict. */
function metaNow(adsetId: string) {
  const i = ADSETS.indexOf(adsetId);
  const kind = i % 4;
  return {
    id: adsetId,
    name: `Ad set ${i}`,
    campaign_id: FIXTURE.find((f) => f.adsetId === adsetId)!.campaignId,
    campaign: { name: `Campaign ${i}` },
    effective_status: kind === 1 ? "PAUSED" : kind === 3 ? "IN_PROCESS" : "ACTIVE",
    targeting: { age_min: 18, age_max: 45, targeting_automation: { advantage_audience: kind === 2 ? 1 : 0 } },
  };
}
const expectedHits = ADSETS.filter((_, i) => i % 4 === 0 || i % 4 === 3);

/** The last fixture draft's rows go on an archived client's event; one extra strict-asked row and one blank one. */
const ARCHIVED_DRAFT = FIXTURE[FIXTURE.length - 1]!.draftId;
const STRICT_ASKED = "120299999999000001";
const BLANK = "120299999999000002";

function world() {
  const t = tables() as Record<string, Array<Record<string, unknown>>>;
  const drafts = new Map<string, Record<string, unknown>>();
  const launched: Array<Record<string, unknown>> = [];
  let n = 0;
  const seen = new Set<string>();
  for (const f of FIXTURE) {
    if (seen.has(f.adsetId)) continue;
    seen.add(f.adsetId);
    const archived = f.draftId === ARCHIVED_DRAFT;
    const d = drafts.get(f.draftId) ?? {
      id: f.draftId,
      name: `Draft ${drafts.size}`,
      draft_json: { adSetSuggestions: [], audiences: { customAudienceGroups: [{ id: "g1", name: "Lineup", audienceIds: ["1", "2", "3"] }], interestGroups: [] } },
    };
    drafts.set(f.draftId, d);
    (d.draft_json as { adSetSuggestions: unknown[] }).adSetSuggestions.push({ id: `s-${f.adsetId}`, sourceType: "custom_group", sourceId: "g1", advantagePlus: true, ageMin: 18, ageMax: 45, enabled: true });
    launched.push({
      id: `l${++n}`,
      meta_adset_id: f.adsetId,
      meta_campaign_id: f.campaignId,
      ad_account_id: "act_1234567890",
      draft_id: f.draftId,
      event_id: archived ? EV_ARCH : EV_DOD,
      client_id: archived ? CLIENT_OLD : CLIENT_NX,
      channel: "meta",
      source_type: "custom_group",
      source_id: "g1",
      source_name: "Lineup",
      advantage_plus: true,
      age_min: 18,
      age_max: 45,
      suggestion_id: `s-${f.adsetId}`,
    });
  }
  const first = FIXTURE[0]!.draftId;
  (drafts.get(first)!.draft_json as { adSetSuggestions: unknown[] }).adSetSuggestions.push(
    { id: "s-strict", sourceType: "interest_group", sourceId: "i1", advantagePlus: false, ageMin: 25, ageMax: 40 },
    { id: "s-blank", sourceType: "blank", sourceId: "", advantagePlus: false, ageMin: 18, ageMax: 65 },
  );
  for (const [id, sug] of [[STRICT_ASKED, "s-strict"], [BLANK, "s-blank"]] as const) {
    launched.push({ id: `l${++n}`, meta_adset_id: id, meta_campaign_id: FIXTURE[0]!.campaignId, ad_account_id: "act_1234567890", draft_id: first, event_id: EV_DOD, client_id: CLIENT_NX, channel: "meta", source_type: null, source_id: null, source_name: null, advantage_plus: false, age_min: 18, age_max: 65, suggestion_id: sug });
  }
  // A TikTok row never counts.
  launched.push({ id: `l${++n}`, meta_adset_id: "1799999999999999", channel: "tiktok", draft_id: null, event_id: EV_DOD, client_id: CLIENT_NX, advantage_plus: true, source_type: "blank" });
  t.launched_ad_sets = launched;
  t.campaign_drafts = [...drafts.values()];
  return t;
}

const extraNow = (id: string) =>
  id === BLANK
    ? { id, name: "Broad", campaign_id: FIXTURE[0]!.campaignId, effective_status: "ACTIVE", targeting: { targeting_automation: { advantage_audience: 0 } } }
    : id === STRICT_ASKED
      ? { id, name: "Strict", campaign_id: FIXTURE[0]!.campaignId, effective_status: "ACTIVE", targeting: { targeting_automation: { advantage_audience: 0 } } }
      : null;

/** The real graph read behind a GET-only spy; records each batch. */
function spyReads(batches: string[][], opts: { failBatch?: number } = {}): McpGraphReads {
  const fetchImpl: FetchLike = async (raw, init) => {
    const url = new URL(raw);
    assert.equal(init.method, "GET");
    assert.equal(url.origin, "https://graph.facebook.com");
    assert.equal(url.pathname, `/${V}/`);
    assert.equal(url.searchParams.get("access_token"), TOKEN);
    assert.equal(url.searchParams.get("fields"), "effective_status,targeting,name,campaign_id,campaign{name}");
    const ids = url.searchParams.get("ids")!.split(",");
    batches.push(ids);
    if (opts.failBatch === batches.length) return { ok: false, status: 400, json: async () => ({ error: { message: `bad ${TOKEN}` } }) };
    const body: Record<string, unknown> = {};
    for (const id of ids) body[id] = extraNow(id) ?? metaNow(id);
    return { ok: true, status: 200, json: async () => body };
  };
  return { adSets: ({ ids }) => readAdSetsById(fetchImpl, V, TOKEN, ids) };
}

type Hit = { event: string | null; adSet: { id: string; name: string }; campaign: { id: string; name: string | null }; link: string; status: string; asked: Record<string, unknown>; line: string };
type Out = { count: number; checked: number; metaGets: number; notRead: number; message: string; adSets: Hit[] };

test("strict_audit is a read tool, listed with one example", () => {
  assert.equal(strictAuditTool.kind, "read");
  assert.ok(READ_TOOLS.includes(strictAuditTool));
  assert.equal((strictAuditTool.description.match(/Example: /g) ?? []).length, 1);
});

test("finds exactly the live strict ad sets whose drafts asked for Advantage+; skips paused, on-Advantage+, strict-asked, archived and TikTok rows", async () => {
  const batches: string[][] = [];
  const db = fakeDb(world());
  const out = await strictAuditTool.run(ctx({ db, reads: spyReads(batches) }), {});
  const data = out.data as Out;
  const archivedSets = new Set(FIXTURE.filter((f) => f.draftId === ARCHIVED_DRAFT).map((f) => f.adsetId));
  const want = [...expectedHits.filter((id) => !archivedSets.has(id)), BLANK].sort();
  assert.deepEqual(data.adSets.map((h) => h.adSet.id).sort(), want);
  assert.equal(data.count, want.length);
  assert.ok(!data.adSets.some((h) => h.adSet.id === STRICT_ASKED), "a draft that asked strict is not a finding");
  // Asked = the fixture's ad sets (archived out) plus the blank one.
  const asked = ADSETS.filter((id) => !archivedSets.has(id)).length + 1;
  assert.equal(data.checked, asked);
  // ≤ 50 ids a GET, counted.
  assert.ok(batches.every((b) => b.length <= AD_SET_BATCH));
  assert.equal(batches.length, Math.ceil(asked / AD_SET_BATCH));
  assert.equal(data.metaGets, batches.length);
  assert.equal(out.summary.metaGets, batches.length);
  // No writes at all.
  assert.deepEqual(db.writes, []);
  const hit = data.adSets.find((h) => h.adSet.id === expectedHits[0])!;
  assert.equal(hit.event, "NX26-DOD");
  assert.match(hit.link, /^https:\/\/adsmanager\.facebook\.com\/adsmanager\/manage\/adsets\?act=1234567890&selected_adset_ids=\d+$/);
  assert.equal(hit.asked.audiences, 3);
  assert.equal(hit.asked.ageMin, 18);
  assert.equal(hit.line, `${STRICT_WORDS.asked(3, 0, 18, 45)} ${STRICT_WORDS.metaNow}`);
  assert.ok(["ACTIVE", "IN_PROCESS"].includes(hit.status));
  assert.match(data.message, /^\d+ live ad sets run strict/);
  assert.ok(!JSON.stringify(out).includes(TOKEN), "the token never comes back");
});

test("a batch Meta refuses is counted as not read, never guessed, and its message never reaches Claude", async () => {
  const batches: string[][] = [];
  const out = await strictAuditTool.run(ctx({ db: fakeDb(world()), reads: spyReads(batches, { failBatch: 1 }) }), {});
  const data = out.data as Out;
  assert.equal(data.notRead, batches[0]!.length);
  assert.ok(data.adSets.every((h) => !batches[0]!.includes(h.adSet.id)));
  assert.ok(data.message.includes(STRICT_WORDS.notRead(batches[0]!.length)));
  assert.ok(!JSON.stringify(out).includes(TOKEN));
});

test("scoped to an event code or a client; unknown ones and both at once are refused", async () => {
  const batches: string[][] = [];
  const byEvent = (await strictAuditTool.run(ctx({ db: fakeDb(world()), reads: spyReads(batches) }), { event_code: "NX26-DOD" })).data as Out;
  const byClient = (await strictAuditTool.run(ctx({ db: fakeDb(world()), reads: spyReads([]) }), { client: "nx live" })).data as Out;
  assert.equal(byEvent.count, byClient.count);
  assert.ok(byEvent.count > 0);
  const refusal = async (args: Record<string, unknown>, re: RegExp) => {
    await assert.rejects(strictAuditTool.run(ctx({ db: fakeDb(world()), reads: spyReads([]) }), args), (e: unknown) => e instanceof ToolInputError && re.test(e.message));
  };
  await refusal({ event_code: "NX26-NOPE" }, /^No event with code NX26-NOPE\.$/);
  await refusal({ client: "Old Promoter" }, /^No client called Old Promoter\.$/);
  await refusal({ client: "NX Live", event_code: "NX26-DOD" }, /^Give a client or an event, not both\.$/);
});

test("nothing asked for Advantage+ → no Meta read; asked but no Meta reads wired → refused in plain words", async () => {
  const t = world();
  t.launched_ad_sets = t.launched_ad_sets!.map((r) => ({ ...r, advantage_plus: false, source_type: "custom_group", suggestion_id: null }));
  let called = 0;
  const none = await strictAuditTool.run(ctx({ db: fakeDb(t), reads: { adSets: async () => ((called += 1), { adSets: [], notRead: [], metaGets: 0 }) } }), {});
  assert.equal((none.data as Out).count, 0);
  assert.equal((none.data as Out).message, STRICT_WORDS.none);
  assert.equal(called, 0);
  await assert.rejects(strictAuditTool.run(ctx({ db: fakeDb(world()) }), {}), (e: unknown) => e instanceof ToolInputError && e.message === STRICT_WORDS.noMeta);
  await assert.rejects(
    strictAuditTool.run(ctx({ db: fakeDb(world()), reads: { adSets: async () => { throw new Error(`token ${TOKEN}`); } } }), {}),
    (e: unknown) => e instanceof ToolInputError && e.message === STRICT_WORDS.noMeta,
  );
});

test("design's corrected rows (26 Nov verdict), word for word", () => {
  assert.equal(STRICT_WORDS.metaNow, "Meta now: Advantage+ audience off, so these are hard limits.");
  assert.equal(STRICT_WORDS.unknownClient("Old Promoter"), "No client called Old Promoter.");
  assert.equal(
    STRICT_WORDS.asked(1, 1, 18, 45),
    "The draft asked for: Advantage+ on, 1 audience as a suggestion, 1 interest as a suggestion, ages 18–45 as a suggestion.",
  );
  assert.equal(
    STRICT_WORDS.asked(3, 3, 25, 54),
    "The draft asked for: Advantage+ on, 3 audiences as suggestions, 3 interests as suggestions, ages 25–54 as a suggestion.",
  );
  assert.equal(STRICT_WORDS.asked(0, 0, null, null), "The draft asked for: Advantage+ on.");
  // En dash, as in launch.adset.age_widened.
  assert.ok(STRICT_WORDS.asked(0, 0, 18, 65).includes("ages 18\u201365 as a suggestion"));
});

test("asked: singular for 1, plural for n — never \"1 audiences\" or \"1 interests\"", () => {
  assert.equal(STRICT_WORDS.asked(1, 0, null, null), "The draft asked for: Advantage+ on, 1 audience as a suggestion.");
  assert.equal(STRICT_WORDS.asked(3, 0, null, null), "The draft asked for: Advantage+ on, 3 audiences as suggestions.");
  assert.equal(STRICT_WORDS.asked(0, 1, null, null), "The draft asked for: Advantage+ on, 1 interest as a suggestion.");
  assert.equal(STRICT_WORDS.asked(0, 3, null, null), "The draft asked for: Advantage+ on, 3 interests as suggestions.");
  for (const [a, i] of [[1, 0], [0, 1], [1, 1], [1, 3], [3, 1]] as const) {
    const line = STRICT_WORDS.asked(a, i, 18, 45);
    assert.doesNotMatch(line, /\b1 audiences\b|\b1 interests\b/);
  }
});

test("an interest-only hit's line names no ages or audiences beyond design's meta_now sentence", () => {
  const line = `${STRICT_WORDS.asked(0, 2, null, null)} ${STRICT_WORDS.metaNow}`;
  assert.equal(line, "The draft asked for: Advantage+ on, 2 interests as suggestions. Meta now: Advantage+ audience off, so these are hard limits.");
  assert.doesNotMatch(line, /\bages?\b/);
  assert.doesNotMatch(line, /\baudiences\b/);
});

test("the fixture is ids only", () => {
  const raw = readFileSync(join(HERE, "fixtures/advantage-fallback-ids-2026-11-25.tsv"), "utf8").trim().split("\n");
  assert.equal(raw[0], "draft_id\tmeta_campaign_id\tmeta_adset_id");
  assert.equal(raw.length - 1, 94);
  for (const line of raw.slice(1)) assert.match(line, /^[0-9a-f-]{36}\t\d+\t\d+$/);
  assert.equal(ADSETS.length, 93);
  assert.equal(new Set(FIXTURE.map((f) => f.draftId)).size, 49);
});
