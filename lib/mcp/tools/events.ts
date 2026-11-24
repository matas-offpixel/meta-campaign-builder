/**
 * lib/mcp/tools/events.ts — list_events and get_event (read-only).
 *
 * Readers reused: loadAllPaged + client-status (events, launched_ad_sets,
 * campaign_drafts), phaseOf, pageAudienceForShow (the CIRQLIN page),
 * listAllSnapshotsForEvent (tickets, via ctx.readers). Spend and signups
 * come from ./figures.ts, the morning brief's own rules, so get_event and
 * morning_topline agree for one show on one day (Matas, 24 Nov).
 */
import { z } from "zod";
import { loadAllPaged } from "../../db/paged-read.ts";
import { pageAudienceForShow } from "../../cirqlin/page-audience/read.ts";
import { addDays } from "../../learning/findings/observed-tests.ts";
import type { McpTool, ToolContext } from "../tool-types.ts";
import { ToolInputError } from "../tool-types.ts";
import { clientNameOf, eventSummary, loadEventByCode, loadEvents, normaliseCode, stageOf, type Stage } from "./shared.ts";
import { eventMatcher, loadInsightsForEvents, signupsByEvent, spendByEvent } from "./figures.ts";

const STAGES = ["teaser", "announced", "presale", "general_sale", "show_week", "unknown"] as const;
const LIST_LIMIT = 200;


export const listEventsTool: McpTool = {
  name: "list_events",
  title: "List events",
  kind: "read",
  description: [
    "List Off/Pixel events (shows) with code, name, venue, date, phase and client. Archived clients are left out.",
    "Filters: client (part of the client's name), stage (teaser, announced, presale, general_sale, show_week, unknown), upcoming (default true: today or later, or no date).",
    'Example: list_events({ client: "NX", stage: "presale" }) → the NX shows in presale.',
  ].join(" "),
  inputSchema: {
    client: z.string().max(80).optional().describe("Part of the client's name, case-insensitive, e.g. \"Electric\"."),
    stage: z.enum(STAGES).optional().describe("Phase today."),
    upcoming: z.boolean().optional().describe("Only shows today or later (default true)."),
  },
  async run(ctx, args) {
    const upcoming = args.upcoming !== false;
    const rows = await loadEvents(ctx.db, upcoming ? (q) => q.or(`event_date.is.null,event_date.gte.${ctx.today}`) : undefined);
    const client = typeof args.client === "string" ? args.client.trim().toLowerCase() : "";
    const stage = args.stage as Stage | undefined;
    const matched = rows
      .filter((r) => !client || (clientNameOf(r) ?? "").toLowerCase().includes(client))
      .filter((r) => !stage || stageOf(r, ctx.today) === stage)
      .map((r) => eventSummary(r, ctx.today));
    const events = matched.slice(0, LIST_LIMIT);
    return {
      data: { today: ctx.today, count: matched.length, truncated: matched.length > events.length, events },
      summary: { count: matched.length, returned: events.length },
    };
  },
};

export async function eventDetail(ctx: ToolContext, code: string) {
  const found = await loadEventByCode(ctx.db, code);
  if (!found) return null;
  const { primary, siblings } = found;
  const ids = [primary.id, ...siblings.map((s) => s.id)];
  const yesterday = addDays(ctx.today, -1);
  const from = addDays(yesterday, -7);

  // The brief matches an ad-day to the first upcoming show by id; get_event uses the same set, plus this show.
  const upcoming = await loadEvents(ctx.db, (q) => q.or(`event_date.is.null,event_date.gte.${yesterday}`));
  const matchSet = [...new Map([...upcoming, primary, ...siblings].map((e) => [e.id, e])).values()];

  const [insights, signupMap, audience, tickets, adSets, drafts] = await Promise.all([
    loadInsightsForEvents(ctx.db, [primary, ...siblings], from, yesterday),
    signupsByEvent(ctx.db, [primary.id], from, yesterday),
    pageAudienceForShow(ctx.db, primary.id),
    ctx.readers.ticketSnapshots(ctx.db, primary.id),
    loadAllPaged<{ id: string; meta_adset_id: string | null; meta_campaign_id: string | null; draft_id: string | null; event_id: string | null }>(
      ctx.db,
      "launched_ad_sets",
      "id, meta_adset_id, meta_campaign_id, draft_id, event_id",
      ["id"],
      (q) => q.in("event_id", ids),
    ),
    loadAllPaged<{ id: string; name: string | null; status: string | null; objective: string | null; updated_at: string | null; event_id: string | null }>(
      ctx.db,
      "campaign_drafts",
      "id, name, status, objective, updated_at, event_id",
      ["id"],
      (q) => q.in("event_id", ids),
    ),
  ]);

  const spend = spendByEvent(insights, eventMatcher(matchSet), yesterday).get(primary.id) ?? null;
  const signups = signupMap.get(primary.id) ?? { sig_y: null, sig_7d: null, sig_total: null };

  const sortedTickets = [...tickets].sort((a, b) => b.snapshot_at.localeCompare(a.snapshot_at));
  const [latest, previous] = sortedTickets;

  const campaignIds = new Set<string>(
    (primary.meta_campaign_id ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const byCampaign = new Map<string, number>();
  for (const a of adSets) {
    if (a.meta_campaign_id) {
      campaignIds.add(a.meta_campaign_id);
      byCampaign.set(a.meta_campaign_id, (byCampaign.get(a.meta_campaign_id) ?? 0) + 1);
    }
  }

  return {
    event: {
      ...eventSummary(primary, ctx.today),
      id: primary.id,
      dates: {
        announce: primary.announcement_at,
        presale: primary.presale_at,
        generalSale: primary.general_sale_at,
        show: primary.event_date,
      },
      siblingFixtures: siblings.map((s) => ({ id: s.id, name: s.name, date: s.event_date })),
    },
    // The morning brief's figures: yesterday, and the daily average over the 7 days before it.
    spend: {
      currency: "GBP",
      source: "ad_daily_insights (campaign id, else [CODE] in the name)",
      yesterdayDate: yesterday,
      yesterday: spend?.spend_y ?? null,
      dailyAverage7Days: spend?.spend_7d ?? null,
      checkoutsYesterday: spend?.chk_y ?? null,
      checkoutsDailyAverage7Days: spend?.chk_7d ?? null,
      misnamedCampaigns: spend?.misnamed ?? null,
    },
    signups: {
      total: signups.sig_total,
      yesterday: signups.sig_y,
      dailyAverage7Days: signups.sig_7d,
      source: "signup_source_snapshots, else cirqlin_page_audience day differences",
      page: audience
        ? {
            pageId: audience.pageId,
            fetchDay: audience.fetchDay,
            signups: audience.signups,
            consentMarketing: audience.consentMarketing,
            communityJoined: audience.communityJoined,
          }
        : null,
    },
    tickets: {
      latest: latest?.tickets_sold ?? null,
      latestAt: latest?.snapshot_at ?? null,
      latestSource: latest?.source ?? null,
      previous: previous?.tickets_sold ?? null,
      previousAt: previous?.snapshot_at ?? null,
      sincePrevious: latest?.tickets_sold != null && previous?.tickets_sold != null ? latest.tickets_sold - previous.tickets_sold : null,
      snapshots: tickets.length,
    },
    campaigns: {
      metaCampaignIds: [...campaignIds],
      launchedAdSets: adSets.length,
      adSetsByCampaign: [...byCampaign.entries()].map(([metaCampaignId, adSetCount]) => ({ metaCampaignId, adSets: adSetCount })),
    },
    drafts: drafts
      .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
      .map((d) => ({ id: d.id, name: d.name, status: d.status, objective: d.objective, updatedAt: d.updated_at })),
    primary,
  };
}

export const getEventTool: McpTool = {
  name: "get_event",
  title: "Get one event",
  kind: "read",
  description: [
    "One show by its event code: phase and phase dates; ad spend and checkouts yesterday and their daily average over the 7 days before (the same figures as morning_topline); CIRQLIN signups; the latest ticket count and the change since the count before; linked Meta campaigns; and its campaign drafts.",
    'Example: get_event({ code: "NX26-DOD" }).',
  ].join(" "),
  inputSchema: {
    code: z.string().min(2).max(40).describe('The event code, e.g. "NX26-DOD".'),
  },
  async run(ctx, args) {
    const code = normaliseCode(args.code);
    const detail = await eventDetail(ctx, code);
    if (!detail) throw new ToolInputError(`No event with code ${code}.`);
    const { primary, ...data } = detail;
    return {
      data,
      eventId: primary.id,
      clientId: primary.client_id,
      summary: {
        code,
        drafts: data.drafts.length,
        launchedAdSets: data.campaigns.launchedAdSets,
        ticketSnapshots: data.tickets.snapshots,
      },
    };
  },
};
