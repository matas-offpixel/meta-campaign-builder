/**
 * lib/mcp/tools/live-read.ts — get_live (M3b, scope mcp:meta, Matas only;
 * read only, no approval).
 *
 * An event's live campaigns (its campaign tree), or one of them, read from
 * Meta: per campaign, ad set and ad its status and effective status, budget
 * (daily or lifetime, remaining, end), money a day now (a lifetime budget's
 * remaining ÷ days left in London), spend today and to date, results and
 * cost per result, the ad set's learning phase and a targeting summary
 * (Advantage+ on or off, custom audiences by name, the age control and any
 * age suggestion). An ad set that runs strict (advantage_audience 0) while
 * its draft asked for suggestions is flagged.
 *
 * GETs only (McpLiveDeps.read*), batched ≤ 50 ids, counted in the summary.
 *
 * Relative imports only (node:test).
 */
import { z } from "zod";
import { SCOPE_META } from "../config.ts";
import { scopeIncludes } from "../oauth/flow.ts";
import { APPROVAL_WORDS } from "../meta/approval.ts";
import { liveEvent, londonDaysLeft, moneyADay, requireLive, round2 } from "../live/resolve.ts";
import { advantageAudience, draftAdSetAsks, targetingSummary } from "../live/strict.ts";
import type { LiveInsight, LiveObject } from "../live/types.ts";
import { LIVE_THINGS, LIVE_WORDS } from "../live/words.ts";
import { EVENT_WORDS } from "../meta/words.ts";
import { stageLabel } from "../../campaign-tree/tree.ts";
import { ToolInputError, type McpTool, type ToolContext } from "../tool-types.ts";

/** The scope check for the read-only meta tools (no approval: nothing changes). */
export function requireMetaScope(ctx: ToolContext): void {
  if (!scopeIncludes(ctx.scope ?? "", SCOPE_META) || ctx.isMatas !== true) throw new ToolInputError(APPROVAL_WORDS.notMeta, { refused: "insufficient_scope" });
}

export const MAX_LIVE_CAMPAIGNS = 10;
export const MAX_ADS_PER_AD_SET = 30;

function budgetOf(o: LiveObject, now: Date) {
  const daily = o.dailyBudgetMinor && o.dailyBudgetMinor > 0 ? o.dailyBudgetMinor : null;
  const lifetime = o.lifetimeBudgetMinor && o.lifetimeBudgetMinor > 0 ? o.lifetimeBudgetMinor : null;
  if (!daily && !lifetime) return null;
  return {
    type: daily ? "daily" : "lifetime",
    amount: round2((daily ?? lifetime)! / 100),
    ...(lifetime ? { remaining: o.budgetRemainingMinor == null ? null : round2(o.budgetRemainingMinor / 100), daysLeft: londonDaysLeft(o.endTime, now) } : {}),
    end: o.endTime,
    moneyADay: moneyADay(o, now),
  };
}

function figures(i: LiveInsight | undefined) {
  if (!i) return { spendToday: null, spendToDate: null, results: null, resultType: null, costPerResult: null };
  return { spendToday: round2(i.spendToday), spendToDate: round2(i.spendToDate), results: i.results, resultType: i.resultType, costPerResult: i.costPerResult == null ? null : round2(i.costPerResult) };
}

/** The event code a campaign id belongs to, from launched_ad_sets. */
async function eventCodeForCampaign(ctx: ToolContext, campaignId: string): Promise<string | null> {
  const res = await ctx.db.from("launched_ad_sets").select("event_id").eq("meta_campaign_id", campaignId).limit(1);
  const eventId = ((res.data ?? []) as Array<{ event_id: string | null }>)[0]?.event_id;
  if (res.error || !eventId) return null;
  const ev = await ctx.db.from("events").select("event_code").eq("id", eventId).maybeSingle();
  return ((ev.data as { event_code: string | null } | null)?.event_code ?? null) || null;
}

export const getLiveTool: McpTool = {
  name: "get_live",
  title: "Read an event's live campaigns from Meta",
  kind: "meta",
  readOnly: true,
  idempotent: true,
  failedText: LIVE_WORDS.liveNotRead,
  description: [
    "Reads an event's live Meta campaigns (or one campaign): per campaign, ad set and ad the status, budget (daily or lifetime, remaining, end), money a day now, spend today and to date, results and cost per result; per ad set the learning phase and targeting (Advantage+ on or off, custom audiences by name, age control and suggestion). Flags an ad set that runs strict while its draft asked for Advantage+ suggestions.",
    "Read only, no approval. The ids it returns are what pause, resume, set_budget, move_budget and rename take. Money is in the ad account's currency.",
  ].join(" "),
  inputSchema: {
    event: z.string().min(2).max(40).optional().describe("The event code."),
    campaign_id: z.string().min(5).max(32).optional().describe("One campaign's Meta id, instead of (or within) the event."),
  },
  async run(ctx, args) {
    requireMetaScope(ctx);
    const live = requireLive(ctx);
    const campaignArg = typeof args.campaign_id === "string" ? args.campaign_id.trim() : null;
    let code = typeof args.event === "string" ? args.event : null;
    if (!code && campaignArg) code = await eventCodeForCampaign(ctx, campaignArg);
    if (!code && campaignArg) throw new ToolInputError(LIVE_WORDS.notFound(LIVE_THINGS.campaign[0], campaignArg), { refused: "no_event" });
    if (!code) throw new ToolInputError(EVENT_WORDS.refusedCode, { refused: "bad_code" });
    const event = await liveEvent(ctx, live, code);
    let campaigns = event.tree.campaigns;
    if (campaignArg) campaigns = campaigns.filter((c) => c.metaCampaignId === campaignArg);
    if (campaignArg && campaigns.length === 0) throw new ToolInputError(LIVE_WORDS.notOnEvent(LIVE_THINGS.campaign[0], campaignArg, event.code), { refused: "not_on_event" });
    const truncated = campaigns.length > MAX_LIVE_CAMPAIGNS;
    campaigns = campaigns.slice(0, MAX_LIVE_CAMPAIGNS);

    let metaGets = event.tree.metaCalls;
    const ids = campaigns.map((c) => c.metaCampaignId);
    let objects: Map<string, LiveObject>;
    const children = new Map<string, { adsets: LiveObject[]; ads: LiveObject[] }>();
    try {
      const read = await live.readObjects(ctx.userId, "campaign", ids);
      objects = read.objects;
      metaGets += read.metaGets;
      for (const id of ids) {
        const kids = await live.readChildren(ctx.userId, id);
        metaGets += kids.metaGets;
        children.set(id, kids);
      }
    } catch {
      return {
        data: { event: event.code, message: LIVE_WORDS.liveNotRead, campaigns: campaigns.map((c) => ({ id: c.metaCampaignId, name: c.name, stage: stageLabel(c.stage), adSets: c.adSets.map((a) => ({ id: a.id, name: a.name })) })) },
        eventId: event.id,
        clientId: event.clientId,
        summary: { code: event.code, campaigns: campaigns.length, metaRead: false, metaGets },
      };
    }
    const allIds = [...ids, ...[...children.values()].flatMap((k) => [...k.adsets.map((a) => a.id), ...k.ads.map((a) => a.id)])];
    let insights = new Map<string, LiveInsight>();
    try {
      const read = await live.readInsights(ctx.userId, allIds);
      insights = read.insights;
      metaGets += read.metaGets;
    } catch {
      insights = new Map();
    }

    // The drafts' asks, for the strict flag.
    const draftIds = [...new Set(campaigns.map((c) => c.draftId).filter((d): d is string => Boolean(d)))];
    const asked = new Map<string, boolean>();
    if (draftIds.length) {
      const res = await ctx.db.from("campaign_drafts").select("id, draft_json").in("id", draftIds);
      for (const row of (res.error ? [] : (res.data ?? [])) as Array<{ draft_json: unknown }>) for (const a of draftAdSetAsks(row.draft_json)) asked.set(a.metaAdSetId, a.askedSuggestions);
    }

    let flagged = 0;
    let currency: string | null = null;
    const firstAccount = campaigns.find((c) => c.adAccountId)?.adAccountId;
    if (firstAccount) currency = (await live.accountInfo(ctx.userId, firstAccount).catch(() => ({ currency: null }))).currency ?? null;
    const out = campaigns.map((c) => {
      const o = objects.get(c.metaCampaignId);
      const kids = children.get(c.metaCampaignId) ?? { adsets: [], ads: [] };
      return {
        id: c.metaCampaignId,
        name: o?.name ?? c.name,
        stage: stageLabel(c.stage),
        status: o?.status ?? null,
        effectiveStatus: o?.effectiveStatus ?? null,
        budget: o ? budgetOf(o, ctx.now) : null,
        ...figures(insights.get(c.metaCampaignId)),
        ...(c.draftId ? {} : { note: LIVE_WORDS.noDraft(c.name, event.code) }),
        adSets: kids.adsets.map((a) => {
          const t = targetingSummary(a.targeting);
          const strict = asked.get(a.id) === true && advantageAudience(a.targeting) === 0;
          if (strict) flagged += 1;
          const ads = kids.ads.filter((ad) => ad.adsetId === a.id);
          return {
            id: a.id,
            name: a.name,
            status: a.status,
            effectiveStatus: a.effectiveStatus,
            budget: budgetOf(a, ctx.now),
            learning: a.learningStatus,
            ...figures(insights.get(a.id)),
            targeting: { ...t, draftAskedSuggestions: asked.get(a.id) ?? null },
            ...(strict ? { flags: [LIVE_WORDS.strictFlag] } : {}),
            ads: ads.slice(0, MAX_ADS_PER_AD_SET).map((ad) => ({ id: ad.id, name: ad.name, status: ad.status, effectiveStatus: ad.effectiveStatus, ...figures(insights.get(ad.id)) })),
            ...(ads.length > MAX_ADS_PER_AD_SET ? { adsNotShown: ads.length - MAX_ADS_PER_AD_SET } : {}),
          };
        }),
      };
    });
    return {
      data: { event: event.code, currency, campaigns: out, ...(truncated ? { campaignsNotShown: event.tree.campaigns.length - MAX_LIVE_CAMPAIGNS } : {}) },
      eventId: event.id,
      clientId: event.clientId,
      summary: { code: event.code, campaigns: out.length, adSets: out.reduce((n, c) => n + c.adSets.length, 0), strictFlagged: flagged, metaGets },
    };
  },
};
