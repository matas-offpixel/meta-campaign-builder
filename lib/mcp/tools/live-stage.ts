/**
 * lib/mcp/tools/live-stage.ts — add_creatives_to_stage and
 * add_audience_to_stage (M3b, scope mcp:meta, Matas only).
 *
 * The campaign tree's two stage sheets, for Claude:
 *   - "Add creatives to…": bulk-attach with `tree` (McpLiveDeps.bulkAttach →
 *     bulkAttachAs; OFFPIXEL_META_TREE_ADD_WRITES_ENABLED; the ledger per
 *     campaign's published draft; the additions log). The ads are new ads
 *     made from draft creatives on the event's drafts, or from Drive files
 *     and pairs built as attach_drive_creatives builds them (buildDriveAds:
 *     the show's tree, the client's own folders or the artist library, never
 *     another client's; a render that failed a check is refused). Files held
 *     in Storage go to Meta first, as M3a's launch sends them. New ads go in
 *     PAUSED unless `live: true`, which starts spend and checks the show's
 *     spend ceiling against its committed spend (the ad sets' budgets count
 *     already while they're live; lib/mcp/meta/show-ceiling.ts).
 *   - "Add audience to…": the targeting write (McpLiveDeps.adsetAudience →
 *     adsetAudienceAs; OFFPIXEL_META_ADSET_TARGETING_WRITES_ENABLED): the
 *     whole targeting read, the audience added to custom_audiences, written
 *     back. On an Advantage+ ad set the audiences go in as suggestions and
 *     targeting_automation stays as it is: Advantage+ is never turned off.
 *
 * The ad sets: a live campaign's live ad sets in the stage (the sheet's
 * default ticks, RC6), or the ad_set_ids given (any status) within the stage.
 *
 * Relative imports only (node:test).
 */
import { z } from "zod";
import { canWrite, defaultSelection, stageAccount, stageLabel, stageSheetCampaigns, type TreeCampaign, type TreeStage } from "../../campaign-tree/tree.ts";
import { loadClientChannelDefaults } from "../../clients/channel-defaults.ts";
import { sentVideoIds } from "../../plan/stored-assets-meta.ts";
import type { AdCreativeDraft, CampaignDraft, CTAType } from "../../types.ts";
import { approvalInput, requireMetaApproval } from "../meta/approval.ts";
import { LAUNCH_WORDS, MCP_WORDS, RESULT_WORDS } from "../meta/words.ts";
import { loadTemplatesFor } from "../drafts/templates.ts";
import { callKey, checkLiveCeiling, errorReason, keyUuid, liveEvent, moneyADay, requireLive, round2, withBase, type LiveEvent } from "../live/resolve.ts";
import { undoOnToday } from "../meta/today-undo.ts";
import { advantageAudience } from "../live/strict.ts";
import { checkTargeting, type TargetingReadBack } from "../live/targeting-check.ts";
import { LIVE_THINGS, LIVE_WORDS, STAGE_ARG, countAdSets, countAds } from "../live/words.ts";
import { ToolInputError, type McpTool, type ToolContext } from "../tool-types.ts";
import { buildDriveAds, ownedEvent } from "./draft-drive.ts";

const BULK_ATTACH_CAP = 8;
const TOTAL_ADS_CAP = 200;
/** The targeting write's own cap per call (app/api/meta/adset-audience). */
const AUDIENCE_AD_SETS_PER_CALL = 12;

const ids = (v: unknown): string[] => [...new Set((Array.isArray(v) ? v : []).map((x) => String(x).trim()).filter(Boolean))];

/** The stage's campaigns the app can write to, and the ad sets the run reaches. */
export function stageSelection(event: LiveEvent, stage: TreeStage, adSetIds: string[]): { campaigns: TreeCampaign[]; selection: Record<string, string[]>; account: string | null } {
  const campaigns = stageSheetCampaigns(event.tree.view, stage).filter(canWrite);
  if (campaigns.length === 0) throw new ToolInputError(LIVE_WORDS.noStage(event.code, stageLabel(stage)), { refused: "no_stage", stage });
  const selection: Record<string, string[]> = {};
  if (adSetIds.length) {
    for (const c of campaigns) {
      const picked = c.adSets.filter((a) => adSetIds.includes(a.id)).map((a) => a.id);
      if (picked.length) selection[c.metaCampaignId] = picked;
    }
  } else {
    for (const [id, sets] of Object.entries(defaultSelection(campaigns))) if (sets.length) selection[id] = sets;
  }
  if (Object.keys(selection).length === 0) throw new ToolInputError(LIVE_WORDS.noAdSets(event.code, stageLabel(stage)), { refused: "no_ad_sets", stage });
  const chosen = campaigns.filter((c) => selection[c.metaCampaignId]);
  return { campaigns: chosen, selection, account: stageAccount(chosen) };
}

/**
 * Matas's 26 Nov plan, item 2: read back the ad sets a stage add reached and
 * report the ones that don't keep the rules (location expansion off;
 * retargeting strict). Nothing here writes: a stage add never makes an ad
 * set or changes the targeting of one. A read that fails leaves the write as
 * it is and reports nothing.
 */
async function readBack(ctx: ToolContext, live: NonNullable<ToolContext["live"]>, adSetIds: readonly string[], campaigns: readonly TreeCampaign[], selection: Record<string, string[]>): Promise<TargetingReadBack> {
  const ids = [...new Set(adSetIds)];
  const campaignNameOf = (id: string) => campaigns.find((c) => (selection[c.metaCampaignId] ?? []).includes(id))?.name ?? null;
  try {
    const read = await live.readObjects(ctx.userId, "adset", ids);
    return checkTargeting(ids.map((id) => read.objects.get(id)).filter((o): o is NonNullable<typeof o> => Boolean(o)), campaignNameOf);
  } catch {
    return { read: 0, locationOn: [], locationUnset: [], retargetingSuggestions: [], lines: [], unread: true };
  }
}

const checkSummary = (c: TargetingReadBack) => ({ read: c.read, locationOn: c.locationOn, locationUnset: c.locationUnset.length, retargetingSuggestions: c.retargetingSuggestions, ...(c.unread ? { unread: true } : {}) });

async function eventDrafts(ctx: ToolContext, eventId: string): Promise<CampaignDraft[]> {
  const res = await ctx.db.from("campaign_drafts").select("id, draft_json").eq("event_id", eventId).eq("user_id", ctx.userId);
  if (res.error) throw new ToolInputError(LIVE_WORDS.readFailed, { refused: "drafts_unreadable" });
  return ((res.data ?? []) as Array<{ id: string; draft_json: Record<string, unknown> | null }>).map((r) => ({ ...(ctx.readers.migrateDraft(r.draft_json ?? {}) as unknown as CampaignDraft), id: r.id }));
}

const CTAS: readonly CTAType[] = ["sign_up", "learn_more", "book_now", "buy_tickets"];

export const addCreativesToStageTool: McpTool = {
  name: "add_creatives_to_stage",
  title: "Add creatives to a stage's live campaigns",
  kind: "meta",
  readOnly: false,
  idempotent: true,
  failedText: LIVE_WORDS.addFailed,
  description: [
    "Adds new ads to an event's live campaigns in one stage (signup, presale, on_sale, show_week), as the campaign tree's Add creatives to… does: into each live campaign's live ad sets, or the ad_set_ids you give within the stage.",
    "The ads come from draft_creative_ids (ads already on one of the event's drafts, ids from get_draft), file_ids (9:16 Drive files) or pairs (a 4:5 or 1:1 feed file and its 9:16), from the show's folders, the client's own or the artist library. Files in Off/Pixel go to Meta first.",
    /* PENDING DESIGN: claude.mcp.tool.add_creatives.ceiling */ "New ads go in paused; live: true makes them live, which starts spend and is refused when the show's committed spend would pass its spend ceiling (and without one).",
    "Needs Matas's yes in this chat: ask him the stage, how many ads into how many ad sets, the files, and paused or live, then pass approval with your question (asked) and his reply word for word (answer).",
  ].join(" "),
  inputSchema: {
    event: z.string().min(2).max(40).describe("The event code."),
    stage: z.enum(STAGE_ARG).describe("signup, presale, on_sale or show_week."),
    draft_creative_ids: z.array(z.string().min(1).max(80)).max(20).optional().describe("Ad ids on the event's drafts (get_draft)."),
    file_ids: z.array(z.string().min(5).max(120)).max(20).optional().describe("9:16 Drive file ids, one ad each."),
    pairs: z.array(z.object({ feed: z.string().min(5).max(120), vertical: z.string().min(5).max(120) })).max(20).optional().describe("One ad per pair: the feed file and its 9:16."),
    ad_set_ids: z.array(z.string().min(5).max(32)).max(100).optional().describe("Only these ad sets (within the stage). Default: each live campaign's live ad sets."),
    live: z.boolean().optional().describe("true: the new ads are live. Default paused."),
    page_id: z.string().regex(/^\d{5,25}$/).optional().describe("For Drive files: the Facebook page. Default the client's."),
    ig_account_id: z.string().regex(/^\d{5,25}$/).optional(),
    primary_text: z.string().max(2200).optional().describe("For Drive files."),
    headline: z.string().max(255).optional().describe("For Drive files."),
    cta: z.enum(["sign_up", "learn_more", "book_now", "buy_tickets"]).optional().describe("For Drive files."),
    approval: approvalInput,
  },
  async run(ctx, args) {
    const { approval } = requireMetaApproval(ctx, args);
    const live = requireLive(ctx);
    const stage = String(args.stage) as TreeStage;
    const draftCreativeIds = ids(args.draft_creative_ids);
    const fileIds = ids(args.file_ids);
    const pairs = (Array.isArray(args.pairs) ? args.pairs : [])
      .map((p) => (p && typeof p === "object" ? { feed: String((p as Record<string, unknown>).feed ?? "").trim(), vertical: String((p as Record<string, unknown>).vertical ?? "").trim() } : null))
      .filter((p): p is { feed: string; vertical: string } => Boolean(p?.feed && p.vertical));
    if (!draftCreativeIds.length && !fileIds.length && !pairs.length) throw new ToolInputError(LIVE_WORDS.noCreatives, { refused: "no_creatives" });
    if (!live.switches().treeAdd) throw new ToolInputError(LIVE_WORDS.refusedSwitch, { refused: "switch_off" });
    if (!ctx.meta) throw new ToolInputError(LIVE_WORDS.notWired, { refused: "meta_unwired" });
    const goLive = args.live === true;

    const event = await liveEvent(ctx, live, args.event);
    const { campaigns, selection, account } = stageSelection(event, stage, ids(args.ad_set_ids));
    if (!account) throw new ToolInputError(LIVE_WORDS.noStage(event.code, stageLabel(stage)), { refused: "no_account" });
    const adSetCount = Object.values(selection).reduce((n, s) => n + s.length, 0);
    const adCount = (draftCreativeIds.length + fileIds.length + pairs.length) * adSetCount;
    if (campaigns.length > BULK_ATTACH_CAP || adCount > TOTAL_ADS_CAP) throw new ToolInputError(LIVE_WORDS.tooManyAds(adCount, campaigns.length), { refused: "over_caps", ads: adCount, campaigns: campaigns.length });
    const base = { code: event.code, stage, campaigns: campaigns.map((c) => c.metaCampaignId), adSets: adSetCount, adsPlanned: adCount, live: goLive, ledgerDraftId: campaigns[0]?.draftId ?? null };

    // Live ads start spend: the show's ceiling against its committed spend, before any file moves.
    // The ad sets' money a day is what the done message says ("up to £x a day").
    let ceiling: Awaited<ReturnType<typeof checkLiveCeiling>> | null = null;
    let moneyGbp = 0;
    if (goLive) {
      let money = 0;
      try {
        const sets = await live.readObjects(ctx.userId, "adset", Object.values(selection).flat());
        const camps = await live.readObjects(ctx.userId, "campaign", campaigns.map((c) => c.metaCampaignId));
        for (const c of campaigns) {
          const cbo = camps.objects.get(c.metaCampaignId);
          const cboMoney = cbo ? moneyADay(cbo, ctx.now) : null;
          if (cboMoney != null) money += cboMoney;
          else for (const id of selection[c.metaCampaignId]!) money += moneyADay(sets.objects.get(id) ?? { dailyBudgetMinor: null, lifetimeBudgetMinor: null, budgetRemainingMinor: null, endTime: null }, ctx.now) ?? 0;
        }
      } catch {
        throw new ToolInputError(LIVE_WORDS.readFailed, { ...base, refused: "meta_unread" });
      }
      moneyGbp = round2(money);
      ceiling = await withBase(base, () => checkLiveCeiling(ctx, live, { event, accountId: account, name: event.code, change: { starts: true } }));
    }

    // The ads.
    const drafts = await eventDrafts(ctx, event.id);
    const creatives: AdCreativeDraft[] = [];
    for (const id of draftCreativeIds) {
      const hit = drafts.flatMap((d) => d.creatives ?? []).find((c) => c.id === id);
      if (!hit) throw new ToolInputError(LIVE_WORDS.creativeUnknown(id, event.code), { ...base, refused: "creative_unknown", creativeId: id });
      creatives.push(structuredClone(hit));
    }
    const baseDraft = drafts.find((d) => d.id === campaigns[0]!.draftId) ?? drafts[0];
    if (fileIds.length || pairs.length) {
      if (!ctx.draft || !baseDraft) throw new ToolInputError(LIVE_WORDS.notWired, { ...base, refused: "drive_unwired" });
      const owned = await ownedEvent(ctx, event.id);
      const stored = owned.client_id ? await loadClientChannelDefaults(ctx.db, owned.client_id) : null;
      const pageId = (typeof args.page_id === "string" && args.page_id) || stored?.defaultPageId || baseDraft.creatives.at(-1)?.identity?.pageId || "";
      const igId = (typeof args.ig_account_id === "string" && args.ig_account_id) || stored?.defaultInstagramActorId || baseDraft.creatives.at(-1)?.identity?.instagramAccountId || "";
      if (!pageId) throw new ToolInputError("No page_id given and the client has no default page. Give page_id.", { ...base, refused: "no_page" });
      const cta = args.cta == null ? null : (String(args.cta) as CTAType);
      if (cta && !CTAS.includes(cta)) throw new ToolInputError(`cta is one of ${CTAS.join(", ")}.`, { refused: "bad_cta" });
      // A file already on a draft is still a new ad here: the live campaigns don't hold it.
      const built = await buildDriveAds(ctx, ctx.draft, {
        event: owned,
        draft: { ...baseDraft, creatives: [] },
        ref: { code: event.code },
        fileIds,
        pairs,
        pageId,
        igId,
        primaryText: typeof args.primary_text === "string" ? args.primary_text : null,
        headline: typeof args.headline === "string" ? args.headline : null,
        cta,
      });
      if (built.failed.length) throw new ToolInputError(LIVE_WORDS.addFailed, { ...base, refused: "copy_failed", failed: built.failed.length });
      creatives.push(...built.ads);
    }

    // Files held in Storage go to Meta, as M3a's launch sends them.
    const holder: CampaignDraft = { ...(baseDraft ?? ({} as CampaignDraft)), settings: { ...(baseDraft?.settings ?? ({} as CampaignDraft["settings"])), metaAdAccountId: account }, creatives };
    let sendable = creatives;
    try {
      const sent = await ctx.meta.sendAssets({ userId: ctx.userId, draft: holder });
      if (sent.failed.length) throw new ToolInputError(LIVE_WORDS.addFailed, { ...base, refused: "upload_failed", failed: sent.failed.length });
      sendable = sent.draft.creatives;
      const videos = sentVideoIds(sent);
      if (videos.length) {
        const waited = await ctx.meta.waitVideos({ userId: ctx.userId, videoIds: videos });
        if (waited.errored.length || waited.timedOut.length) throw new ToolInputError(LIVE_WORDS.addFailed, { ...base, refused: "video_not_ready", errored: waited.errored.length, timedOut: waited.timedOut.length });
      }
    } catch (e) {
      if (e instanceof ToolInputError) throw e;
      throw new ToolInputError(LIVE_WORDS.addFailed, { ...base, refused: "upload_threw", error: errorReason(e) });
    }

    const key = callKey("add_creatives_to_stage", args, approval);
    let res: { status: number; body: Record<string, unknown> };
    try {
      res = await live.bulkAttach({ userId: ctx.userId, body: { adAccountId: account, campaignAdSets: selection, newCreatives: sendable, tree: { eventId: event.id, stage, runId: keyUuid(key) }, createPaused: !goLive } });
    } catch (e) {
      throw new ToolInputError(LIVE_WORDS.addFailed, { ...base, refused: "attach_threw", error: errorReason(e) });
    }
    if (res.status === 403) throw new ToolInputError(LIVE_WORDS.refusedSwitch, { ...base, refused: "switch_off" });
    const results = (Array.isArray(res.body.campaigns) ? res.body.campaigns : []) as Array<{ campaignId: string; adIds?: string[]; adSetsAdded?: string[] }>;
    const adIds = results.flatMap((r) => r.adIds ?? []);
    const reached = new Set(results.flatMap((r) => r.adSetsAdded ?? []));
    const missed = Object.values(selection).flat().filter((id) => !reached.has(id));
    if (res.status >= 400 || adIds.length === 0) {
      throw new ToolInputError(LIVE_WORDS.addFailed, { ...base, refused: "attach_failed", status: res.status, code: typeof res.body.code === "string" ? res.body.code : null });
    }
    const result = RESULT_WORDS.added(LIVE_THINGS.ad, adIds);
    const partial = Number(res.body.totalAdsFailed ?? 0) > 0 || missed.length > 0;
    const check = await readBack(ctx, live, [...reached], campaigns, selection);
    return {
      data: {
        // FC2: paused ads Claude made have an Undo (delete), so "Matas can undo this on Today." follows Done.
        message: partial ? LIVE_WORDS.failed(result) : [MCP_WORDS.done(result), ...(!goLive && undoOnToday(ctx) ? [MCP_WORDS.undoNote] : [])].join("\n"),
        change: LIVE_WORDS.changeAddCreatives(stageLabel(stage), countAds(adIds.length), countAdSets(reached.size)),
        mode: goLive ? LAUNCH_WORDS.live(moneyGbp) : LAUNCH_WORDS.paused,
        ...(missed.length ? { notAdded: LIVE_WORDS.notAdded(countAdSets(missed.length), missed.join(", ")) } : {}),
        ...(check.lines.length ? { checks: check.lines } : {}),
      },
      eventId: event.id,
      clientId: event.clientId,
      summary: { ...base, key, adIds, adSetsReached: [...reached], missed, targetingCheck: checkSummary(check), ...(ceiling ? { ceiling, moneyGbp } : {}), ...(goLive ? {} : { undo: { tool: "delete_paused", adIds } }) },
    };
  },
};

export const addAudienceToStageTool: McpTool = {
  name: "add_audience_to_stage",
  title: "Add audiences to a stage's live ad sets",
  kind: "meta",
  readOnly: false,
  idempotent: true,
  failedText: LIVE_WORDS.metaFailed,
  description: [
    "Adds custom audiences to the ad sets of an event's live campaigns in one stage, as the campaign tree's Add audience to… does: into each live campaign's live ad sets, or the ad_set_ids you give within the stage. Give audience_ids (Meta ids Off/Pixel knows for this client) or template (an audience template's name: its audiences already made in this ad account).",
    "On an Advantage+ ad set the audiences go in as suggestions and Advantage+ stays on. Budgets don't change.",
    "Needs Matas's yes in this chat: ask him the stage, the audiences and how many ad sets, then pass approval with your question (asked) and his reply word for word (answer).",
  ].join(" "),
  inputSchema: {
    event: z.string().min(2).max(40).describe("The event code."),
    stage: z.enum(STAGE_ARG).describe("signup, presale, on_sale or show_week."),
    audience_ids: z.array(z.string().regex(/^\d{5,32}$/)).max(20).optional().describe("Meta custom audience ids."),
    template: z.string().min(1).max(200).optional().describe("An audience template's name."),
    ad_set_ids: z.array(z.string().min(5).max(32)).max(100).optional().describe("Only these ad sets (within the stage)."),
    approval: approvalInput,
  },
  async run(ctx, args) {
    const { approval } = requireMetaApproval(ctx, args);
    const live = requireLive(ctx);
    const stage = String(args.stage) as TreeStage;
    const audienceIds = ids(args.audience_ids);
    const template = typeof args.template === "string" && args.template.trim() ? args.template.trim() : null;
    if (!audienceIds.length && !template) throw new ToolInputError(LIVE_WORDS.noAudiences, { refused: "no_audiences" });
    if (!live.switches().targeting) throw new ToolInputError(LIVE_WORDS.refusedSwitch, { refused: "switch_off" });
    const event = await liveEvent(ctx, live, args.event);
    const { campaigns, selection, account } = stageSelection(event, stage, ids(args.ad_set_ids));
    const base = { code: event.code, stage, campaigns: campaigns.map((c) => c.metaCampaignId), adSets: Object.values(selection).flat().length };

    // The audiences: ids Off/Pixel knows for this client, or a confirmed template's reused ones.
    const wanted = [...audienceIds];
    if (template) {
      if (!event.clientId || !account) throw new ToolInputError(LIVE_WORDS.templateUnknown(event.clientName ?? event.code, template), { ...base, refused: "template_unknown" });
      const loaded = await loadTemplatesFor(ctx.db, { clientId: event.clientId, adAccount: account, pixelId: null });
      const t = loaded.templates.find((x) => x.name.trim().toLowerCase() === template.toLowerCase());
      if (!t) throw new ToolInputError(LIVE_WORDS.templateUnknown(event.clientName ?? event.code, template), { ...base, refused: "template_unknown" });
      if (!t.confirmedAt) throw new ToolInputError(LIVE_WORDS.templateUnconfirmed(t.name), { ...base, refused: "template_unconfirmed" });
      const resolved = loaded.resolve(t.name);
      const reused = (resolved?.items ?? []).flatMap((i) => i.reusedIds);
      if (!reused.length) throw new ToolInputError(LIVE_WORDS.templateEmpty(t.name), { ...base, refused: "template_empty" });
      for (const id of reused) if (!wanted.includes(id)) wanted.push(id);
    }
    const known = await ctx.db.from("meta_custom_audiences").select("meta_audience_id, name, client_id").in("meta_audience_id", wanted);
    const names = new Map<string, string>();
    for (const r of (known.error ? [] : (known.data ?? [])) as Array<{ meta_audience_id: string; name: string; client_id: string | null }>) {
      if (r.client_id === event.clientId) names.set(r.meta_audience_id, r.name);
    }
    for (const id of audienceIds) if (!names.has(id)) throw new ToolInputError(LIVE_WORDS.audienceUnknown(id), { ...base, refused: "audience_unknown", audienceId: id });

    const key = callKey("add_audience_to_stage", args, approval);
    const runId = keyUuid(key);
    const written = new Set<string>();
    const skipped: string[] = [];
    let failedCalls = 0;
    for (const audienceId of wanted) {
      const name = names.get(audienceId) ?? audienceId;
      const missed: string[] = [];
      for (const c of campaigns) {
        const sets = selection[c.metaCampaignId]!;
        for (let i = 0; i < sets.length; i += AUDIENCE_AD_SETS_PER_CALL) {
          const chunk = sets.slice(i, i + AUDIENCE_AD_SETS_PER_CALL);
          let res: { status: number; body: Record<string, unknown> };
          try {
            res = await live.adsetAudience({
              userId: ctx.userId,
              body: { draftId: c.draftId, audienceId, audienceName: name, direction: "include", action: "add", adSetIds: chunk, commit: true, addition: { eventId: event.id, stage, runId } },
            });
          } catch {
            failedCalls += 1;
            missed.push(...chunk);
            continue;
          }
          if (res.status === 403) throw new ToolInputError(LIVE_WORDS.refusedSwitch, { ...base, refused: "switch_off" });
          const results = (Array.isArray(res.body.results) ? res.body.results : []) as Array<{ adSetId: string; outcome: string }>;
          if (res.status >= 400) failedCalls += 1;
          for (const id of chunk) {
            const r = results.find((x) => x.adSetId === id);
            if (r && (r.outcome === "written" || r.outcome === "noop")) written.add(id);
            else missed.push(id);
          }
        }
      }
      if (missed.length) skipped.push(LIVE_WORDS.audienceSkipped(name, countAdSets(new Set(missed).size)));
    }
    if (written.size === 0) throw new ToolInputError(LIVE_WORDS.metaFailed, { ...base, refused: "none_written", failedCalls });

    // Advantage+ ad sets take them as suggestions (the write keeps targeting_automation). One read
    // back gives that and the plan's item-2 check (location expansion off, retargeting strict).
    let advantage = 0;
    let check: TargetingReadBack;
    try {
      const read = await live.readObjects(ctx.userId, "adset", [...written]);
      for (const o of read.objects.values()) if (advantageAudience(o.targeting) === 1) advantage += 1;
      const campaignNameOf = (id: string) => campaigns.find((c) => (selection[c.metaCampaignId] ?? []).includes(id))?.name ?? null;
      check = checkTargeting([...read.objects.values()], campaignNameOf);
    } catch {
      advantage = 0;
      check = { read: 0, locationOn: [], locationUnset: [], retargetingSuggestions: [], lines: [], unread: true };
    }
    const audienceNames = wanted.map((id) => names.get(id) ?? id).join(" · ");
    const result = RESULT_WORDS.changed(LIVE_THINGS.adset, [...written]);
    return {
      data: {
        message: skipped.length ? LIVE_WORDS.failed(result) : MCP_WORDS.done(result),
        change: LIVE_WORDS.changeAddAudiences(stageLabel(stage), audienceNames, countAdSets(written.size)),
        ...(advantage ? { note: LIVE_WORDS.suggestions } : {}),
        ...(skipped.length ? { notAdded: skipped } : {}),
        ...(check.lines.length ? { checks: check.lines } : {}),
      },
      eventId: event.id,
      clientId: event.clientId,
      summary: { ...base, key, audiences: wanted, audienceNames, written: [...written], advantageAdSets: advantage, skipped: skipped.length, failedCalls, targetingCheck: checkSummary(check) },
    };
  },
};
