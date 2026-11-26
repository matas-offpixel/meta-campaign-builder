/**
 * M2 draft tools: each one's happy path, the refusals (published, archived,
 * someone else's, changed since read), launch checks after every write,
 * and no Meta call anywhere (a fetch spy plus the geoSearch spy).
 */
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DRAFT_TOOLS, MCP_TOOLS, READ_TOOLS } from "../tools/index.ts";
import { replicateToEventTool } from "../tools/draft-replicate.ts";
import { LINK_NOT_EVENT_WORDS, applyAudienceTemplateTool, archiveDraftTool, setDraftBudgetTool, setDraftLinkTool, setDraftLocationsTool } from "../tools/draft-edit.ts";
import { attachDriveCreativesTool, listDriveCreativesTool } from "../tools/draft-drive.ts";
import { runLaunchChecksTool } from "../tools/pending.ts";
import { DRAFT_REFUSALS, instantKey, keepUnmigratedFields, loadWritableDraft, sameInstant, saveDraft } from "../drafts/write.ts";
import { migrateDraft } from "../../autosave.ts";
import { ToolInputError, type McpTool, type ToolContext } from "../tool-types.ts";
import type { CampaignDraft } from "../../types.ts";
import { fakeDb } from "./fake-db.ts";
import {
  draftTables,
  D_ARCH,
  D_DRAFT,
  D_PUB,
  D_STAFF,
  EV_TGT,
  NX_IG,
  NX_PAGE,
  TGT_SIGNUP,
  TGT_TICKETS,
  UPDATED,
  draftCtx,
  readRow,
} from "./draft-fixtures.ts";
import { OPERATOR } from "./helpers.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

// ── No Meta call anywhere: any fetch during a tool run fails the test. ──────
let fetchCalls: string[] = [];
const realFetch = globalThis.fetch;
beforeEach(() => {
  fetchCalls = [];
  globalThis.fetch = (async (input: unknown) => {
    fetchCalls.push(String(input));
    throw new Error("network is off in tests");
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  assert.deepEqual(fetchCalls, [], "no fetch (no Meta, no Graph) from any draft tool");
});

async function run(tool: McpTool, ctx: ToolContext, args: Record<string, unknown>) {
  const out = await tool.run(ctx, args);
  return out as { data: Record<string, unknown>; summary: Record<string, unknown>; eventId?: string | null };
}

async function refused(p: Promise<unknown>, re: RegExp): Promise<ToolInputError> {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof ToolInputError, `expected a refusal, got ${String(e)}`);
    assert.match(e.message, re);
    return e;
  }
  assert.fail(`expected a refusal matching ${re}`);
}

const draftWrites = (db: { writes: Array<{ table: string; op: string }> }) => db.writes.filter((w) => w.table === "campaign_drafts");

test("fifty-nine tools: eleven read (M4a's get_render_package, M3d-d's strict_audit), twenty-eight draft (M2 + M2b + set_draft_name + M3d-a's five shows tools + M3d-b's four Lab tools + M3d-c's upload_to_event_folder), nineteen meta (M3a's three, M3b's eleven, M3c's five), one render (M4a); each says what it changes, one example each", async () => {
  assert.equal(MCP_TOOLS.length, 59);
  assert.deepEqual(DRAFT_TOOLS.map((t) => t.name).sort(), [
    "apply_audience_template",
    "archive_draft",
    "attach_drive_creatives",
    "create_client",
    "create_event",
    "duplicate_draft",
    "list_clips",
    "get_releases",
    "list_drive_creatives",
    "list_tracks",
    "remove_draft_creatives",
    "replicate_to_event",
    "set_draft_ad_names",
    "set_draft_ad_sets",
    "set_draft_audiences",
    "set_draft_budget",
    "set_draft_copy",
    "set_draft_identity",
    "set_draft_link",
    "set_draft_locations",
    "set_draft_name",
    "set_draft_objective",
    "set_draft_schedule",
    "set_clip_owner",
    "set_track_drop",
    "set_lineup",
    "set_release",
    "upload_to_event_folder",
  ].sort());
  for (const t of READ_TOOLS) assert.equal(t.kind, "read", t.name);
  for (const t of DRAFT_TOOLS) {
    assert.equal(t.kind, "draft", t.name);
    assert.equal(t.readOnly, t.name === "list_drive_creatives" || t.name === "get_releases" || t.name === "list_clips", `${t.name} readOnly`);
    assert.equal(typeof t.idempotent, "boolean", `${t.name} idempotent`);
    assert.equal((t.description.match(/Example: /g) ?? []).length, 1, t.name);
  }
});

test("updated_at keys compare to the microsecond across formats", () => {
  assert.ok(sameInstant("2026-11-24T08:00:00.123456+00:00", "2026-11-24T08:00:00.123456Z"));
  assert.ok(sameInstant("2026-11-24T09:00:00.1+01:00", "2026-11-24T08:00:00.100Z"));
  assert.ok(!sameInstant("2026-11-24T08:00:00.123456+00:00", "2026-11-24T08:00:00.123Z"));
  assert.equal(instantKey("yesterday"), null);
});

// ── replicate_to_event ──────────────────────────────────────────────────────

test("replicate_to_event: a published draft to an upcoming same-client event makes a new draft with RC2's change lines", async () => {
  const { ctx, db } = draftCtx();
  const out = await run(replicateToEventTool, ctx, { source_draft_id: D_PUB, target_event_code: "NX27-GLITTERBOX" });
  const id = String(out.data.draft_id);
  const row = await readRow(db, id);
  assert.ok(row);
  assert.equal(row.status, "draft");
  assert.equal(row.user_id, OPERATOR);
  assert.equal(row.event_id, EV_TGT);
  assert.equal(row.name, "[NX27-GLITTERBOX] SIGNUP");
  const json = row.draft_json as CampaignDraft;
  assert.equal(json.status, "draft");
  assert.ok(json.creatives.every((c) => c.destinationUrl.startsWith(TGT_SIGNUP)), "links follow the target's signup page");
  const texts = (out.data.changes as Array<{ text: string }>).map((c) => c.text);
  assert.ok(texts.includes("NX27-GLITTERBOX · NX Newcastle (was NX26-SRC)"), texts.join(" | "));
  assert.ok(texts.some((t) => t.startsWith("Link: crqln.com/l/glitterbox-newcastle · 2 ads")), texts.join(" | "));
  assert.equal((out.data.launchChecks as { ran: boolean }).ran, true);
  // The source is untouched.
  assert.equal((await readRow(db, D_PUB))!.status, "published");
  assert.deepEqual(draftWrites(db).map((w) => w.op), ["insert"]);
  assert.equal(out.summary.sourceDraftId, D_PUB);
  assert.equal(out.summary.targetCode, "NX27-GLITTERBOX");
});

/** The source's stored code and name, as a draft written for NX26-SRC can hold them. */
async function nameSource(db: ReturnType<typeof draftCtx>["db"], campaignCode: string, campaignName: string) {
  const row = (await readRow(db, D_PUB))!;
  const json = row.draft_json as CampaignDraft;
  await db.from("campaign_drafts").update({ name: campaignName, draft_json: { ...json, settings: { ...json.settings, campaignCode, campaignName } } }).eq("id", D_PUB).select("id");
}

for (const [label, stored] of [["a short stored code", "SRC"], ["the full stored code", "NX26-SRC"]] as const) {
  test(`replicate_to_event: the name's [CODE] becomes the target's with ${label} ("${stored}")`, async () => {
    const { ctx, db } = draftCtx();
    await nameSource(db, stored, "[NX26-SRC] SRC - On sale");
    const out = await run(replicateToEventTool, ctx, { source_draft_id: D_PUB, target_event_code: "NX27-GLITTERBOX" });
    const row = (await readRow(db, String(out.data.draft_id)))!;
    assert.equal(row.name, "[NX27-GLITTERBOX] SRC - On sale");
    const settings = (row.draft_json as CampaignDraft).settings;
    assert.equal(settings.campaignName, "[NX27-GLITTERBOX] SRC - On sale");
    assert.equal(settings.campaignCode, "NX27-GLITTERBOX");
    const texts = (out.data.changes as Array<{ text: string }>).map((c) => c.text);
    assert.ok(texts.includes("[NX27-GLITTERBOX] SRC - On sale (was [NX26-SRC] SRC - On sale)"), texts.join(" | "));
    // The source keeps its own name and code.
    const src = (await readRow(db, D_PUB))!.draft_json as CampaignDraft;
    assert.equal(src.settings.campaignCode, stored);
    assert.equal(src.settings.campaignName, "[NX26-SRC] SRC - On sale");
  });
}

test("replicate_to_event: a [CODE] that isn't the source event's is kept, as replaceEventCodePrefix keeps it", async () => {
  const { ctx, db } = draftCtx();
  await nameSource(db, "SRC", "[NX26-OTHER] SRC - On sale");
  const out = await run(replicateToEventTool, ctx, { source_draft_id: D_PUB, target_event_code: "NX27-GLITTERBOX" });
  const row = (await readRow(db, String(out.data.draft_id)))!;
  assert.equal(row.name, "[NX26-OTHER] SRC - On sale");
});

test("replicate_to_event: same client only (RC11), upcoming only, own drafts only", async () => {
  const { ctx, db } = draftCtx();
  const other = await refused(run(replicateToEventTool, ctx, { source_draft_id: D_PUB, target_event_code: "EBR27-LOCKLEAD" }), /same client's events only/);
  assert.equal(other.summary?.refused, "other_client");
  await refused(run(replicateToEventTool, ctx, { source_draft_id: D_PUB, target_event_code: "NX26-GONE" }), /isn't upcoming/);
  await refused(run(replicateToEventTool, ctx, { source_draft_id: D_STAFF, target_event_code: "NX27-GLITTERBOX" }), /another account/);
  assert.deepEqual(draftWrites(db), []);
});

// ── refusals shared by every write ──────────────────────────────────────────

const WRITE_CALLS: Array<[McpTool, Record<string, unknown>]> = [
  [setDraftLinkTool, { url: TGT_SIGNUP }],
  [setDraftLocationsTool, { add: [{ preset: "leeds" }] }],
  [setDraftBudgetTool, { type: "daily", amount_gbp: 10, start: "2026-12-01" }],
  [applyAudienceTemplateTool, { template: "Techno" }],
  [attachDriveCreativesTool, { file_ids: ["file-clip-916"] }],
  [archiveDraftTool, {}],
];

test("a published or archived draft is refused by every write, and nothing is written", async () => {
  for (const [tool, args] of WRITE_CALLS) {
    const { ctx, db, spies } = draftCtx();
    const pub = await refused(run(tool, ctx, { draft_id: D_PUB, updated_at: UPDATED, ...args }), /is published, so it can't be changed from here/);
    assert.equal(pub.summary?.refused, "not_draft", tool.name);
    await refused(run(tool, ctx, { draft_id: D_ARCH, updated_at: UPDATED, ...args }), /is archived, so it can't be changed/);
    await refused(run(tool, ctx, { draft_id: D_STAFF, updated_at: UPDATED, ...args }), /another account/);
    assert.deepEqual(draftWrites(db), [], tool.name);
    assert.deepEqual([spies.uploads, spies.copies, spies.geo], [[], [], []], tool.name);
  }
});

test("an updated_at that isn't the row's is refused: changed since you read it, no silent overwrite", async () => {
  for (const [tool, args] of WRITE_CALLS) {
    const { ctx, db } = draftCtx();
    const e = await refused(run(tool, ctx, { draft_id: D_DRAFT, updated_at: "2026-11-24T07:59:00Z", ...args }), /changed since you read it/);
    assert.equal(e.summary?.refused, "changed_since_read", tool.name);
    assert.deepEqual(draftWrites(db), [], tool.name);
  }
});

test("the guarded UPDATE: a write between read and save finds no row and is refused, the other write kept", async () => {
  const { ctx, db } = draftCtx();
  const loaded = await loadWritableDraft(ctx, D_DRAFT, UPDATED);
  // Someone saves in between (the wizard's autosave).
  await db.from("campaign_drafts").update({ updated_at: "2026-11-24T08:30:00.000Z", name: "theirs" }).eq("id", D_DRAFT);
  await refused(saveDraft(ctx, loaded, { ...loaded.draft, settings: { ...loaded.draft.settings, campaignName: "mine" } }), new RegExp(DRAFT_REFUSALS.changed.slice(0, 30)));
  assert.equal((await readRow(db, D_DRAFT))!.name, "theirs");
  // Published in between: the same miss reads as not a draft.
  const again = await loadWritableDraft(ctx, D_DRAFT, "2026-11-24T08:30:00.000Z");
  await db.from("campaign_drafts").update({ status: "published" }).eq("id", D_DRAFT);
  await refused(saveDraft(ctx, again, again.draft), /is published/);
});

// ── set_draft_link ──────────────────────────────────────────────────────────

test("set_draft_link: every ad by default, https only; the event's page or ticket link gives no warning", async () => {
  const { ctx, db } = draftCtx();
  const out = await run(setDraftLinkTool, ctx, { draft_id: D_DRAFT, updated_at: UPDATED, url: TGT_TICKETS });
  assert.equal(out.data.ads, 2);
  assert.deepEqual(out.data.warnings, []);
  const row = await readRow(db, D_DRAFT);
  assert.ok((row!.draft_json as CampaignDraft).creatives.every((c) => c.destinationUrl === TGT_TICKETS));
  assert.equal(row!.updated_at, String(out.data.updated_at));
  assert.equal((row!.draft_json as CampaignDraft).updatedAt, row!.updated_at);
  await refused(run(setDraftLinkTool, ctx, { draft_id: D_DRAFT, updated_at: out.data.updated_at, url: "http://example.com/x" }), /https/);
});

test("set_draft_link: one ad, a link that isn't the event's → link_not_event in RC3's words", async () => {
  const { ctx, db } = draftCtx();
  const out = await run(setDraftLinkTool, ctx, { draft_id: D_DRAFT, updated_at: UPDATED, url: "https://example.com/other?utm_source=x", ad_ids: ["cr-2"] });
  assert.deepEqual(out.data.warnings, [{ key: "link_not_event", sentence: "Link isn’t this event’s page: example.com/other in 1 ad. The event’s page is crqln.com/l/glitterbox-newcastle." }]);
  const json = (await readRow(db, D_DRAFT))!.draft_json as CampaignDraft;
  assert.equal(json.creatives.find((c) => c.id === "cr-1")!.destinationUrl, "https://crqln.com/l/source-show?utm_source=meta");
  await refused(run(setDraftLinkTool, ctx, { draft_id: D_DRAFT, updated_at: out.data.updated_at, url: TGT_SIGNUP, ad_ids: ["nope"] }), /aren't in this draft/);
});

test("link_not_event's words are the record's (words-rc-2026-11-24.tsv)", () => {
  const tsv = readFileSync(join(ROOT, "lib/replicate/__tests__/fixtures/words-rc-2026-11-24.tsv"), "utf8");
  const row = (key: string) => tsv.split("\n").map((l) => l.split("\t")).find((c) => c[0] === key)?.[2];
  assert.equal(LINK_NOT_EVENT_WORDS.many, row("link_not_event"));
  assert.equal(LINK_NOT_EVENT_WORDS.one, row("link_not_event.one"));
});

// ── set_draft_locations ─────────────────────────────────────────────────────

test("set_draft_locations: the Leeds preset, a pin, tiers; ad sets follow with add_to_every_ad_set", async () => {
  const { ctx, db, spies } = draftCtx();
  const out = await run(setDraftLocationsTool, ctx, {
    draft_id: D_DRAFT,
    updated_at: UPDATED,
    add: [{ preset: "leeds" }, { pin: { name: "Hexham", lat: 54.9714, lng: -2.1019, radius_km: 25 } }],
    tier: "primary",
    add_to_every_ad_set: true,
  });
  const added = out.data.added as Array<{ label: string; kind: string; tier: string; adSets: number }>;
  assert.deepEqual(added.map((a) => [a.label, a.kind, a.tier, a.adSets]), [
    ["Leeds (pin) · 80 km", "pin", "primary", 2],
    ["Hexham (pin) · 25 km", "pin", "primary", 2],
  ]);
  assert.equal(out.data.metaGets, 0, "a preset and a pin need no Meta search");
  assert.deepEqual(spies.geo, []);
  const json = (await readRow(db, D_DRAFT))!.draft_json as CampaignDraft;
  assert.equal(json.budgetSchedule.locationGroups!.length, 3);
  // Removing by name takes it off again.
  const back = await run(setDraftLocationsTool, ctx, { draft_id: D_DRAFT, updated_at: out.data.updated_at, remove: ["leeds", "Hexham (pin) · 25 km"] });
  assert.deepEqual(back.data.removed, ["Leeds (pin) · 80 km", "Hexham (pin) · 25 km"]);
  await refused(run(setDraftLocationsTool, ctx, { draft_id: D_DRAFT, updated_at: back.data.updated_at, remove: ["Atlantis"] }), /aren't on this draft/);
});

test("set_draft_locations: key 811209 is Leeds, Kent → LP4's warning and the pin fix; one GET counted", async () => {
  const { ctx, spies } = draftCtx();
  const out = await run(setDraftLocationsTool, ctx, { draft_id: D_DRAFT, updated_at: UPDATED, add: [{ search: "Leeds", city_key: "811209" }] });
  assert.deepEqual(out.data.warnings, [{ key: "region_mismatch", sentence: "Leeds, Kent: this is in Kent, not West Yorkshire.", fix: "Use the Leeds pin" }]);
  assert.equal(out.data.metaGets, 1);
  assert.deepEqual(spies.geo, ["Leeds"]);
  assert.deepEqual(out.summary.warnings, ["region_mismatch"]);
  // Typing "Leeds, Kent" asked for Kent: no line.
  const kent = await run(setDraftLocationsTool, draftCtx().ctx, { draft_id: D_DRAFT, updated_at: UPDATED, add: [{ search: "Leeds, Kent", city_key: "811209" }] });
  assert.deepEqual(kent.data.warnings, []);
});

test("set_draft_locations: two hits save nothing and list the keys; the chosen key is saved", async () => {
  const { ctx, db } = draftCtx();
  const e = await refused(run(setDraftLocationsTool, ctx, { draft_id: D_DRAFT, updated_at: UPDATED, add: [{ search: "Manchester" }] }), /didn't give one clear place/);
  assert.deepEqual((e.data?.choices as Array<{ hits: Array<{ city_key: string }> }>)[0]!.hits.map((h) => h.city_key), ["2513419", "2490299"]);
  assert.deepEqual(draftWrites(db), []);
  const out = await run(setDraftLocationsTool, ctx, { draft_id: D_DRAFT, updated_at: UPDATED, add: [{ search: "Manchester", city_key: "2513419", radius_km: 30 }] });
  assert.deepEqual((out.data.added as Array<{ label: string }>).map((a) => a.label), ["Manchester, England, United Kingdom (+30 km)"]);
  assert.ok(out.data.onNoAdSet, "untiered, not added to ad sets: says so");
});

// ── set_draft_budget ────────────────────────────────────────────────────────

test("set_draft_budget: lifetime over 14 days, split over the enabled ad sets, per-day equivalent", async () => {
  const { ctx, db } = draftCtx();
  const out = await run(setDraftBudgetTool, ctx, { draft_id: D_DRAFT, updated_at: UPDATED, type: "lifetime", amount_gbp: 300, start: "2026-12-01", end: "2026-12-14" });
  assert.equal(out.data.days, 14);
  assert.equal(out.data.perDayGbp, 21.43);
  assert.deepEqual(out.data.adSetsSplit, { adSets: 2, eachGbp: 150 });
  const json = (await readRow(db, D_DRAFT))!.draft_json as CampaignDraft;
  assert.equal(json.budgetSchedule.budgetType, "lifetime");
  assert.equal(json.budgetSchedule.startDate, "2026-12-01T00:00");
  assert.equal(json.budgetSchedule.endDate, "2026-12-14T23:59");
  assert.equal(json.budgetSchedule.startDateSource, "operator");
  assert.deepEqual(json.adSetSuggestions.map((a) => a.budgetLifetime), [150, 150]);
  // Daily keeps the current end when none is given.
  const daily = await run(setDraftBudgetTool, ctx, { draft_id: D_DRAFT, updated_at: out.data.updated_at, type: "daily", amount_gbp: 12, start: "2026-12-02T10:00" });
  assert.equal(daily.data.perDayGbp, 12);
  assert.equal(daily.data.end, "2026-12-14T23:59");
});

test("set_draft_budget: a start in the past and an end before the start are refused", async () => {
  const { ctx, db } = draftCtx();
  await refused(run(setDraftBudgetTool, ctx, { draft_id: D_DRAFT, updated_at: UPDATED, type: "daily", amount_gbp: 10, start: "2026-11-20" }), /in the past/);
  await refused(run(setDraftBudgetTool, ctx, { draft_id: D_DRAFT, updated_at: UPDATED, type: "lifetime", amount_gbp: 10, start: "2026-12-10", end: "2026-12-01" }), /before the start/);
  assert.deepEqual(draftWrites(db), []);
});

// ── apply_audience_template ─────────────────────────────────────────────────

// ── Drive ───────────────────────────────────────────────────────────────────

test("list_drive_creatives: a folder with kind, aspect, size and whether each can be an ad", async () => {
  const { ctx, db } = draftCtx();
  const out = await run(listDriveCreativesTool, ctx, { event_code: "NX27-GLITTERBOX", folder: "drv-videos" });
  const files = out.data.files as Array<{ id: string; kind: string; aspect: string; usable: boolean; size: string }>;
  assert.deepEqual(files.map((f) => [f.id, f.kind, f.aspect, f.usable]), [
    ["file-clip-916", "video", "9:16", true],
    ["file-static-916", "static", "9:16", true],
    ["file-static-45", "static", "4:5", false],
  ]);
  assert.equal(out.data.path, "Videos");
  assert.deepEqual(out.data.crumbs, [{ name: "Videos", folderId: "drv-videos" }]);
  assert.deepEqual(db.writes, [], "list writes nothing");
});

test("attach_drive_creatives: copies a 9:16 file into Storage and adds one ad, the client's page, no Meta upload", async () => {
  const { ctx, db, spies } = draftCtx();
  const out = await run(attachDriveCreativesTool, ctx, { draft_id: D_DRAFT, updated_at: UPDATED, file_ids: ["file-static-916"], headline: "Glitterbox Newcastle", cta: "book_now" });
  const added = out.data.added as Array<{ name: string; storagePath: string }>;
  assert.equal(added.length, 1);
  assert.equal(added[0]!.name, "Videos - Video 1");
  assert.match(added[0]!.storagePath, /^images\/drive-send\/.+\.jpg$/);
  assert.deepEqual(spies.uploads, ["images/drive/hash-file-static-916.jpg"]);
  assert.equal(spies.copies.length, 1);
  const json = (await readRow(db, D_DRAFT))!.draft_json as CampaignDraft;
  const ad = json.creatives[2]!;
  assert.deepEqual(ad.identity, { pageId: NX_PAGE, instagramAccountId: NX_IG });
  assert.equal(ad.destinationUrl, TGT_TICKETS);
  assert.equal(ad.cta, "book_now");
  const slot = ad.assetVariations[0]!.assets[0]!;
  assert.equal(slot.uploadStatus, "pending");
  assert.equal(slot.driveFileId, "file-static-916");
  assert.equal(slot.assetHash, undefined);
  assert.equal(slot.videoId, undefined);
  assert.equal(slot.sourceLabel, "From Drive · Videos");
  assert.deepEqual([...new Set(db.writes.map((w) => w.table))].sort(), ["campaign_drafts", "creative_assets"]);
  // The registry row the Drive picker's copy writes: this file, at the stable Storage path.
  const assets = (await db.from("creative_assets").select("*")).data as Array<Record<string, unknown>>;
  assert.equal(assets.length, 1);
  assert.deepEqual(
    [assets[0]!.drive_file_id, assets[0]!.storage_path, assets[0]!.storage_bucket, assets[0]!.media_kind, assets[0]!.aspect_ratio, assets[0]!.user_id],
    ["file-static-916", "images/drive/hash-file-static-916.jpg", "campaign-assets", "image", "9:16", OPERATOR],
  );
  assert.equal(slot.registryAssetId, assets[0]!.id);
  // The send copy is a Storage-side copy from that stable path.
  assert.equal(spies.copies[0]![0], "images/drive/hash-file-static-916.jpg");
  assert.equal(spies.copies[0]![1], slot.storagePath);
  // The same file again: skipped, nothing written.
  await refused(run(attachDriveCreativesTool, ctx, { draft_id: D_DRAFT, updated_at: out.data.updated_at, file_ids: ["file-static-916"] }), /already in this draft/);
});

test("attach_drive_creatives: a 4:5 file on its own is refused with its aspect; artist-voice copy is refused", async () => {
  const { ctx, db, spies } = draftCtx();
  await refused(run(attachDriveCreativesTool, ctx, { draft_id: D_DRAFT, updated_at: UPDATED, file_ids: ["file-static-45"] }), /poster-feed\.jpg is 4:5\. A file on its own must be 9:16/);
  await refused(
    run(attachDriveCreativesTool, ctx, { draft_id: D_DRAFT, updated_at: UPDATED, file_ids: ["file-clip-916"], primary_text: "Newcastle,  I can't wait to play for you again" }),
    /artist-voice caption/,
  );
  // A promoter-voice caption is fine.
  assert.deepEqual(draftWrites(db), []);
  assert.deepEqual(spies.uploads, []);
});

// ── archive_draft ───────────────────────────────────────────────────────────

test("archive_draft: status column only; the library's Unarchive brings it back unchanged; never deletes", async () => {
  const { ctx, db } = draftCtx();
  const before = structuredClone((await readRow(db, D_DRAFT))!.draft_json);
  const out = await run(archiveDraftTool, ctx, { draft_id: D_DRAFT, updated_at: UPDATED });
  const row = await readRow(db, D_DRAFT);
  assert.equal(row!.status, "archived");
  assert.deepEqual(row!.draft_json, before, "draft_json untouched");
  assert.ok(!db.writes.some((w) => w.op === "delete"));
  // Now read-only here.
  await refused(run(setDraftLinkTool, ctx, { draft_id: D_DRAFT, updated_at: out.data.updated_at, url: TGT_SIGNUP }), /is archived/);
  // The library's Unarchive (lib/db/drafts.ts updateCampaignStatus(id, "draft")): the status column only.
  await db.from("campaign_drafts").update({ status: "draft" }).eq("id", D_DRAFT);
  const back = await run(setDraftLinkTool, ctx, { draft_id: D_DRAFT, updated_at: out.data.updated_at, url: TGT_SIGNUP });
  assert.equal(back.data.ads, 2);
});

// ── scope inside the tool, launch checks ────────────────────────────────────

test("a read-only scope can't run a draft tool, even called directly", async () => {
  for (const tool of DRAFT_TOOLS) {
    const { ctx, db } = draftCtx({ scope: "mcp:read" });
    const e = await refused(run(tool, ctx, { draft_id: D_DRAFT, updated_at: UPDATED, source_draft_id: D_PUB, target_event_code: "NX27-GLITTERBOX", event_code: "NX27-GLITTERBOX", url: TGT_SIGNUP, file_ids: ["file-clip-916"], type: "daily", amount_gbp: 1, start: "2026-12-01", template: "x", add: [{ preset: "leeds" }] }), /can only read/);
    assert.equal(e.summary?.refused, "insufficient_scope", tool.name);
    assert.deepEqual(db.writes, [], tool.name);
  }
});

test("launch checks: runLaunchGuard's real result after every write, on the draft as saved, in the record's words", async () => {
  const calls: Array<[McpTool, Record<string, unknown>]> = [
    [setDraftLinkTool, { url: "https://example.com/other-show" }],
    [setDraftLocationsTool, { add: [{ preset: "leeds" }] }],
    [setDraftBudgetTool, { type: "daily", amount_gbp: 10, start: "2026-12-01" }],
    [attachDriveCreativesTool, { file_ids: ["file-clip-916"] }],
    [archiveDraftTool, {}],
  ];
  for (const [tool, args] of calls) {
    const { ctx } = draftCtx();
    const out = await run(tool, ctx, { draft_id: D_DRAFT, updated_at: UPDATED, ...args });
    const checks = out.data.launchChecks as { ran: boolean; blockers: number; warnings: number; checks: Array<{ key: string; sentence: string; label: string }> };
    assert.equal(checks.ran, true, tool.name);
    assert.equal(typeof checks.blockers, "number", tool.name);
    for (const c of checks.checks) assert.ok(c.label && c.sentence, `${tool.name}: ${c.key} has the record's words`);
    assert.deepEqual((out.summary.launchChecks as { blockers: number }).blockers, checks.blockers, tool.name);
  }
  // The link isn't the event's: the check says so after set_draft_link.
  const { ctx } = draftCtx();
  const linked = await run(setDraftLinkTool, ctx, { draft_id: D_DRAFT, updated_at: UPDATED, url: "https://example.com/other-show" });
  const keys = (linked.data.launchChecks as { checks: Array<{ key: string }> }).checks.map((c) => c.key);
  assert.ok(keys.includes("link_not_event"), keys.join(","));
  // run_launch_checks gives the same result for the saved draft.
  const read = await run(runLaunchChecksTool, ctx, { draft_id: D_DRAFT });
  assert.deepEqual(read.data.launchChecks, linked.data.launchChecks);
  const rep = await run(replicateToEventTool, ctx, { source_draft_id: D_PUB, target_event_code: "NX27-GLITTERBOX" });
  assert.equal((rep.data.launchChecks as { ran: boolean }).ran, true);
  // A check run that can't read is reported; the change stays saved.
  const b = draftCtx();
  const broken = { ...b.ctx, db: fakeDb(draftTablesForBroken()) } as ToolContext;
  const out = await run(setDraftLinkTool, broken, { draft_id: D_DRAFT, updated_at: UPDATED, url: TGT_SIGNUP });
  const failed = out.data.launchChecks as { ran: boolean; error: string; wizard: { blockers: string[] } };
  assert.deepEqual([failed.ran, failed.error], [false, "The launch checks couldn't run. The change is saved."]);
  // The wizard's step checks still come back on their own list.
  assert.ok(Array.isArray(failed.wizard.blockers));
});

function draftTablesForBroken() {
  const t = draftTables() as Record<string, unknown>;
  delete t.campaign_plan_meta_launch;
  return t as Record<string, Array<Record<string, unknown>>>;
}

test("no Meta call: the draft tools and their write path never import a Meta write or call Graph", () => {
  const files = [
    "lib/mcp/tools/draft-replicate.ts",
    "lib/mcp/tools/draft-edit.ts",
    "lib/mcp/tools/draft-drive.ts",
    "lib/mcp/drafts/write.ts",
    "lib/mcp/drafts/common.ts",
  ];
  for (const f of files) {
    const src = readFileSync(join(ROOT, f), "utf8");
    assert.doesNotMatch(src, /\b(fetch|graphPost|graphPostWithToken|graphDelete|graphGet)\s*\(/, f);
    assert.doesNotMatch(src, /graph\.facebook\.com|from\s+["'][^"']*\/(tiktok|google-ads|notify|d2c|actions)\//, f);
    assert.doesNotMatch(src, /from\s+["'][^"']*meta\/(upload|creative|campaign|adset|client|launch|audience-write)/, f);
  }
});

test("migrateDraft keeps the Drive picker's slot fields (storage path, Drive file id), so a reload loses neither", () => {
  const raw = {
    id: "x",
    creatives: [{ id: "c", assetVariations: [{ id: "v", assets: [{ id: "a", aspectRatio: "9:16", uploadStatus: "pending", fileName: "clip.mp4", storagePath: "videos/drive-send/1.mp4", storageBucket: "campaign-assets", driveFileId: "f1", sourceLabel: "From Drive · Videos" }] }] }],
  };
  const slot = migrateDraft(raw).creatives[0]!.assetVariations[0]!.assets[0]!;
  assert.deepEqual(
    [slot.fileName, slot.storagePath, slot.storageBucket, slot.driveFileId, slot.sourceLabel],
    ["clip.mp4", "videos/drive-send/1.mp4", "campaign-assets", "f1", "From Drive · Videos"],
  );
});

test("an MCP write keeps the stored fields migrateDraft leaves out; the edit wins where it says anything", async () => {
  assert.deepEqual(
    keepUnmigratedFields({ a: 1, list: [{ id: "x", keep: true, v: 1 }, { id: "gone" }], nested: { k: "old", extra: 1 } }, { list: [{ id: "x", v: 2 }], nested: { k: "new", drop: undefined } }),
    { a: 1, list: [{ id: "x", keep: true, v: 2 }], nested: { k: "new", extra: 1, drop: undefined } },
  );
  const { ctx, db } = draftCtx();
  const stored = (await readRow(db, D_DRAFT))!.draft_json as Record<string, unknown> & { creatives: Array<Record<string, unknown>> };
  stored.creatives[0]!.metaCreativeId = "kept-by-the-merge";
  stored.replicatedFrom = { sourceDraftId: D_PUB };
  await run(setDraftLinkTool, ctx, { draft_id: D_DRAFT, updated_at: UPDATED, url: TGT_SIGNUP });
  const after = (await readRow(db, D_DRAFT))!.draft_json as Record<string, unknown> & { creatives: Array<Record<string, unknown>> };
  assert.equal(after.creatives[0]!.metaCreativeId, "kept-by-the-merge");
  assert.deepEqual(after.replicatedFrom, { sourceDraftId: D_PUB });
  assert.equal(after.creatives[0]!.destinationUrl, TGT_SIGNUP);
});
