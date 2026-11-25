/**
 * lib/mcp/tools/drafts.ts — get_drafts and get_draft (read-only).
 *
 * campaign_drafts through the paged reader; draft_json through migrateDraft
 * (lib/autosave.ts, via ctx.readers) so old drafts read as the app reads
 * them. The summary carries names, ids, counts and amounts: never copy
 * longer than a headline, never person data.
 */
import { z } from "zod";
import { loadAllPaged } from "../../db/paged-read.ts";
import { ToolInputError, type McpTool, type ToolContext } from "../tool-types.ts";
import { eventSummary, loadEventByCode, normaliseCode } from "./shared.ts";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Obj[]) : []);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const countOf = (v: unknown): number => (Array.isArray(v) ? v.length : 0);
const names = (xs: Obj[]) => xs.map((x) => str(x.name) ?? str(x.label) ?? str(x.id)).filter((x): x is string => Boolean(x));

const DRAFT_COLUMNS = "id, name, status, objective, event_id, client_id, ad_account_id, updated_at, draft_json";
const DRAFTS_LIMIT = 25;

export interface DraftRow {
  id: string;
  name: string | null;
  status: string | null;
  objective: string | null;
  event_id: string | null;
  client_id: string | null;
  ad_account_id: string | null;
  updated_at: string | null;
  draft_json: Obj | null;
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return url.slice(0, 120);
  }
}

/** Account, pixel, link, audiences, creatives, budget, schedule, locations. */
export function summariseDraft(row: DraftRow, draft: Obj) {
  const settings = obj(draft.settings);
  const audiences = obj(draft.audiences);
  const budget = obj(draft.budgetSchedule);
  const creatives = arr(draft.creatives);
  const adSets = arr(draft.adSetSuggestions);
  const links = [...new Set(creatives.map((c) => str(c.destinationUrl)).filter((x): x is string => Boolean(x)))];
  const groups = arr(budget.locationGroups);
  const enabled = adSets.filter((a) => a.enabled !== false);
  return {
    id: row.id,
    name: row.name ?? str(settings.campaignName),
    status: row.status ?? str(draft.status),
    objective: row.objective ?? str(settings.objective),
    updatedAt: row.updated_at,
    launchedCampaignId: str(draft.metaCampaignId),
    account: str(settings.adAccountId) ?? str(settings.metaAdAccountId) ?? row.ad_account_id,
    pixel: str(settings.pixelId) ?? str(settings.metaPixelId),
    page: str(settings.metaPageId),
    campaignCode: str(settings.campaignCode),
    optimisationGoal: str(settings.optimisationGoal),
    links: links.map(hostOf),
    audiences: {
      pageGroups: names(arr(audiences.pageGroups)),
      customAudienceGroups: names(arr(audiences.customAudienceGroups)),
      interestGroups: names(arr(audiences.interestGroups)),
      lookalikeGroups: names(arr(audiences.selectedPagesLookalikeGroups)),
      savedAudiences: countOf(obj(audiences.savedAudiences).audienceIds),
      offPixelAudiences: countOf(audiences.offpixelCustomAudienceIds),
    },
    creatives: {
      count: creatives.length,
      items: creatives.slice(0, 30).map((c) => ({
        name: str(c.name),
        mediaType: str(c.mediaType),
        headline: str(c.headline)?.slice(0, 120) ?? null,
        cta: str(c.cta),
        link: hostOf(str(c.destinationUrl)),
        assets: arr(c.assetVariations).length,
      })),
    },
    budget: {
      level: str(budget.budgetLevel),
      type: str(budget.budgetType),
      amount: numOrNull(budget.budgetAmount),
      currency: str(budget.currency),
      adSetDailyTotal: Math.round(enabled.reduce((s, a) => s + (numOrNull(a.budgetPerDay) ?? 0), 0) * 100) / 100,
    },
    schedule: {
      start: str(budget.startDate),
      end: str(budget.endDate),
      timezone: str(budget.timezone),
    },
    locations: {
      presets: Array.isArray(budget.locationPresets) ? (budget.locationPresets as unknown[]).map(String) : [],
      groups: groups.map((g) => ({
        label: str(g.label),
        include: arr(g.selections).filter((s) => s.mode !== "exclude").map((s) => str(s.label)).filter(Boolean),
        exclude: arr(g.selections).filter((s) => s.mode === "exclude").map((s) => str(s.label)).filter(Boolean),
      })),
      excluded: arr(budget.excludedLocations).map((s) => str(s.label)).filter(Boolean),
    },
    adSets: {
      count: adSets.length,
      enabled: enabled.length,
      items: adSets.slice(0, 40).map((a) => ({
        name: str(a.name),
        enabled: a.enabled !== false,
        dailyBudget: numOrNull(a.budgetPerDay),
        lifetimeBudget: numOrNull(a.budgetLifetime),
        ages: a.ageMin != null && a.ageMax != null ? `${a.ageMin}-${a.ageMax}` : null,
        source: str(a.sourceName),
        location: str(a.locationLabel) ?? (str(a.locationGroupId) ? groups.find((g) => g.id === a.locationGroupId)?.label ?? null : null),
      })),
    },
  };
}

function summarise(ctx: ToolContext, row: DraftRow) {
  const draft = row.draft_json ? ctx.readers.migrateDraft(row.draft_json) : {};
  return summariseDraft(row, draft);
}

export const getDraftsTool: McpTool = {
  name: "get_drafts",
  title: "Get an event's campaign drafts",
  kind: "read",
  description: [
    "The Meta campaign drafts linked to one show, newest first, each summarised: ad account, pixel, links, audiences, creatives, budget, schedule, locations and ad sets.",
    'Example: get_drafts({ code: "P26-BDAY" }).',
  ].join(" "),
  inputSchema: {
    code: z.string().min(2).max(40).describe('The event code, e.g. "P26-BDAY".'),
  },
  async run(ctx, args) {
    const code = normaliseCode(args.code);
    const found = await loadEventByCode(ctx.db, code);
    if (!found) throw new ToolInputError(`No event with code ${code}.`);
    const ids = [found.primary.id, ...found.siblings.map((s) => s.id)];
    const rows = await loadAllPaged<DraftRow>(ctx.db, "campaign_drafts", DRAFT_COLUMNS, ["id"], (q) => q.in("event_id", ids));
    rows.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    const drafts = rows.slice(0, DRAFTS_LIMIT).map((r) => summarise(ctx, r));
    return {
      data: { event: eventSummary(found.primary, ctx.today), count: rows.length, truncated: rows.length > drafts.length, drafts },
      eventId: found.primary.id,
      clientId: found.primary.client_id,
      summary: { code, drafts: rows.length, returned: drafts.length, draftIds: drafts.map((d) => d.id) },
    };
  },
};

export const getDraftTool: McpTool = {
  name: "get_draft",
  title: "Get one campaign draft",
  kind: "read",
  description: [
    "One Meta campaign draft by its id, summarised: ad account, pixel, links, audiences, creatives, budget, schedule, locations and ad sets.",
    'Example: get_draft({ id: "3f2c…-uuid" }) with an id from get_drafts or get_event.',
  ].join(" "),
  inputSchema: {
    id: z.string().uuid().describe("The draft's id (a UUID)."),
  },
  async run(ctx, args) {
    const id = String(args.id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ToolInputError("Give a draft id (a UUID).");
    const rows = await loadAllPaged<DraftRow>(ctx.db, "campaign_drafts", DRAFT_COLUMNS, ["id"], (q) => q.eq("id", id));
    const row = rows[0];
    if (!row) throw new ToolInputError(`No draft with id ${id}.`);
    const draft = summarise(ctx, row);
    return {
      data: { draft },
      eventId: row.event_id,
      clientId: row.client_id,
      summary: { draftId: id, creatives: draft.creatives.count, adSets: draft.adSets.count },
    };
  },
};
