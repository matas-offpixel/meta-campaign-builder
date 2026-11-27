/**
 * Matas, 27 Nov: plan_retargeting and create_show_campaigns with creatives
 * (Drive files and pairs instead of copying the show's live ads) and identity
 * (the Page every ad runs from; the Electric group's city Page by default).
 * The Drive is the fixture drive, the Storage → Meta send and the funnel's
 * create are spies: nothing reaches Meta.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ToolInputError, type McpTool, type ToolContext } from "../tool-types.ts";
import { createShowCampaignsTool, planRetargetingTool } from "../tools/retargeting.ts";
import type { McpRetargetingDeps } from "../retargeting/types.ts";
import { planRetargeting, type RetargetingInput } from "../../retargeting/plan.ts";
import type { RetargetingRecord } from "../../retargeting/runner.ts";
import type { FunnelBuild, FunnelOutcome } from "../../retargeting/funnel-apply.ts";
import { ELECTRIC_IDENTITY, electricIdentityOf } from "../../retargeting/show-creatives.ts";
import type { StoredSendOutcome } from "../../plan/stored-assets-meta.ts";
import type { CampaignDraft } from "../../types.ts";
import type { DriveApi, DriveMediaFile } from "../../drive/client.ts";
import { D_DRAFT, EV_TGT } from "./draft-fixtures.ts";
import { driveCtx, SCOPE_ALL } from "./meta-fixtures.ts";
import { fakeDb } from "./fake-db.ts";

const CODE = "NX27-GLITTERBOX";
const YES = { asked: "Make NX27-GLITTERBOX · Wider and · Retargeting paused, with 2 ads from Drive run from NX Loves?", answer: "yes, paused" };
const NX_LOVES = { id: "259905047197071", name: "NX LOVES ", igId: "17841460869627228", igUsername: "nxloves" };
const OTHER_PAGE = { id: "1001", name: "NX Newcastle", igId: "ig1", igUsername: "nxnewcastle" };
const RUDIMENTAL_PAGE = "156873374377231";
/** The show's live ads as readAds reads them: three artist ads (one creative in two ad sets), one on the city Page, one another show's. */
const LIVE = {
  "120252046313640755": { name: "Motion - Text", accountId: "act_123", campaignId: "4001", campaignName: "[NX27-GLITTERBOX] On Sale – Lifetime", creativeId: "c1", pageId: RUDIMENTAL_PAGE, fromPost: false },
  "120252046313640756": { name: "Motion - Text", accountId: "act_123", campaignId: "4001", campaignName: "[NX27-GLITTERBOX] On Sale – Lifetime", creativeId: "c1", pageId: RUDIMENTAL_PAGE, fromPost: false },
  "120252046313720755": { name: "Static", accountId: "act_123", campaignId: "4001", campaignName: "[NX27-GLITTERBOX] On Sale – Lifetime", creativeId: "c2", pageId: RUDIMENTAL_PAGE, fromPost: true },
  "120252593411570755": { name: "Press shot", accountId: "act_123", campaignId: "4999", campaignName: "[NX27-GLITTERBOX] Lineup", creativeId: "c3", pageId: "259905047197071", fromPost: false },
  "120252593411579999": { name: "Old post", accountId: "act_123", campaignId: "4001", campaignName: "[NX27-GLITTERBOX] On Sale – Lifetime", creativeId: "c4", pageId: "1001", fromPost: true },
  "120299999999999999": { name: "Someone else's", accountId: "act_999", campaignId: "9001", campaignName: "[NX26-OTHER] Lineup", creativeId: "c9", pageId: RUDIMENTAL_PAGE, fromPost: false },
} as const;
const CREATIVES = { file_ids: ["file-lib-916"], pairs: [{ feed: "file-client-45", vertical: "file-client-916" }], headline: "Glitterbox Newcastle", cta: "book_now" as const };

function input(over: Partial<RetargetingInput> = {}): RetargetingInput {
  return {
    eventId: EV_TGT,
    eventCode: CODE,
    runDay: "2026-11-26",
    eventDate: "2026-12-12",
    onSaleDay: "2026-10-01",
    announceDay: "2026-09-29",
    read: { state: "platform_proposed", pixel: { id: "px1" }, pixelName: "NX Skiddle", platform: "Skiddle", domain: null } as never,
    last7SpendGbp: 420,
    minDailyMinor: null,
    sources: { pixelId: "px1", links: [{ kind: "ticket", rule: "skiddle.com/e/1", host: "skiddle.com", name: "Skiddle", platform: "skiddle" }], videos: [], pages: [{ id: "1001", name: "NX Newcastle", igId: "ig1", kind: "promoter", hasRole: true }, { id: RUDIMENTAL_PAGE, name: "Rudimental", igId: "17841401779330825", kind: "lineup", hasRole: true }], lists: [] },
    existing: null,
    legacy: [],
    budgetGbp: null,
    spendToDateGbp: 0,
    committedGbp: null,
    main: null,
    ads: [{ adId: "7001", name: "Glitterbox · announce" }],
    geoFromAdsetId: "5001",
    where: { draftId: D_DRAFT, adAccountId: "act_123", campaignIds: ["4001"] },
    prospecting: [{ id: "5001", kind: "adset", name: "Broad · Advantage+", dailyMinor: 3600, adSets: 1 }, { id: "5002", kind: "adset", name: "Interests", dailyMinor: 2400, adSets: 1 }],
    madeAudiences: [],
    ...over,
  };
}

function record(over: Partial<RetargetingInput> = {}): RetargetingRecord {
  const i = input(over);
  return { eventId: i.eventId, eventCode: i.eventCode, plan: planRetargeting(i), input: i, proposalId: null };
}

const media = (over: Partial<DriveMediaFile> & { id: string; name: string; mimeType: string }): DriveMediaFile =>
  ({ trashed: false, size: 2_000_000, width: 1080, height: 1920, rotation: 0, durationMs: 15_000, thumbnailLink: null, ...over }) as DriveMediaFile;

/** The fixture drive plus a 250 MB video in NX Live's own folder (over the upload limit). */
function withBigFile(drive: DriveApi): DriveApi {
  const big = media({ id: "file-client-big", name: "huge_9x16.mp4", mimeType: "video/mp4", parents: ["drv-client"], size: 250 * 1024 * 1024 });
  return {
    ...drive,
    async listMedia(parent) {
      const own = await drive.listMedia!(parent);
      return parent === "drv-client" ? [...own, big] : own;
    },
    async getMediaFile(id) {
      return id === big.id ? big : drive.getMediaFile!(id);
    },
  };
}

async function setup(opts: { code?: string; pages?: (typeof NX_LOVES)[]; build?: Record<string, unknown> | null; failSend?: boolean } = {}) {
  const made = await driveCtx();
  const ctx = made.ctx as ToolContext;
  const code = opts.code ?? CODE;
  if (code !== CODE) await made.db.from("events").update({ event_code: code }).eq("id", EV_TGT);
  const drive = withBigFile(ctx.draft!.drive()!);
  ctx.draft = { ...ctx.draft!, drive: () => drive };
  const calls = { create: [] as { build: FunnelBuild; mode: string }[], pages: [] as string[], sends: [] as CampaignDraft[], waited: [] as string[][], adReads: [] as string[][] };
  const records = [record({ eventCode: code })];
  const retargeting: McpRetargetingDeps = {
    async readAds({ adIds }) {
      calls.adReads.push([...adIds]);
      return Object.fromEntries(adIds.map((id) => [id, (LIVE as Record<string, (typeof LIVE)[keyof typeof LIVE]>)[id] ?? null]));
    },
    async campaignStatuses() {
      return {};
    },
    async read(args) {
      return { records: records.filter((r) => !args.codes || args.codes.includes(r.eventCode!)), metaGets: 1, skipped: [], unfinished: [], notRead: [] };
    },
    async create(args) {
      calls.create.push({ build: args.build, mode: args.mode });
      const progress = { campaignId: "120000000000001", audiences: {}, adSets: { cold: { id: "131", dailyMinor: 630 } }, ads: ["141"] };
      return { outcome: { state: "applied", reason: null, progress } as FunnelOutcome, adsManager: null };
    },
  };
  // Storage → Meta: every slot is on the ad account afterwards, each video with its id.
  const meta = {
    async sendAssets({ draft }: { userId: string; draft: CampaignDraft }): Promise<StoredSendOutcome> {
      calls.sends.push(draft);
      const assets = draft.creatives.flatMap((c) => c.assetVariations.flatMap((v) => v.assets));
      if (opts.failSend) return { draft, slots: [], results: [], uploaded: 0, calls: 1, failed: [{ assetId: assets[0]!.id, error: "Meta didn't take this file" } as never], changed: false };
      const stamp = (a: (typeof assets)[number]) => ({ ...a, uploadStatus: "uploaded" as const, videoId: `vid-${a.driveFileId}` });
      return {
        draft: { ...draft, creatives: draft.creatives.map((c) => ({ ...c, assetVariations: c.assetVariations.map((v) => ({ ...v, assets: v.assets.map(stamp) })) })) },
        slots: [],
        results: assets.map((a) => ({ assetId: a.id, uploadStatus: "uploaded", videoId: `vid-${a.driveFileId}` })) as never,
        uploaded: assets.length,
        calls: assets.length,
        failed: [],
        changed: true,
      };
    },
    async waitVideos({ videoIds }: { userId: string; videoIds: readonly string[] }) {
      calls.waited.push([...videoIds]);
      return { ready: [...videoIds], errored: [], timedOut: [] };
    },
    async launch() {
      throw new Error("not used");
    },
  };
  const audiences = { promotePages: async (_u: string, act: string) => (calls.pages.push(act), { pages: opts.pages ?? [NX_LOVES, OTHER_PAGE], metaGets: 1 }) };
  // The show's build row (migration 275) beside the draft fixtures' tables.
  const builds = fakeDb({ retargeting_builds: opts.build ? [{ event_id: EV_TGT, ...opts.build }] : [] });
  const base = made.db;
  const db = { from: (t: string) => (t === "retargeting_builds" ? builds.from(t) : base.from(t)), get writes() { return [...base.writes, ...builds.writes]; } };
  Object.assign(ctx, { db, scope: SCOPE_ALL, isMatas: true, retargeting, meta, audiences });
  base.writes.length = 0;
  return { ctx, calls, db, spies: made.spies, records };
}

async function refused(p: Promise<unknown>, re: RegExp): Promise<ToolInputError> {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof ToolInputError, String(e));
    assert.match(e.message, re);
    return e;
  }
  assert.fail("expected a refusal");
}

const run = (tool: McpTool, ctx: ToolContext, args: Record<string, unknown>) => tool.run(ctx, args);

// ── identity ──

test("identity default per prefix: NX → NX Loves, ES → Electric Studios, EBR → Electric Bristol; every other client has none", () => {
  assert.deepEqual(electricIdentityOf("NX26-RUDIMENTAL"), ELECTRIC_IDENTITY.NX);
  assert.equal(ELECTRIC_IDENTITY.NX.pageId, "259905047197071");
  assert.equal(ELECTRIC_IDENTITY.NX.igId, "17841460869627228");
  assert.deepEqual(electricIdentityOf("ES26-ANAME"), { name: "Electric Studios", pageId: "769954239540040", igId: null });
  assert.deepEqual(electricIdentityOf("EBR26-KREAM"), { name: "Electric Bristol", pageId: "1593045637629255", igId: null });
  for (const code of ["P26-BDAY", "DHB26-X", "LWE26-J2", "NXT-1"]) assert.equal(electricIdentityOf(code), null, code);
});

test("create_show_campaigns, an NX show with no identity: every ad runs from NX Loves, its Instagram as the ad account's Page list links it", async () => {
  const { ctx, calls } = await setup();
  const out = await run(createShowCampaignsTool, ctx, { event: CODE, mode: "paused", approval: YES });
  assert.deepEqual(calls.create[0]!.build.identity, { pageId: NX_LOVES.id, igId: NX_LOVES.igId, pageName: "NX LOVES", igUsername: "nxloves", source: "electric" });
  assert.deepEqual(calls.pages, ["act_123"]);
  // No creatives: the live ads are copied (the funnel rebuilds them on the Page), nothing goes to Meta first.
  assert.equal(calls.create[0]!.build.creatives, null);
  assert.deepEqual(calls.sends, []);
  assert.match(String((out.data as { message: string }).message), /\nAds: the show’s 1 live ad, copied into both campaigns, run from NX LOVES and Instagram nxloves \(the Electric group’s Page for Newcastle\)\.$/);
});

test("create_show_campaigns: an explicit identity overrides the Electric default", async () => {
  const { ctx, calls } = await setup();
  await run(createShowCampaignsTool, ctx, { event: CODE, mode: "paused", approval: YES, identity: { page_id: OTHER_PAGE.id } });
  assert.deepEqual(calls.create[0]!.build.identity, { pageId: "1001", igId: "ig1", pageName: "NX Newcastle", igUsername: "nxnewcastle", source: "given" });
  const withIg = await setup();
  await run(createShowCampaignsTool, withIg.ctx, { event: CODE, mode: "paused", approval: YES, identity: { page_id: OTHER_PAGE.id, ig_account_id: "17841499999999999" } });
  assert.equal(withIg.calls.create[0]!.build.identity!.igId, "17841499999999999");
});

test("refused, nothing made: a Page the ad account can't advertise from (the ES default, and a given one)", async () => {
  const es = await setup({ code: "ES26-GLITTERBOX" });
  await refused(run(createShowCampaignsTool, es.ctx, { event: "ES26-GLITTERBOX", mode: "paused", approval: YES }), /^Refused: ad account act_123 can’t advertise from Electric Studios\. Give a Page it can, or ask for access with request_page_access first\. Nothing was changed\.$/);
  assert.deepEqual([es.calls.create, es.calls.sends], [[], []]);
  const given = await setup();
  await refused(run(createShowCampaignsTool, given.ctx, { event: CODE, mode: "paused", approval: YES, identity: { page_id: "99999999" }, creatives: CREATIVES }), /^Refused: ad account act_123 can’t advertise from Page 99999999\..* Nothing was changed\.$/);
  assert.deepEqual([given.calls.create, given.calls.sends, given.spies.uploads], [[], [], []]);
});

// ── creatives ──

test("create_show_campaigns(creatives): the Drive ads replace the copies; the files go Drive → Storage → Meta after the yes, then the build", async () => {
  const { ctx, calls, spies } = await setup();
  const out = await run(createShowCampaignsTool, ctx, { event: CODE, mode: "paused", approval: YES, creatives: CREATIVES });
  const build = calls.create[0]!.build;
  assert.deepEqual(build.creatives!.ads.map((ad) => ad.key), ["file-lib-916", "file-client-45+file-client-916"]);
  // The pair is one per-placement ad (Dual: the feed file and its 9:16), the single a 9:16 ad; each slot is on Meta now.
  const [single, pair] = build.creatives!.ads.map((ad) => ad.creative);
  assert.equal(single!.assetMode, "single");
  assert.equal(pair!.assetMode, "dual");
  assert.deepEqual(pair!.assetVariations[0]!.assets.map((a) => [a.aspectRatio, a.uploadStatus, a.videoId]), [["4:5", "uploaded", "vid-file-client-45"], ["9:16", "uploaded", "vid-file-client-916"]]);
  assert.equal(single!.headline, "Glitterbox Newcastle");
  assert.equal(single!.cta, "book_now");
  // Sent once to the show's ad account, the videos waited for, both before the create.
  assert.equal(calls.sends.length, 1);
  assert.equal(calls.sends[0]!.settings.metaAdAccountId, "act_123");
  assert.deepEqual(calls.waited, [["vid-file-lib-916", "vid-file-client-45", "vid-file-client-916"]]);
  assert.equal(spies.uploads.length, 3, "three files copied into Storage");
  assert.deepEqual(build.creatives!.folders, ["00 Artist Library › Ada North", "NX Live (promoter)"]);
  assert.match(String((out.data as { message: string }).message), /\nAds: 2 new ads from Drive \(00 Artist Library › Ada North and NX Live \(promoter\)\), the same in both campaigns, run from NX LOVES and Instagram nxloves \(the Electric group’s Page for Newcastle\)\.$/);
  assert.equal((out.summary as { driveAds: number }).driveAds, 2);
});

test("refused, nothing made: a file that isn't 9:16 outside a pair, and a file over the upload limit", async () => {
  const notTall = await setup();
  await refused(run(createShowCampaignsTool, notTall.ctx, { event: CODE, mode: "paused", approval: YES, creatives: { file_ids: ["file-client-45"] } }), /^Refused: meta-date_4x5\.mp4 is 4:5\. A file on its own must be 9:16: pass it in a pair as the feed file with its 9:16, or leave it out\. Nothing was changed\.$/);
  assert.deepEqual([notTall.calls.create, notTall.calls.sends, notTall.spies.uploads], [[], [], []]);
  const big = await setup();
  await refused(run(createShowCampaignsTool, big.ctx, { event: CODE, mode: "paused", approval: YES, creatives: { file_ids: ["file-client-big"] } }), /^Refused: huge_9x16\.mp4: Over 200 MB — too large to upload here\. Nothing was changed\.$/);
  assert.deepEqual([big.calls.create, big.calls.sends, big.spies.uploads], [[], [], []]);
});

test("refused before any read: no files, over 20, a pair of one file; creatives on more than one show", async () => {
  const { ctx, calls } = await setup();
  await refused(run(createShowCampaignsTool, ctx, { event: CODE, mode: "paused", approval: YES, creatives: { file_ids: [] } }), /^Refused: creatives needs at least one file in file_ids or pairs\. Nothing was changed\.$/);
  const many = { file_ids: Array.from({ length: 12 }, (_, i) => `file-many-${i}`), pairs: Array.from({ length: 9 }, (_, i) => ({ feed: `feed-${i}x`, vertical: `vert-${i}x` })) };
  await refused(run(createShowCampaignsTool, ctx, { event: CODE, mode: "paused", approval: YES, creatives: many }), /^Refused: up to 20 ads from Drive at a time \(file_ids and pairs together\), and this asks for 21\. Nothing was changed\.$/);
  await refused(run(createShowCampaignsTool, ctx, { event: CODE, mode: "paused", approval: YES, creatives: { pairs: [{ feed: "file-client-916", vertical: "file-client-916" }] } }), /^Refused: a pair is two different files/);
  await refused(run(planRetargetingTool, ctx, { events: "live", creatives: CREATIVES }), /^Refused: creatives and identity are for one show at a time, so give one event code\. Nothing was changed\.$/);
  assert.deepEqual([calls.create, calls.sends, calls.pages], [[], [], []]);
});

test("a file Meta doesn't take stops it before any campaign is made", async () => {
  const { ctx, calls } = await setup({ failSend: true });
  await refused(run(createShowCampaignsTool, ctx, { event: CODE, mode: "paused", approval: YES, creatives: CREATIVES }), /^1 Drive file couldn’t be uploaded to Meta, so no campaign, ad set or ad was made\. Nothing was changed\.$/);
  assert.deepEqual(calls.create, []);
});

// ── asked again ──

test("asked again: the creatives and identity it was made with carry on (nothing re-sent); other ones are refused once ads exist", async () => {
  const first = await setup();
  await run(createShowCampaignsTool, first.ctx, { event: CODE, mode: "paused", approval: YES, creatives: CREATIVES });
  const stored = first.calls.create[0]!.build;
  const row = { build: stored, mode: "paused", state: "failed", progress: { campaignId: "1", ads: ["141"] }, meta_campaign_id: "1" };

  // The same creatives, or none given: the stored ads carry on and nothing goes to Drive or Meta again.
  for (const args of [{ creatives: CREATIVES }, {}]) {
    const again = await setup({ build: row });
    await run(createShowCampaignsTool, again.ctx, { event: CODE, mode: "paused", approval: YES, ...args });
    assert.deepEqual(again.calls.create[0]!.build.creatives, stored.creatives);
    assert.deepEqual(again.calls.create[0]!.build.identity, stored.identity);
    assert.deepEqual([again.calls.sends, again.spies.uploads], [[], []]);
  }

  // Other creatives once ads are made: refused, nothing changed.
  const other = await setup({ build: row });
  await refused(run(createShowCampaignsTool, other.ctx, { event: CODE, mode: "paused", approval: YES, creatives: { file_ids: ["file-lib-916"] } }), /^Refused: NX27-GLITTERBOX’s ads are already made from 2 Drive ads in 00 Artist Library › Ada North and NX Live \(promoter\), and create_show_campaigns doesn’t change ads that are made\. Nothing was changed\.$/);
  assert.deepEqual([other.calls.create, other.calls.sends], [[], []]);
  // Another Page once ads are made: refused too.
  const page = await setup({ build: row });
  await refused(run(createShowCampaignsTool, page.ctx, { event: CODE, mode: "paused", approval: YES, identity: { page_id: OTHER_PAGE.id } }), /^Refused: NX27-GLITTERBOX’s ads are already made to run from Page NX LOVES, and create_show_campaigns doesn’t change ads that are made\. Nothing was changed\.$/);
  // Copied ads made before creatives were given: Drive creatives are refused, not mixed in.
  const copied = await setup({ build: { ...row, build: { ...stored, creatives: null } } });
  await refused(run(createShowCampaignsTool, copied.ctx, { event: CODE, mode: "paused", approval: YES, creatives: CREATIVES }), /already made from the show’s live ads/);

  // No ad made yet: new creatives are taken (and sent).
  const early = await setup({ build: { ...row, progress: { campaignId: "1" } } });
  await run(createShowCampaignsTool, early.ctx, { event: CODE, mode: "paused", approval: YES, creatives: { file_ids: ["file-lib-916"] } });
  assert.deepEqual(early.calls.create[0]!.build.creatives!.ads.map((ad) => ad.key), ["file-lib-916"]);
  assert.equal(early.calls.sends.length, 1);
});

// ── plan_retargeting ──

test("plan_retargeting(one code, creatives): one line after the destination line, how many ads, from which folders, from which Page; nothing copied or sent", async () => {
  const { ctx, calls, spies, db } = await setup();
  const out = await run(planRetargetingTool, ctx, { events: CODE, creatives: CREATIVES, destination: { link: "https://glitterbox-newcastle.com/", url_tags: "utm_source=meta&utm_campaign={{campaign.name}}" } });
  const lines = String((out.data as { message: string }).message).split("\n");
  assert.equal(lines.at(-2), "Destination: https://glitterbox-newcastle.com/ · URL parameters utm_source=meta&utm_campaign={{campaign.name}}");
  assert.equal(lines.at(-1), "Ads: 2 new ads from Drive (00 Artist Library › Ada North and NX Live (promoter)), the same in both campaigns, run from NX LOVES and Instagram nxloves (the Electric group’s Page for Newcastle).");
  assert.deepEqual([calls.sends, spies.uploads, spies.copies, calls.create], [[], [], [], []]);
  assert.deepEqual(db.writes, []);
});

test("plan_retargeting refuses as create would: a file that isn't 9:16 on its own, a Page the account can't advertise from", async () => {
  const { ctx } = await setup();
  await refused(run(planRetargetingTool, ctx, { events: CODE, creatives: { file_ids: ["file-client-45"] } }), /is 4:5\. A file on its own must be 9:16.* Nothing was changed\.$/);
  const noPage = await setup({ pages: [OTHER_PAGE] });
  await refused(run(planRetargetingTool, noPage.ctx, { events: CODE }), /^Refused: ad account act_123 can’t advertise from NX LOVES\. /);
});

test("the ad account's Page list unread: plan_retargeting says so on the ads line; create_show_campaigns refuses, nothing made", async () => {
  const { ctx, calls } = await setup();
  (ctx as unknown as { audiences: unknown }).audiences = { promotePages: async () => { throw new Error("Meta is limiting calls"); } };
  const lines = String(((await run(planRetargetingTool, ctx, { events: CODE })).data as { message: string }).message).split("\n");
  assert.equal(lines.at(-1), "Not read in time, so not shown: the ad account’s Pages. Try again.");
  await refused(run(createShowCampaignsTool, ctx, { event: CODE, mode: "paused", approval: YES, creatives: CREATIVES }), /^Refused: ad account act_123’s Pages couldn’t be read, so the Page can’t be checked\. Try again\. Nothing was changed\.$/);
  assert.deepEqual([calls.create, calls.sends], [[], []]);
});


// ── #1410 addendum (Matas, 27 Nov): "also include the existing artist ads" ──

const ARTIST_ADS = ["120252046313640755", "120252046313640756", "120252046313720755", "120252593411570755"];

test("Drive ads and live ads in one build: one ad per creative, the artist ads kept on the lineup artist's Page, the line says it (PENDING DESIGN)", async () => {
  const { ctx, calls } = await setup();
  const out = await run(createShowCampaignsTool, ctx, { event: CODE, mode: "paused", approval: YES, creatives: CREATIVES, live_ad_ids: ARTIST_ADS });
  const build = calls.create[0]!.build;
  // The same creative in two ad sets is one ad.
  assert.deepEqual(build.copyAds!.map((ad) => ad.adId), ["120252046313640755", "120252046313720755", "120252593411570755"]);
  assert.equal(build.creatives!.ads.length, 2);
  assert.equal(String((out.data as { message: string }).message).split("\n")[1], "Ads: 2 new ads from Drive (00 Artist Library › Ada North and NX Live (promoter)) and 3 of the show’s live ads, 5 of 30, the same in both campaigns, run from NX LOVES and Instagram nxloves (the Electric group’s Page for Newcastle). Motion - Text and Static: kept on Rudimental’s Page.");
  assert.deepEqual((out.summary as { copiedAds: string[] }).copiedAds, build.copyAds!.map((ad) => ad.adId));
});

test("plan_retargeting with creatives and live_ad_ids: the same line, reads only", async () => {
  const { ctx, calls } = await setup();
  const lines = String(((await run(planRetargetingTool, ctx, { events: CODE, creatives: CREATIVES, live_ad_ids: ARTIST_ADS })).data as { message: string }).message).split("\n");
  assert.equal(lines.at(-1), "Ads: 2 new ads from Drive (00 Artist Library › Ada North and NX Live (promoter)) and 3 of the show’s live ads, 5 of 30, the same in both campaigns, run from NX LOVES and Instagram nxloves (the Electric group’s Page for Newcastle). Motion - Text and Static: kept on Rudimental’s Page.");
  assert.deepEqual([calls.sends, calls.create], [[], []]);
  assert.deepEqual(calls.adReads, [ARTIST_ADS]);
});

test("refused, nothing made: over 30 ads in a build; an ad that isn't the show's; a post-built ad that would have to move Page", async () => {
  const { ctx, calls } = await setup();
  const many = { file_ids: Array.from({ length: 20 }, (_, i) => `file-many-${i}x`) };
  const live = Array.from({ length: 11 }, (_, i) => `1202525934115${String(i).padStart(5, "0")}`);
  await refused(run(createShowCampaignsTool, ctx, { event: CODE, mode: "paused", approval: YES, creatives: many, live_ad_ids: live }), /^Refused: up to 30 ads in a build \(Drive and live ads together\), and this asks for 31\. Nothing was changed\.$/);
  await refused(run(createShowCampaignsTool, ctx, { event: CODE, mode: "paused", approval: YES, creatives: CREATIVES, live_ad_ids: ["120299999999999999"] }), /^Refused: ad 120299999999999999 isn’t one of NX27-GLITTERBOX’s ads on its ad account\. Give ids from get_live\. Nothing was changed\.$/);
  await refused(run(createShowCampaignsTool, ctx, { event: CODE, mode: "paused", approval: YES, creatives: CREATIVES, live_ad_ids: ["120252593411579999"] }), /^Old post runs from a post, so it can’t be moved to another Page; give creatives from Drive instead\. Nothing was changed\.$/);
  assert.deepEqual([calls.create, calls.sends], [[], []]);
});

test("a post-built artist ad keeps its Page, so it's fine without a destination and refused with one (its link is the post's)", async () => {
  const ok = await setup();
  await run(createShowCampaignsTool, ok.ctx, { event: CODE, mode: "paused", approval: YES, live_ad_ids: ["120252046313720755"] });
  assert.deepEqual(ok.calls.create[0]!.build.copyAds, [{ adId: "120252046313720755", name: "Static" }]);
  const dest = await setup();
  await refused(run(createShowCampaignsTool, dest.ctx, { event: CODE, mode: "paused", approval: YES, live_ad_ids: ["120252046313720755"], destination: { link: "https://glitterbox-newcastle.com/" } }), /^Static runs from a post, so its link is the post’s and can’t be changed\. Nothing was changed\.$/);
  assert.deepEqual(dest.calls.create, []);
});

test("asked again with other live ads once ads exist: refused; the same ones carry on", async () => {
  const first = await setup();
  await run(createShowCampaignsTool, first.ctx, { event: CODE, mode: "paused", approval: YES, creatives: CREATIVES, live_ad_ids: ARTIST_ADS });
  const row = { build: first.calls.create[0]!.build, mode: "paused", state: "failed", progress: { campaignId: "1", ads: ["141"] }, meta_campaign_id: "1" };
  const same = await setup({ build: row });
  await run(createShowCampaignsTool, same.ctx, { event: CODE, mode: "paused", approval: YES });
  assert.deepEqual(same.calls.create[0]!.build.copyAds, row.build.copyAds);
  assert.deepEqual(same.calls.sends, []);
  const other = await setup({ build: row });
  await refused(run(createShowCampaignsTool, other.ctx, { event: CODE, mode: "paused", approval: YES, live_ad_ids: ["120252593411570755"] }), /^Refused: NX27-GLITTERBOX’s ads are already made from 2 Drive ads in 00 Artist Library › Ada North and NX Live \(promoter\) and 3 live ads, and create_show_campaigns/);
});
