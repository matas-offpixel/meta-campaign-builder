/**
 * lib/mcp/tools/events.ts — list_events and get_event (read-only).
 *
 * Readers reused: loadAllPaged + client-status (events, launched_ad_sets,
 * campaign_drafts), phaseOf, listRollupsForEvent (spend),
 * loadCirqlinSnapshotsForEvent + pageAudienceForShow (CIRQLIN signups),
 * listAllSnapshotsForEvent (tickets, via ctx.readers).
 */
import { z } from "zod";
import { loadAllPaged } from "../../db/paged-read.ts";
import { listRollupsForEvent } from "../../db/event-daily-rollups.ts";
import { loadCirqlinSnapshotsForEvent } from "../../db/signup-source-snapshots.ts";
import { pageAudienceForShow } from "../../cirqlin/page-audience/read.ts";
import { addDays } from "../../learning/findings/observed-tests.ts";
import type { McpTool, ToolContext } from "../tool-types.ts";
import { ToolInputError } from "../tool-types.ts";
import { clientNameOf, eventSummary, loadEventByCode, loadEvents, normaliseCode, stageOf, type Stage } from "./shared.ts";

const STAGES = ["teaser", "announced", "presale", "general_sale", "show_week", "unknown"] as const;
const LIST_LIMIT = 200;

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

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

interface DayFigure {
  yesterday: number | null;
  last7Days: number | null;
}

function windowSum(rows: Array<{ day: string; value: number | null }>, yesterday: string): DayFigure {
  const start = addDays(yesterday, -6);
  const inWindow = rows.filter((r) => r.day >= start && r.day <= yesterday && r.value != null);
  const y = rows.find((r) => r.day === yesterday && r.value != null);
  return {
    yesterday: y ? round2(y.value!) : null,
    last7Days: inWindow.length ? round2(inWindow.reduce((s, r) => s + r.value!, 0)) : null,
  };
}

export async function eventDetail(ctx: ToolContext, code: string) {
  const found = await loadEventByCode(ctx.db, code);
  if (!found) return null;
  const { primary, siblings } = found;
  const ids = [primary.id, ...siblings.map((s) => s.id)];
  const yesterday = addDays(ctx.today, -1);

  const [rollups, snapshots, audience, tickets, adSets, drafts] = await Promise.all([
    listRollupsForEvent(ctx.db as never, primary.id),
    loadCirqlinSnapshotsForEvent(ctx.db as never, primary.id),
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

  const spend = windowSum(
    rollups.map((r) => ({ day: String(r.date), value: r.ad_spend == null ? null : num(r.ad_spend) })),
    yesterday,
  );

  // Latest snapshot per day wins (several fetches a day are possible).
  const perDay = new Map<string, { signups_day: number | null; signups_total: number | null; snapshot_at: string }>();
  for (const s of snapshots) {
    const prev = perDay.get(s.day);
    if (!prev || s.snapshot_at > prev.snapshot_at) perDay.set(s.day, s);
  }
  const signupDays = [...perDay.entries()].map(([day, s]) => ({ day, value: s.signups_day == null ? null : num(s.signups_day) }));
  const snapshotTotal = [...perDay.values()].reduce<number | null>((m, s) => (s.signups_total == null ? m : Math.max(m ?? 0, num(s.signups_total))), null);
  const signupWindow = windowSum(signupDays, yesterday);
  const signupTotal = Math.max(snapshotTotal ?? -1, audience?.signups ?? -1);

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
    spend: { currency: "GBP", source: "event_daily_rollups.ad_spend", yesterdayDate: yesterday, ...spend },
    signups: {
      total: signupTotal >= 0 ? signupTotal : null,
      yesterday: signupWindow.yesterday,
      last7Days: signupWindow.last7Days,
      source: snapshots.length ? "signup_source_snapshots" : audience ? "cirqlin_page_audience" : null,
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
    "One show by its event code: phase and phase dates, ad spend yesterday and over the last 7 days, CIRQLIN signups, the latest ticket count and the change since the count before, linked Meta campaigns, and its campaign drafts.",
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
