/**
 * M3a: launch from the connector (scope mcp:meta, Matas only, each call on
 * his chat yes). Meta is never called: the send step runs the real MML path
 * (sendStoredDraftAssets) with the upload handler spied, and the launch
 * route is a spy that records what it was asked for.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveMetaLaunchEntityStatus } from "../../meta/launch-status.ts";
import { buildAdSetPayload } from "../../meta/adset.ts";
import { buildAdPayload } from "../../meta/creative.ts";
import { buildCampaignPayload } from "../../meta/campaign.ts";
import { sendStoredDraftAssets } from "../../plan/stored-assets-meta.ts";
import type { DriveApi, DriveFile, DriveMediaFile } from "../../drive/client.ts";
import type { CampaignDraft } from "../../types.ts";
import { validateStep } from "../../validation.ts";
import { META_TOOLS } from "../tools/index.ts";
import { launchDraftTool, uploadDraftAssetsTool } from "../tools/meta-launch.ts";
import { updateEventTool } from "../tools/meta-event.ts";
import { setDraftNameTool } from "../tools/draft-edit.ts";
import { attachDriveCreativesTool, listDriveCreativesTool } from "../tools/draft-drive.ts";
import { APPROVAL_WORDS } from "../meta/approval.ts";
import { draftMoneyADay } from "../meta/ceiling.ts";
import { ToolInputError, type McpMetaDeps, type McpTool, type ToolContext } from "../tool-types.ts";
import { CLIENT_NX } from "./fixtures.ts";
import { OPERATOR } from "./helpers.ts";
import { D_DRAFT, EV_TGT, TGT_SIGNUP, UPDATED, draftCtx, fakeDrive, fakeDraftDeps, newSpies, readRow } from "./draft-fixtures.ts";

const SCOPE_ALL = "mcp:read mcp:draft mcp:meta";
const YES = { asked: "Launch [NX27-GLITTERBOX] SIGNUP to Meta paused? 2 ad sets, £50 a day once switched on.", answer: "yes, paused" };
const REG_A = "a0000000-0000-4000-8000-0000000000a1";
const REG_B = "a0000000-0000-4000-8000-0000000000a2";
const ACCOUNT = "act_606252931141334";

const LAUNCHED = {
  launchRunId: "run-1",
  metaCampaignId: "120200000000000001",
  adSetsCreated: [
    { name: "Broad", metaAdSetId: "120200000000000011", ageMode: "strict" },
    { name: "Fans", metaAdSetId: "120200000000000012", ageMode: "strict" },
  ],
  adSetsFailed: [],
  creativesCreated: [
    { name: "Teaser 1", metaCreativeId: "120200000000000021", ads: [{ adSetName: "Broad", metaAdId: "120200000000000031" }, { adSetName: "Fans", metaAdId: "120200000000000032" }], adsFailed: [] },
    { name: "Teaser 2", metaCreativeId: "120200000000000022", ads: [{ adSetName: "Broad", metaAdId: "120200000000000033" }, { adSetName: "Fans", metaAdId: "120200000000000034" }], adsFailed: [] },
  ],
  creativesFailed: [],
  adsCreated: 4,
  adsFailed: 0,
};

/** D_DRAFT made launchable: copy, link, one interest group, assignments, and each ad's 9:16 file in Storage (pending). */
async function makeLaunchable(db: ReturnType<typeof draftCtx>["db"], opts: { storage?: boolean } = {}) {
  const row = (await readRow(db, D_DRAFT))!;
  const d = structuredClone(row.draft_json) as CampaignDraft;
  d.audiences.interestGroups = [{ id: "ig-1", name: "Disco", interests: [{ id: "6003000000002", name: "Disco" }] } as never];
  d.adSetSuggestions = d.adSetSuggestions.map((s) => ({ ...s, sourceType: "interest_group", sourceId: "ig-1", sourceName: "Disco" })) as never;
  d.creativeAssignments = { "as-1": ["cr-1", "cr-2"], "as-2": ["cr-1", "cr-2"] };
  d.creatives = d.creatives.map((c, i) => {
    const slot = c.assetVariations[0]!.assets[0]!;
    return {
      ...c,
      captions: [{ id: `cap-${i}`, text: "Glitterbox returns to Newcastle" }],
      destinationUrl: TGT_SIGNUP,
      cta: "sign_up",
      mediaType: "video",
      assetVariations: [
        {
          ...c.assetVariations[0]!,
          name: "Variation 1",
          assets: [
            {
              ...slot,
              id: `slot-${i + 1}`,
              uploadStatus: "pending",
              ...(opts.storage === false ? {} : { storagePath: `videos/drive-send/${i + 1}.mp4`, storageBucket: "campaign-assets", registryAssetId: i === 0 ? REG_A : REG_B }),
            },
          ],
        },
      ],
    };
  });
  await db.from("campaign_drafts").update({ draft_json: d }).eq("id", D_DRAFT);
  await db.from("creative_assets").insert([
    { id: REG_A, user_id: OPERATOR, content_hash: "h-a", byte_size: 8_000_000, filename: "teaser-1_9x16.mp4", media_kind: "video", aspect_ratio: "9:16", storage_bucket: "campaign-assets", storage_path: "videos/drive/h-a.mp4" },
    { id: REG_B, user_id: OPERATOR, content_hash: "h-b", byte_size: 8_000_000, filename: "teaser-2_9x16.mp4", media_kind: "video", aspect_ratio: "9:16", storage_bucket: "campaign-assets", storage_path: "videos/drive/h-b.mp4" },
  ]);
  // The fixture's updated_at is unchanged by the fake's update: UPDATED still reads it.
  db.writes.length = 0;
}

interface MetaSpy {
  uploads: Array<Record<string, unknown>>;
  launches: Array<{ draft: CampaignDraft; createPaused: boolean }>;
  waited: string[][];
  failUpload: boolean;
  /** Videos Meta reports as video_status error. */
  erroredVideos: string[];
}

function metaDeps(db: ReturnType<typeof draftCtx>["db"], spy: MetaSpy): McpMetaDeps {
  return {
    sendAssets: ({ userId, draft }) =>
      sendStoredDraftAssets({
        supabase: db,
        draft,
        userId,
        storage: { copy: async () => ({ error: null }), remove: async () => undefined },
        upload: async (req) => {
          const body = (await req.json()) as Record<string, unknown>;
          spy.uploads.push(body);
          if (spy.failUpload) return Response.json({ error: "Meta didn't take this file" }, { status: 500 });
          const rows = (await db.from("creative_assets").select("*")).data as Array<Record<string, unknown>>;
          const reg = rows.find((r) => r.content_hash === body.contentHash)!;
          await db.from("creative_asset_channel_ids").insert({ asset_id: reg.id, channel: "meta", scope: body.adAccountId, platform_id: `vid-${String(body.contentHash)}`, user_id: OPERATOR });
          return Response.json({ videoId: `vid-${String(body.contentHash)}` });
        },
      }),
    async waitVideos({ videoIds }) {
      spy.waited.push([...videoIds]);
      const errored = videoIds.filter((id) => spy.erroredVideos.includes(id));
      return { ready: videoIds.filter((id) => !errored.includes(id)), errored, timedOut: [] };
    },
    async launch({ draft, createPaused }) {
      spy.launches.push({ draft, createPaused });
      return { status: 200, body: LAUNCHED };
    },
  };
}

async function metaCtx(opts: { storage?: boolean; ceiling?: number | null; scope?: string; isMatas?: boolean } = {}) {
  const made = draftCtx({ scope: opts.scope ?? SCOPE_ALL });
  const { ctx, db } = made;
  await makeLaunchable(db, { storage: opts.storage });
  if (opts.ceiling != null) await db.from("client_spend_ceilings").insert({ client_id: CLIENT_NX, daily_gbp: opts.ceiling, set_by: OPERATOR, set_at: "2026-11-25T10:00:00Z" });
  db.writes.length = 0;
  const spy: MetaSpy = { uploads: [], launches: [], waited: [], failUpload: false, erroredVideos: [] };
  (ctx as ToolContext).meta = metaDeps(db, spy);
  (ctx as ToolContext).isMatas = opts.isMatas ?? true;
  return { ...made, spy };
}

async function run(tool: McpTool, ctx: ToolContext, args: Record<string, unknown>) {
  return (await tool.run(ctx, args)) as { data: Record<string, unknown>; summary: Record<string, unknown> };
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

// ── The approval contract ───────────────────────────────────────────────────

test("no approval, an empty one or one over 1,000 characters: every meta tool refuses before anything runs", async () => {
  const { ctx, db, spy } = await metaCtx({ ceiling: 500 });
  const bad = [undefined, {}, { asked: "Launch it?", answer: "" }, { asked: "   ", answer: "yes" }, { asked: "x".repeat(1001), answer: "yes" }];
  const calls: Array<[McpTool, Record<string, unknown>]> = [
    [launchDraftTool, { draft_id: D_DRAFT, mode: "paused" }],
    [launchDraftTool, { draft_id: D_DRAFT, mode: "live" }],
    [uploadDraftAssetsTool, { draft_id: D_DRAFT }],
    [updateEventTool, { event_code: "NX27-GLITTERBOX", changes: { announcement_at: "2026-11-27T18:00:00Z" } }],
  ];
  for (const [tool, args] of calls) {
    for (const approval of bad) {
      const e = await refused(run(tool, ctx, { ...args, approval }), /^Refused: there’s no approval with this\. Ask Matas in chat, then send his exact question and answer with it\. Nothing was sent to Meta\.$/);
      assert.match(String(e.summary?.refused), /^(no_approval|approval_too_long)$/);
    }
  }
  assert.deepEqual(db.writes, [], "nothing written");
  assert.deepEqual([spy.uploads.length, spy.launches.length], [0, 0], "nothing sent");
  assert.ok(META_TOOLS.every((t) => t.kind === "meta" && "approval" in t.inputSchema));
});

test("a grant without mcp:meta, or a user no longer in MATAS_USER_IDS, is refused inside the tool too", async () => {
  for (const opts of [{ scope: "mcp:read mcp:draft" }, { isMatas: false }]) {
    const { ctx, spy } = await metaCtx(opts);
    await refused(run(launchDraftTool, ctx, { draft_id: D_DRAFT, mode: "paused", approval: YES }), new RegExp(APPROVAL_WORDS.notMeta.slice(0, 30)));
    assert.equal(spy.launches.length, 0);
  }
});

// ── launch_draft ────────────────────────────────────────────────────────────

test("launch_draft paused: the stored files go first (no drop), then the launch route with createPaused; no ceiling needed", async () => {
  const { ctx, db, spy } = await metaCtx({ ceiling: null });
  const out = await run(launchDraftTool, ctx, { draft_id: D_DRAFT, mode: "paused", approval: YES });
  // Two stored files, each sent once through the MML path.
  assert.deepEqual(spy.uploads.map((u) => [u.contentHash, u.adAccountId, u.type]), [["h-a", ACCOUNT, "video"], ["h-b", ACCOUNT, "video"]]);
  assert.equal(spy.launches.length, 1);
  assert.equal(spy.launches[0]!.createPaused, true);
  // The route got the stamped draft.
  const sentSlots = spy.launches[0]!.draft.creatives.map((c) => c.assetVariations[0]!.assets[0]!);
  assert.deepEqual(sentSlots.map((s) => [s.uploadStatus, s.videoId]), [["uploaded", "vid-h-a"], ["uploaded", "vid-h-b"]]);
  // The stamps were saved on the draft before the launch.
  const json = (await readRow(db, D_DRAFT))!.draft_json as CampaignDraft;
  assert.deepEqual(json.creatives.map((c) => c.assetVariations[0]!.assets[0]!.videoId), ["vid-h-a", "vid-h-b"]);
  // Ids back, and the Ads Manager link.
  assert.equal(out.data.status, "PAUSED");
  assert.deepEqual(out.data.campaign, { id: "120200000000000001", name: "[NX27-GLITTERBOX] SIGNUP" });
  assert.deepEqual((out.data.adSets as Array<{ id: string }>).map((a) => a.id), ["120200000000000011", "120200000000000012"]);
  assert.equal((out.data.ads as unknown[]).length, 4);
  assert.equal(out.data.adsManager, "https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=606252931141334&selected_campaign_ids=120200000000000001");
  assert.equal(out.summary.metaCampaignId, "120200000000000001");
  assert.equal(out.data.ceiling, undefined, "a paused launch reads no ceiling");
  // FC2: "Done: {result}." and, a paused campaign Claude made having an Undo (FC1), the undo note.
  assert.equal(out.data.message, "Done: 1 campaign launched · 120200000000000001. Matas can undo this on Today.");
  // FC4's second step: the sent videos waited for before the launch.
  assert.deepEqual(spy.waited, [["vid-h-a", "vid-h-b"]]);
});

test("paused creates PAUSED in each Graph create payload the route builds: campaign, ad set and ad", () => {
  const status = resolveMetaLaunchEntityStatus({ createPaused: true });
  assert.equal(status, "PAUSED");
  assert.equal(buildCampaignPayload({ name: "[NX27-GLITTERBOX] SIGNUP", objective: "registration", status }).status, "PAUSED");
  const adSet = buildAdSetPayload(
    { id: "as-1", name: "Broad", sourceType: "blank", sourceId: "", ageMin: 18, ageMax: 35, budgetPerDay: 20, enabled: true, advantagePlus: false } as never,
    "cam",
    { interestGroups: [], customAudienceGroups: [], pageGroups: [], savedAudiences: { audienceIds: [] }, selectedPagesLookalikeGroups: [] } as never,
    { startDate: "", endDate: "", adSets: [] } as never,
    "conversions",
    "registration",
    undefined,
    undefined,
    undefined,
    status,
  );
  assert.equal(adSet.status, "PAUSED");
  assert.equal(buildAdPayload("Teaser 1", "cre", "adset", status).status, "PAUSED");
  // And live is ACTIVE, the wizard's default.
  assert.equal(resolveMetaLaunchEntityStatus({ createPaused: false }), "ACTIVE");
});

test("launch_draft live: refused with no ceiling and over the ceiling (nothing sent); within it the route creates active", async () => {
  {
    const { ctx, db, spy } = await metaCtx({ ceiling: null });
    const e = await refused(run(launchDraftTool, ctx, { draft_id: D_DRAFT, mode: "live", approval: YES }), /^Refused: NX Live has no daily ceiling, so nothing that starts spend can run\. Matas sets one in Settings › Claude\. Nothing was sent to Meta\.$/);
    assert.equal(e.summary?.refused, "no_ceiling");
    assert.deepEqual([spy.uploads.length, spy.launches.length, db.writes.length], [0, 0, 0]);
  }
  {
    // £20 + £30 a day.
    const { ctx, spy } = await metaCtx({ ceiling: 40 });
    const e = await refused(run(launchDraftTool, ctx, { draft_id: D_DRAFT, mode: "live", approval: YES }), /^Refused: this would take NX Live to £50\.00 a day, over its £40\.00 daily ceiling\. Nothing was sent to Meta\.$/);
    assert.deepEqual([e.summary?.refused, e.summary?.moneyGbp, e.summary?.ceilingGbp], ["over_ceiling", 50, 40]);
    assert.deepEqual([spy.uploads.length, spy.launches.length], [0, 0]);
  }
  {
    const { ctx, spy } = await metaCtx({ ceiling: 50 });
    const out = await run(launchDraftTool, ctx, { draft_id: D_DRAFT, mode: "live", approval: YES });
    assert.equal(spy.launches[0]!.createPaused, false);
    assert.deepEqual([out.data.status, out.data.moneyADay, out.data.ceiling], ["ACTIVE", 50, 50]);
    // A live launch has no Undo (today.mcp.undo.live), so no undo note.
    assert.equal(out.data.message, "Done: 1 campaign launched · 120200000000000001.");
  }
});

test("the draft's money a day: daily ad sets summed, a campaign budget, a lifetime budget over its days", () => {
  const base = { budgetSchedule: { budgetLevel: "ad_set", budgetType: "daily", budgetAmount: 0, currency: "GBP", startDate: "2026-12-01T10:00", endDate: "2026-12-11T10:00" }, adSetSuggestions: [{ enabled: true, budgetPerDay: 20 }, { enabled: true, budgetPerDay: 30 }, { enabled: false, budgetPerDay: 99 }] } as never as CampaignDraft;
  assert.equal(draftMoneyADay(base).gbp, 50);
  assert.equal(draftMoneyADay({ ...base, budgetSchedule: { ...base.budgetSchedule, budgetLevel: "campaign", budgetAmount: 75 } }).gbp, 75);
  assert.equal(draftMoneyADay({ ...base, budgetSchedule: { ...base.budgetSchedule, budgetLevel: "campaign", budgetType: "lifetime", budgetAmount: 500 } }).gbp, 50);
  assert.equal(
    draftMoneyADay({ ...base, budgetSchedule: { ...base.budgetSchedule, budgetType: "lifetime" }, adSetSuggestions: [{ enabled: true, budgetLifetime: 200 }, { enabled: true, budgetLifetime: 100 }] } as never).gbp,
    30,
  );
});

test("a pending slot without a Storage copy still blocks: launch_draft refuses on the wizard's check and sends nothing", async () => {
  const { ctx, spy } = await metaCtx({ storage: false });
  const e = await refused(run(launchDraftTool, ctx, { draft_id: D_DRAFT, mode: "paused", approval: YES }), /^Refused: 2 launch checks to fix\. Nothing was sent to Meta\.$/);
  const checks = e.data?.launchChecks as { wizard: { blockers: string[] } };
  assert.deepEqual(checks.wizard.blockers, ['"Teaser 1" › "Variation 1" › 9:16: Asset not yet uploaded', '"Teaser 2" › "Variation 1" › 9:16: Asset not yet uploaded']);
  assert.deepEqual([spy.uploads.length, spy.launches.length], [0, 0]);
});

test("a failed upload stops the launch: nothing is created, and each slot is saved as \"Upload failed — retry or remove\"", async () => {
  const { ctx, db, spy } = await metaCtx();
  spy.failUpload = true;
  const e = await refused(run(launchDraftTool, ctx, { draft_id: D_DRAFT, mode: "paused", approval: YES }), /2 of 2 files didn't go to Meta, so nothing was launched/);
  assert.equal(e.summary?.refused, "upload_failed");
  assert.deepEqual(e.data?.failed, ['"Teaser 1" › "Variation 1" › 9:16: Meta didn\'t take this file', '"Teaser 2" › "Variation 1" › 9:16: Meta didn\'t take this file']);
  assert.equal(spy.launches.length, 0, "the launch route was never called");
  const json = (await readRow(db, D_DRAFT))!.draft_json as CampaignDraft;
  assert.ok(validateStep(7, json).errors.includes('"Teaser 1" › "Variation 1" › 9:16: Upload failed — retry or remove'));
  // upload_draft_assets retries the saved failures.
  spy.failUpload = false;
  const out = await run(uploadDraftAssetsTool, ctx, { draft_id: D_DRAFT, approval: YES });
  assert.deepEqual([out.data.files, out.data.sent], [2, 2]);
});

test("a video Meta reports as failed stops the launch like a failed upload: nothing created, the slot saved as \"Upload failed — retry or remove\"", async () => {
  const { ctx, db, spy } = await metaCtx();
  spy.erroredVideos = ["vid-h-b"];
  const e = await refused(run(launchDraftTool, ctx, { draft_id: D_DRAFT, mode: "paused", approval: YES }), /1 of 2 files didn't go to Meta, so nothing was launched/);
  assert.equal(spy.launches.length, 0);
  const json = (await readRow(db, D_DRAFT))!.draft_json as CampaignDraft;
  const slots = json.creatives.map((c) => c.assetVariations[0]!.assets[0]!);
  assert.deepEqual(slots.map((x) => x.uploadStatus), ["uploaded", "error"]);
  assert.ok(validateStep(7, json).errors.includes('"Teaser 2" › "Variation 1" › 9:16: Upload failed — retry or remove'));
  assert.equal(e.summary?.refused, "upload_failed");
});

test("a launch route refusal comes back as a refusal, with the files already sent kept", async () => {
  const { ctx, spy } = await metaCtx();
  (ctx as ToolContext).meta = { ...(ctx as ToolContext).meta!, launch: async () => ({ status: 400, body: { error: "Still points to Show: source-show in 2 ads.", source: "preflight" } }) };
  const e = await refused(run(launchDraftTool, ctx, { draft_id: D_DRAFT, mode: "paused", approval: YES }), /Meta didn't launch it: Still points to Show/);
  assert.equal(e.summary?.refused, "launch_failed");
  assert.equal(spy.uploads.length, 2);
});

test("a published draft can't be launched again from here", async () => {
  const { ctx, db } = await metaCtx();
  await db.from("campaign_drafts").update({ status: "published" }).eq("id", D_DRAFT);
  await refused(run(launchDraftTool, ctx, { draft_id: D_DRAFT, mode: "paused", approval: YES }), /This draft is published/);
});

// ── upload_draft_assets ─────────────────────────────────────────────────────

test("upload_draft_assets: the send step only (no launch, no ceiling), saved; a second call sends nothing", async () => {
  const { ctx, db, spy } = await metaCtx({ ceiling: null });
  const out = await run(uploadDraftAssetsTool, ctx, { draft_id: D_DRAFT, approval: YES });
  assert.deepEqual([out.data.files, out.data.sent, spy.launches.length], [2, 2, 0]);
  assert.equal(out.data.message, "Done: 2 files added · vid-h-a, vid-h-b.");
  const checks = out.data.launchChecks as { wizard: { blockers: string[]; sendAtLaunch?: number } };
  assert.equal(checks.wizard.sendAtLaunch, undefined, "nothing left to send");
  const again = await run(uploadDraftAssetsTool, ctx, { draft_id: D_DRAFT, approval: YES });
  assert.deepEqual([again.data.files, again.data.sent], [0, 0]);
  assert.equal(spy.uploads.length, 2);
  assert.deepEqual([...new Set(db.writes.map((w) => w.table))].sort(), ["campaign_drafts", "creative_asset_channel_ids"]);
});

test("two drafts sharing a file on one ad account: the file goes to Meta once", async () => {
  const { ctx, db, spy } = await metaCtx();
  const row = (await readRow(db, D_DRAFT))!;
  const copyId = "d0000000-0000-4000-8000-0000000000c1";
  await db.from("campaign_drafts").insert({ ...row, id: copyId, draft_json: { ...(row.draft_json as object), id: copyId } });
  await run(uploadDraftAssetsTool, ctx, { draft_id: D_DRAFT, approval: YES });
  const second = await run(uploadDraftAssetsTool, ctx, { draft_id: copyId, approval: YES });
  assert.equal(spy.uploads.length, 2, "two files, each sent once across both drafts");
  assert.deepEqual([second.data.sent, second.data.alreadyOnMeta], [0, 2]);
});

test("the launch checks in every answer follow the same rule: stored files are counted, not blockers", async () => {
  const { ctx } = await metaCtx();
  const out = await run(setDraftNameTool, ctx, { draft_id: D_DRAFT, updated_at: UPDATED, name: "[NX27-GLITTERBOX] ANNOUNCE" });
  const checks = out.data.launchChecks as { wizard: { blockers: string[]; sendAtLaunch?: number } };
  assert.deepEqual(checks.wizard.blockers, []);
  assert.equal(checks.wizard.sendAtLaunch, 2);
  // FC4: Review's line where the blocker was, in the wizard's warnings.
  assert.ok((checks.wizard as unknown as { warnings: string[] }).warnings.includes("2 files go to Meta when you launch."));
});

// ── set_draft_name ──────────────────────────────────────────────────────────

test("set_draft_name: the Campaign step's name and the name column, guarded on updated_at", async () => {
  const { ctx, db } = draftCtx();
  const out = await run(setDraftNameTool, ctx, { draft_id: D_DRAFT, updated_at: UPDATED, name: "  [NX27-GLITTERBOX]   ANNOUNCE " });
  assert.equal(out.data.name, "[NX27-GLITTERBOX] ANNOUNCE");
  const row = (await readRow(db, D_DRAFT))!;
  assert.equal(row.name, "[NX27-GLITTERBOX] ANNOUNCE");
  assert.equal((row.draft_json as CampaignDraft).settings.campaignName, "[NX27-GLITTERBOX] ANNOUNCE");
  await refused(run(setDraftNameTool, ctx, { draft_id: D_DRAFT, updated_at: UPDATED, name: "x" }), /changed since you read it/);
});

// ── update_event ────────────────────────────────────────────────────────────

test("update_event: only the fields given, times as the form saves them, links https; events only", async () => {
  const { ctx, db } = await metaCtx();
  const out = await run(updateEventTool, ctx, {
    event_code: "NX27-GLITTERBOX",
    changes: { announcement_at: "2026-11-27T18:00:00+00:00", ticket_url: null },
    approval: YES,
  });
  const ev = (await db.from("events").select("*").eq("id", EV_TGT).maybeSingle()).data as Record<string, unknown>;
  assert.equal(ev.announcement_at, "2026-11-27T18:00:00.000Z");
  assert.equal(ev.ticket_url, null);
  assert.equal(ev.presale_at, "2027-01-15T10:00:00Z", "a field not given is left as it was");
  assert.deepEqual((out.data.changed as Array<{ field: string }>).map((c) => c.field), ["announcement_at", "ticket_url"]);
  assert.deepEqual([...new Set(db.writes.map((w) => w.table))], ["events"]);
  assert.equal(out.data.message, `Done: 1 event changed · ${EV_TGT}.`);
  await refused(run(updateEventTool, ctx, { event_code: "NX27-GLITTERBOX", changes: { presale_at: "2027-01-15 10:00" }, approval: YES }), /a time with its zone/);
  await refused(run(updateEventTool, ctx, { event_code: "NX27-GLITTERBOX", changes: { signup_url: "http://crqln.com/l/x" }, approval: YES }), /must start with https/);
  await refused(run(updateEventTool, ctx, { event_code: "NX27-GLITTERBOX", changes: {}, approval: YES }), /Give at least one/);
});

// ── attach_drive_creatives: pairs, and folders anywhere in the shared drive ──

const FOLDER = "application/vnd.google-apps.folder";
const m = (over: Partial<DriveMediaFile> & { id: string; name: string; mimeType: string }): DriveMediaFile =>
  ({ trashed: false, size: 2_000_000, width: 1080, height: 1920, rotation: 0, durationMs: 15_000, thumbnailLink: null, ...over }) as DriveMediaFile;

/** The fixture drive plus a client folder inside the shared drive and a folder in another drive. */
function widerDrive(spies: ReturnType<typeof newSpies>): DriveApi {
  const base = fakeDrive(spies);
  const folders: Record<string, DriveFile> = {
    "drv-client": { id: "drv-client", name: "NX Live (promoter)", mimeType: FOLDER, parents: ["drive-test"], trashed: false },
    "drv-foreign": { id: "drv-foreign", name: "Someone else's", mimeType: FOLDER, parents: ["other-drive"], trashed: false },
    "other-drive": { id: "other-drive", name: "Other", mimeType: FOLDER, parents: [], trashed: false },
  };
  const extra = [
    m({ id: "file-client-916", name: "meta-date_9x16.mp4", mimeType: "video/mp4", parents: ["drv-client"] }),
    m({ id: "file-client-45", name: "meta-date_4x5.mp4", mimeType: "video/mp4", parents: ["drv-client"], width: 1080, height: 1350 }),
    m({ id: "file-foreign", name: "x.mp4", mimeType: "video/mp4", parents: ["drv-foreign"] }),
  ];
  return {
    ...base,
    async getFile(id) {
      return folders[id] ?? (await base.getFile(id));
    },
    async listChildren(parent, opts) {
      if (parent === "drive-test") return [folders["drv-client"]!];
      return base.listChildren(parent, opts);
    },
    async listMedia(parent) {
      const own = extra.filter((f) => f.parents?.[0] === parent);
      return own.length ? own : base.listMedia!(parent);
    },
    async getMediaFile(id) {
      return extra.find((f) => f.id === id) ?? (await base.getMediaFile!(id));
    },
  };
}

function driveCtx() {
  const spies = newSpies();
  const made = draftCtx({}, spies);
  made.ctx.draft = fakeDraftDeps(spies, { drive: () => widerDrive(spies) });
  // The event tree's only folder sits in the shared drive too.
  return { ...made, spies };
}

test("pairs: a 4:5 feed file and its 9:16 make one ad with both slots, Dual, both waiting for launch", async () => {
  const { ctx, db, spies } = driveCtx();
  const out = await run(attachDriveCreativesTool, ctx, { draft_id: D_DRAFT, updated_at: UPDATED, pairs: [{ feed: "file-static-45", vertical: "file-static-916" }] });
  const added = out.data.added as Array<{ id: string; slots: string[]; fileIds: string[] }>;
  assert.equal(added.length, 1);
  assert.deepEqual(added[0]!.slots, ["4:5", "9:16"]);
  assert.deepEqual(added[0]!.fileIds, ["file-static-45", "file-static-916"]);
  assert.equal(spies.uploads.length, 2, "both files copied into Storage");
  const ad = ((await readRow(db, D_DRAFT))!.draft_json as CampaignDraft).creatives.find((c) => c.id === added[0]!.id)!;
  assert.equal(ad.assetMode, "dual");
  assert.equal(ad.assetVariations.length, 1);
  const slots = ad.assetVariations[0]!.assets;
  assert.deepEqual(slots.map((s) => [s.aspectRatio, s.uploadStatus, s.driveFileId, Boolean(s.storagePath && s.registryAssetId)]), [
    ["4:5", "pending", "file-static-45", true],
    ["9:16", "pending", "file-static-916", true],
  ]);
  // Neither slot is a launch blocker: both go to Meta at launch.
  assert.ok(!validateStep(7, (await readRow(db, D_DRAFT))!.draft_json as CampaignDraft).errors.some((e) => e.startsWith(`"${ad.name}"`) && /upload|requires/.test(e)));
});

test("pairs: a non-feed aspect, a non-9:16 vertical and a video with a static are refused; a 4:5 on its own is refused with its aspect", async () => {
  const { ctx, db } = driveCtx();
  await refused(run(attachDriveCreativesTool, ctx, { draft_id: D_DRAFT, updated_at: UPDATED, pairs: [{ feed: "file-static-916", vertical: "file-static-45" }] }), /poster\.jpg is 9:16\. A pair's feed file is 4:5 or 1:1/);
  await refused(run(attachDriveCreativesTool, ctx, { draft_id: D_DRAFT, updated_at: UPDATED, pairs: [{ feed: "file-static-45", vertical: "file-clip-916" }] }), /A pair is two videos or two statics/);
  await refused(run(attachDriveCreativesTool, ctx, { draft_id: D_DRAFT, updated_at: UPDATED, file_ids: ["file-static-45"] }), /poster-feed\.jpg is 4:5\. A file on its own must be 9:16/);
  assert.deepEqual(db.writes.filter((w) => w.table === "campaign_drafts"), []);
});

test("a folder elsewhere in the shared drive lists and attaches (a client's folder); a folder outside it is refused", async () => {
  const { ctx, db } = driveCtx();
  const list = await run(listDriveCreativesTool, ctx, { event_code: "NX27-GLITTERBOX", folder: "drv-client" });
  assert.equal(list.data.outsideTree, true);
  assert.deepEqual((list.data.files as Array<{ id: string; usable: boolean }>).map((f) => [f.id, f.usable]), [["file-client-916", true], ["file-client-45", false]]);
  const root = await run(listDriveCreativesTool, ctx, { event_code: "NX27-GLITTERBOX", folder: "root" });
  assert.deepEqual(root.data.folders, [{ id: "drv-client", name: "NX Live (promoter)" }]);

  const out = await run(attachDriveCreativesTool, ctx, { draft_id: D_DRAFT, updated_at: UPDATED, pairs: [{ feed: "file-client-45", vertical: "file-client-916" }] });
  const added = out.data.added as Array<{ name: string; slots: string[] }>;
  assert.deepEqual(added.map((a) => a.slots), [["4:5", "9:16"]]);
  assert.equal(out.summary.outsideTree, 1);
  const ad = ((await readRow(db, D_DRAFT))!.draft_json as CampaignDraft).creatives.at(-1)!;
  assert.equal(ad.assetVariations[0]!.assets[1]!.sourceLabel, "From Drive · NX Live (promoter)");

  await refused(run(listDriveCreativesTool, ctx, { event_code: "NX27-GLITTERBOX", folder: "drv-foreign" }), /isn't in the Off\/Pixel shared drive/);
  await refused(run(attachDriveCreativesTool, ctx, { draft_id: D_DRAFT, updated_at: out.data.updated_at, file_ids: ["file-foreign"] }), /isn't in the Off\/Pixel shared drive/);
});

test("an interest ad set's long id (its interest ids, past 120 characters) is accepted by set_draft_ad_sets' input", async () => {
  const { z } = await import("zod");
  const { setDraftAdSetsTool } = await import("../tools/draft-build.ts");
  const id = "as_ig_interests:1711794862401024,569202086550452,6002969794329,6003148839749,6003253526111,6003277780179,6816985058496,937077532996593";
  assert.ok(id.length > 120);
  const parsed = z.object(setDraftAdSetsTool.inputSchema).safeParse({ draft_id: D_DRAFT, updated_at: UPDATED, changes: [{ ad_set_id: id, enabled: false }] });
  assert.equal(parsed.success, true, parsed.success ? "" : parsed.error.message);
});
