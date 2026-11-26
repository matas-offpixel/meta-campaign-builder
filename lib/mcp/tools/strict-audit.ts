/**
 * lib/mcp/tools/strict-audit.ts — strict_audit (M3d-d, scope mcp:read).
 *
 * Live ad sets that run strict while their drafts asked for Advantage+
 * suggestions: launched with Advantage+ audience asked for (the draft's ad
 * set had `advantagePlus`, or was a blank ad set, which always runs
 * Advantage+ — buildMetaTargeting in lib/meta/adset.ts), Meta delivering
 * them (effective_status ACTIVE or IN_PROCESS), and Meta's targeting now
 * saying `targeting_automation.advantage_audience: 0`. That is what the
 * 1870196 fallback left behind before #1387 (the age suggestion's shape
 * refused, the ad set retried strict): the audiences and ages the draft
 * meant as suggestions became hard limits.
 *
 * It also lists every live launched ad set in scope with location expansion
 * on (`targeting_automation.individual_setting.geo` 1, "Reach more people
 * likely to respond to your ads"; lib/meta/geo-expansion.ts), whatever its
 * draft asked for. An ad set with no geo key is counted as "not set", never
 * as on. Both come from the same Graph read, so every launched Meta ad set
 * in scope is read, not only the ones that asked for Advantage+.
 *
 * Reads: launched_ad_sets (channel meta) for the scope, their drafts'
 * adSetSuggestions and audience groups, the events (archived clients out,
 * CLAUDE.md "Archived clients"), every read paged past PostgREST's 1,000
 * rows; then Meta, one GET per ≤ 50 ad sets (ctx.reads.adSets, GET only),
 * counted in metaGets. Nothing is written anywhere.
 *
 * Relative imports only (node:test).
 */
import { z } from "zod";
import { loadAllPaged, type PagedQuery } from "../../db/paged-read.ts";
import { loadArchivedClientIds } from "../../db/client-status.ts";
import { STRICT_WORDS } from "../audit/words.ts";
import { GEO_WORDS } from "../../meta/geo-expansion.ts";
import { ToolInputError, type Db, type McpTool } from "../tool-types.ts";
import { loadEventByCode, loadEvents, normaliseCode, type EventRow } from "./shared.ts";

const LIVE = new Set(["ACTIVE", "IN_PROCESS"]);
const IN_CHUNK = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LAUNCHED_COLUMNS = "id, meta_adset_id, meta_campaign_id, ad_account_id, draft_id, event_id, client_id, channel, source_type, source_id, source_name, advantage_plus, age_min, age_max, suggestion_id";

interface LaunchedRow {
  id: string;
  meta_adset_id: string;
  meta_campaign_id: string | null;
  ad_account_id: string | null;
  draft_id: string | null;
  event_id: string | null;
  client_id: string | null;
  channel: string | null;
  source_type: string | null;
  source_id: string | null;
  source_name: string | null;
  advantage_plus: boolean | null;
  age_min: number | null;
  age_max: number | null;
  suggestion_id: string | null;
}

interface DraftRow {
  id: string;
  name: string | null;
  draft_json: Record<string, unknown> | null;
}

interface Suggestion {
  id?: string;
  sourceType?: string;
  sourceId?: string;
  advantagePlus?: boolean;
  ageMin?: number;
  ageMax?: number;
}

interface Group {
  id?: string;
  name?: string;
  audienceIds?: unknown[];
  interests?: unknown[];
}

const chunks = <T>(xs: readonly T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

async function launchedFor(db: Db, eventIds: readonly string[] | null, clientId: string | null): Promise<LaunchedRow[]> {
  const meta = (q: PagedQuery) => q.eq("channel", "meta");
  const out = new Map<string, LaunchedRow>();
  const add = (rows: LaunchedRow[]) => rows.forEach((r) => out.set(r.id, r));
  if (eventIds === null && clientId === null) {
    add(await loadAllPaged<LaunchedRow>(db, "launched_ad_sets", LAUNCHED_COLUMNS, ["id"], meta));
    return [...out.values()];
  }
  for (const ids of chunks(eventIds ?? [], IN_CHUNK)) {
    add(await loadAllPaged<LaunchedRow>(db, "launched_ad_sets", LAUNCHED_COLUMNS, ["id"], (q) => meta(q).in("event_id", ids)));
  }
  if (clientId) add(await loadAllPaged<LaunchedRow>(db, "launched_ad_sets", LAUNCHED_COLUMNS, ["id"], (q) => meta(q).eq("client_id", clientId)));
  return [...out.values()];
}

async function draftsFor(db: Db, ids: readonly string[]): Promise<Map<string, DraftRow>> {
  const out = new Map<string, DraftRow>();
  for (const part of chunks([...new Set(ids)], IN_CHUNK)) {
    const rows = await loadAllPaged<DraftRow>(db, "campaign_drafts", "id, name, draft_json", ["id"], (q) => q.in("id", part));
    for (const r of rows) out.set(r.id, r);
  }
  return out;
}

async function eventsFor(db: Db, ids: readonly string[]): Promise<Map<string, EventRow>> {
  const out = new Map<string, EventRow>();
  for (const part of chunks([...new Set(ids)], IN_CHUNK)) {
    for (const r of await loadEvents(db, (q) => q.in("id", part))) out.set(r.id, r);
  }
  return out;
}

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** The draft's ad set for a launched row: by suggestion id, else by source. */
function suggestionOf(draft: DraftRow | undefined, row: LaunchedRow): Suggestion | null {
  const sugs = list(draft?.draft_json?.adSetSuggestions) as Suggestion[];
  if (row.suggestion_id) {
    const hit = sugs.find((s) => s?.id === row.suggestion_id);
    if (hit) return hit;
  }
  return null;
}

/** Advantage+ asked for: the launch's snapshot, or the draft's own ad set (blank ad sets always run Advantage+). */
function askedAdvantage(row: LaunchedRow, sug: Suggestion | null): boolean {
  if (sug) return sug.sourceType === "blank" || sug.advantagePlus === true;
  return row.source_type === "blank" || row.advantage_plus === true;
}

/** What the suggestions carried: the custom group's audiences, the interest group's interests, the ages. */
function carried(draft: DraftRow | undefined, row: LaunchedRow, sug: Suggestion | null) {
  const audiences = (draft?.draft_json?.audiences ?? {}) as Record<string, unknown>;
  const sourceType = sug?.sourceType ?? row.source_type ?? null;
  const sourceId = sug?.sourceId ?? row.source_id ?? null;
  let audienceCount = 0;
  let interestCount = 0;
  let group: string | null = row.source_name ?? null;
  if (sourceType === "custom_group") {
    const g = (list(audiences.customAudienceGroups) as Group[]).find((x) => x?.id === sourceId);
    if (g) {
      audienceCount = list(g.audienceIds).length;
      group = g.name ?? group;
    }
  } else if (sourceType === "interest_group") {
    const g = (list(audiences.interestGroups) as Group[]).find((x) => x?.id === sourceId);
    if (g) {
      interestCount = list(g.interests).length;
      group = g.name ?? group;
    }
  }
  const ageMin = typeof sug?.ageMin === "number" ? sug.ageMin : row.age_min;
  const ageMax = typeof sug?.ageMax === "number" ? sug.ageMax : row.age_max;
  return { sourceType, group, audiences: audienceCount, interests: interestCount, ageMin: ageMin ?? null, ageMax: ageMax ?? null };
}

export function adSetLink(adAccountId: string | null, adSetId: string): string {
  const act = (adAccountId ?? "").replace(/^act_/, "");
  return /^\d+$/.test(act)
    ? `https://adsmanager.facebook.com/adsmanager/manage/adsets?act=${act}&selected_adset_ids=${adSetId}`
    : `https://adsmanager.facebook.com/adsmanager/manage/adsets?selected_adset_ids=${adSetId}`;
}

async function findClient(db: Db, given: string): Promise<{ id: string; name: string } | null> {
  const archived = await loadArchivedClientIds(db as never);
  const rows = await loadAllPaged<{ id: string; name: string | null }>(db, "clients", "id, name", ["id"]);
  const live = rows.filter((r) => !archived.has(r.id));
  const want = given.trim().toLowerCase();
  const hit = UUID.test(given.trim()) ? live.find((r) => r.id === given.trim()) : live.find((r) => (r.name ?? "").trim().toLowerCase() === want);
  return hit ? { id: hit.id, name: hit.name ?? hit.id } : null;
}

export const strictAuditTool: McpTool = {
  name: "strict_audit",
  // PENDING DESIGN: the title is Claude-facing words (location expansion added).
  title: "Find ad sets running strict that asked for Advantage+, or with location expansion on",
  kind: "read",
  // PENDING DESIGN claude.mcp.strict.failed
  failedText: STRICT_WORDS.failed,
  // PENDING DESIGN: the tool's description is Claude-facing words.
  description: [
    "Lists live ad sets (Meta shows them active or in process) that run strict, Advantage+ audience off, while the draft that launched them asked for Advantage+ suggestions: their audiences and ages are hard limits on Meta instead of suggestions.",
    "Also lists live ad sets with location expansion on (Ads Manager's \"Reach more people likely to respond to your ads\"), which lets Meta deliver outside the places an ad set targets; ad sets where Meta doesn't show the setting are counted as not set, not as on.",
    "For one client (name or id), one event code, or every live client when neither is given. Each hit has its event code, campaign, ad set name and id, the Ads Manager link and what the draft asked for. It only reads: nothing changes on Meta or in the app.",
    'Example: strict_audit({ event_code: "P26-BDAY" }).',
  ].join(" "),
  inputSchema: {
    client: z.string().min(1).max(120).optional().describe("A client's name or id. Leave out with event_code."),
    event_code: z.string().min(2).max(40).optional().describe('An event code, e.g. "P26-BDAY". Leave out with client.'),
  },
  async run(ctx, args) {
    const clientArg = typeof args.client === "string" && args.client.trim() ? args.client.trim() : null;
    const codeArg = typeof args.event_code === "string" && args.event_code.trim() ? args.event_code.trim() : null;
    if (clientArg && codeArg) throw new ToolInputError(STRICT_WORDS.both, { refused: "client_and_event" });

    let eventIds: string[] | null = null;
    let clientId: string | null = null;
    let scope: Record<string, unknown> = { all: true };
    if (codeArg) {
      const code = normaliseCode(codeArg);
      const found = await loadEventByCode(ctx.db, code);
      if (!found) throw new ToolInputError(STRICT_WORDS.unknownEvent(code), { code, found: false });
      eventIds = [found.primary.id, ...found.siblings.map((s) => s.id)];
      scope = { code };
    } else if (clientArg) {
      const client = await findClient(ctx.db, clientArg);
      if (!client) throw new ToolInputError(STRICT_WORDS.unknownClient(clientArg), { refused: "unknown_client" });
      clientId = client.id;
      eventIds = (await loadEvents(ctx.db, (q) => q.eq("client_id", client.id))).map((e) => e.id);
      scope = { clientId };
    }

    const rows = (await launchedFor(ctx.db, eventIds, clientId)).filter((r) => /^\d+$/.test(r.meta_adset_id ?? ""));
    const [drafts, events, archived] = await Promise.all([
      draftsFor(ctx.db, rows.map((r) => r.draft_id).filter((id): id is string => Boolean(id))),
      eventsFor(ctx.db, rows.map((r) => r.event_id).filter((id): id is string => Boolean(id))),
      loadArchivedClientIds(ctx.db as never),
    ]);
    // Archived clients out: by the row's client, and by its event (loadEvents drops archived clients' events).
    const kept = rows.filter((r) => !(r.client_id && archived.has(r.client_id)) && !(r.event_id && !events.has(r.event_id)));
    const candidates = kept
      .map((row) => {
        const draft = row.draft_id ? drafts.get(row.draft_id) : undefined;
        const sug = suggestionOf(draft, row);
        return { row, draft, sug };
      })
      .filter((c) => askedAdvantage(c.row, c.sug));

    const summaryBase = { ...scope, launched: rows.length, askedAdvantage: candidates.length };
    if (kept.length === 0) {
      const message = [STRICT_WORDS.none, STRICT_WORDS.geoNone].join(" ");
      return {
        data: { count: 0, checked: 0, metaGets: 0, notRead: 0, message, adSets: [], locationExpansion: { count: 0, notSet: 0, adSets: [] } },
        eventId: eventIds?.length === 1 ? eventIds[0] : null,
        clientId,
        summary: { ...summaryBase, metaGets: 0, hits: 0, geoHits: 0, geoNotSet: 0, notRead: 0 },
      };
    }
    if (!ctx.reads) throw new ToolInputError(STRICT_WORDS.noMeta, { ...summaryBase, refused: "no_meta_reads" });
    let read: Awaited<ReturnType<NonNullable<typeof ctx.reads>["adSets"]>>;
    try {
      // One read for both lists: every launched Meta ad set in scope (≤ 50 a GET).
      read = await ctx.reads.adSets({ userId: ctx.userId, ids: kept.map((r) => r.meta_adset_id) });
    } catch {
      throw new ToolInputError(STRICT_WORDS.noMeta, { ...summaryBase, refused: "meta_unreadable" });
    }
    const byId = new Map(read.adSets.map((a) => [a.id, a]));
    const hits = candidates
      .map((c) => ({ ...c, meta: byId.get(c.row.meta_adset_id) }))
      .filter((c) => c.meta && LIVE.has(c.meta.effectiveStatus ?? "") && c.meta.advantageAudience === 0)
      .map(({ row, draft, sug, meta }) => {
        const asked = carried(draft, row, sug);
        const event = row.event_id ? events.get(row.event_id) : undefined;
        return {
          event: event?.event_code ?? null,
          campaign: { id: meta!.campaignId ?? row.meta_campaign_id, name: meta!.campaignName },
          adSet: { id: row.meta_adset_id, name: meta!.name ?? row.source_name },
          status: meta!.effectiveStatus,
          link: adSetLink(row.ad_account_id, row.meta_adset_id),
          draftId: row.draft_id,
          draftName: draft?.name ?? null,
          asked: { advantagePlus: true, source: asked.sourceType, group: asked.group, audiences: asked.audiences, interests: asked.interests, ageMin: asked.ageMin, ageMax: asked.ageMax },
          // PENDING DESIGN claude.mcp.strict.asked / .meta_now
          line: `${STRICT_WORDS.asked(asked.audiences, asked.interests, asked.ageMin, asked.ageMax)} ${STRICT_WORDS.metaNow}`,
        };
      })
      .sort((a, b) => `${a.event ?? ""} ${a.campaign.id ?? ""} ${a.adSet.name ?? ""}`.localeCompare(`${b.event ?? ""} ${b.campaign.id ?? ""} ${b.adSet.name ?? ""}`));

    // Location expansion: live ad sets Meta holds at geo 1. No geo key is "not set", a separate count.
    const live = kept
      .map((row) => ({ row, meta: byId.get(row.meta_adset_id) }))
      .filter((c) => c.meta && LIVE.has(c.meta.effectiveStatus ?? ""));
    const geoNotSet = live.filter((c) => c.meta!.geoExpansion === "not_set").length;
    const geoHits = live
      .filter((c) => c.meta!.geoExpansion === "on")
      .map(({ row, meta }) => {
        const draft = row.draft_id ? drafts.get(row.draft_id) : undefined;
        const event = row.event_id ? events.get(row.event_id) : undefined;
        const name = meta!.name ?? row.source_name ?? row.meta_adset_id;
        return {
          event: event?.event_code ?? null,
          campaign: { id: meta!.campaignId ?? row.meta_campaign_id, name: meta!.campaignName },
          adSet: { id: row.meta_adset_id, name },
          status: meta!.effectiveStatus,
          link: adSetLink(row.ad_account_id, row.meta_adset_id),
          draftId: row.draft_id,
          draftName: draft?.name ?? null,
          // PENDING DESIGN launch.adset.geo_expansion_untick (the launch result's line, reused)
          line: GEO_WORDS.untick(name),
        };
      })
      .sort((a, b) => `${a.event ?? ""} ${a.campaign.id ?? ""} ${a.adSet.name ?? ""}`.localeCompare(`${b.event ?? ""} ${b.campaign.id ?? ""} ${b.adSet.name ?? ""}`));

    const lines = [
      hits.length ? STRICT_WORDS.found(hits.length) : STRICT_WORDS.none,
      geoHits.length ? STRICT_WORDS.geoFound(geoHits.length) : STRICT_WORDS.geoNone,
    ];
    if (geoNotSet) lines.push(STRICT_WORDS.geoNotSet(geoNotSet));
    lines.push(STRICT_WORDS.checked(kept.length, read.metaGets));
    if (read.notRead.length) lines.push(STRICT_WORDS.notRead(read.notRead.length));
    return {
      data: {
        count: hits.length,
        checked: kept.length,
        metaGets: read.metaGets,
        notRead: read.notRead.length,
        message: lines.join(" "),
        adSets: hits,
        locationExpansion: { count: geoHits.length, notSet: geoNotSet, adSets: geoHits },
      },
      eventId: eventIds?.length === 1 ? eventIds[0] : null,
      clientId,
      summary: {
        ...summaryBase,
        metaGets: read.metaGets,
        hits: hits.length,
        geoHits: geoHits.length,
        geoNotSet,
        notRead: read.notRead.length,
        adSetIds: hits.map((h) => h.adSet.id),
        geoAdSetIds: geoHits.map((h) => h.adSet.id),
      },
    };
  },
};
