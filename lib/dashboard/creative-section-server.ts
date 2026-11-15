import "server-only";

/**
 * lib/dashboard/creative-section-server.ts
 *
 * Reads for the E4 creative section. Scores come from getCreativeScores
 * and are not recomputed. Spend and results are the ad-days already
 * stored, joined to the show the same way learning joins an ad. Tags,
 * TikTok snapshots, Lab renders and the refresh's pause lines come from
 * their own readers.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { loadAllPaged } from "@/lib/db/paged-read";
import { listCreativeTagAssignmentsByEvents } from "@/lib/db/creative-tags";
import { resolveAdContext, type AdContextIndex } from "@/lib/learning/ad-facts";
import { getCreativeScores } from "@/lib/learning/read";
import { normalizeAdAccountId, resolveEventAdAccountId } from "@/lib/meta/ad-account";
import { isOnSale, isShowWeek } from "@/lib/onsale-refresh/on-sale";
import { loadEventProposals } from "@/lib/onsale-refresh/read";
import { todayLondon } from "@/lib/onsale-refresh/schedule";
import { readActiveTikTokCreativesSnapshot } from "@/lib/tiktok/snapshots";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { SalesDashboardModel, SalesSurface } from "@/lib/dashboard/sales-vs-spend";

import { scopesForViews, VENUE_NOT_SET_VIEW, type PanelShow, type PanelVenue } from "./audience-panels";
import { buildCreativeSection, type CreativeDay, type CreativeSectionModel, type CreativeTagRef, type TikTokRef } from "./creative-section";
import { creativeObjective } from "./creative-section-objective";

export type CreativeByView = Record<string, CreativeSectionModel>;

const SHARE_CACHE_MS = 5 * 60 * 1000;
const shareCache = new Map<string, { at: number; panels: CreativeByView }>();

type EventRow = {
  id: string;
  event_code: string | null;
  name: string | null;
  venue_key: string | null;
  status: string | null;
  event_date: string | null;
  general_sale_at: string | null;
  meta_ad_account_id: string | null;
  client_id: string | null;
};

type InsightRow = {
  id: string;
  ad_account_id: string;
  meta_ad_id: string;
  meta_adset_id: string | null;
  ad_name: string | null;
  campaign_name: string | null;
  spend: number | string | null;
  impressions: number | null;
  clicks: number | null;
  registrations: number | null;
  purchases: number | null;
  campaign_objective: string | null;
  optimization_goal: string | null;
  promoted_event: string | null;
};

function viewsOf(model: SalesDashboardModel): { viewIds: string[]; venues: PanelVenue[] } {
  const venues: PanelVenue[] = (model.venues ?? []).map((v) => ({ key: v.key, name: v.name, viewId: v.viewId }));
  if (model.views[VENUE_NOT_SET_VIEW] && !venues.some((v) => v.viewId === VENUE_NOT_SET_VIEW)) {
    venues.push({ key: null, name: "Venue not set", viewId: VENUE_NOT_SET_VIEW });
  }
  return { viewIds: Object.keys(model.views), venues };
}

function accountIds(raw: readonly (string | null)[]): string[] {
  const out = new Set<string>();
  for (const value of raw) {
    if (!value) continue;
    out.add(value);
    const act = normalizeAdAccountId(value);
    if (!act) continue;
    out.add(act);
    out.add(act.slice(4));
  }
  return [...out];
}

async function tiktokFor(eventId: string, service: SupabaseClient): Promise<TikTokRef[]> {
  const { data, error } = await service
    .from("tiktok_active_creatives_snapshots")
    .select("window_since, window_until, fetched_at")
    .eq("event_id", eventId)
    .eq("kind", "ok")
    .order("fetched_at", { ascending: false })
    .limit(1);
  if (error || !data?.length) return [];
  const window = data[0] as { window_since: string; window_until: string };
  const snapshot = await readActiveTikTokCreativesSnapshot(service, eventId, { since: window.window_since, until: window.window_until });
  if (!snapshot) return [];
  return snapshot.rows.map((row) => ({
    name: row.ad_name,
    spend: Number(row.cost) || 0,
    impressions: Number(row.impressions) || 0,
    clicks: Number(row.clicks_all) || 0,
    views2s: Number(row.video_views_2s) || 0,
    viewsFull: Number(row.video_views_p100) || 0,
  }));
}

async function load(
  db: SupabaseClient,
  service: SupabaseClient,
  clientId: string,
  model: SalesDashboardModel,
  surface: SalesSurface,
): Promise<CreativeByView | null> {
  try {
    const today = todayLondon(new Date());
    const [events, client] = await Promise.all([
      loadAllPaged<EventRow>(db, "events", "id, event_code, name, venue_key, status, event_date, general_sale_at, meta_ad_account_id, client_id", ["id"], (q) => q.eq("client_id", clientId)),
      loadAllPaged<{ id: string; meta_ad_account_id: string | null; name: string | null }>(db, "clients", "id, meta_ad_account_id, name", ["id"], (q) => q.eq("id", clientId)),
    ]);
    const eventIds = events.map((event) => event.id);
    if (!eventIds.length) return {};
    const clientAccount = client[0]?.meta_ad_account_id ?? null;
    const accounts = accountIds(events.map((event) => resolveEventAdAccountId(event, clientAccount)));
    const [ads, adSets, insights, assignments, clips] = await Promise.all([
      loadAllPaged<{ id: string; meta_ad_id: string; client_id: string | null; event_id: string | null }>(db, "launched_ads", "id, meta_ad_id, client_id, event_id", ["id"], (q) => q.in("event_id", eventIds)),
      loadAllPaged<{ id: string; meta_adset_id: string; client_id: string | null; event_id: string | null }>(db, "launched_ad_sets", "id, meta_adset_id, client_id, event_id", ["id"], (q) => q.in("event_id", eventIds)),
      accounts.length
        ? loadAllPaged<InsightRow>(
            db,
            "ad_daily_insights",
            "id, ad_account_id, meta_ad_id, meta_adset_id, ad_name, campaign_name, spend, impressions, clicks, registrations, purchases, campaign_objective, optimization_goal, promoted_event",
            ["id"],
            (q) => q.in("ad_account_id", accounts),
          )
        : Promise.resolve([] as InsightRow[]),
      listCreativeTagAssignmentsByEvents(db, eventIds),
      loadAllPaged<{ id: string; event_id: string | null }>(db, "creative_lab_clips", "id, event_id", ["id"], (q) => q.in("event_id", eventIds)),
    ]);
    const clipIds = clips.map((clip) => clip.id);
    const renders = clipIds.length
      ? await loadAllPaged<{ id: string; clip_id: string; drive_file_id: string | null; drive_file_name: string | null }>(
          db,
          "creative_lab_renders",
          "id, clip_id, drive_file_id, drive_file_name",
          ["id"],
          (q) => q.in("clip_id", clipIds).not("drive_file_id", "is", null),
        )
      : [];
    const clipEvent = new Map(clips.map((clip) => [clip.id, clip.event_id]));
    const index: AdContextIndex = {
      launchedAds: new Map(ads.map((row) => [row.meta_ad_id, { clientId: row.client_id, eventId: row.event_id }])),
      launchedAdSets: new Map(adSets.map((row) => [row.meta_adset_id, { clientId: row.client_id, eventId: row.event_id }])),
      codedEvents: events
        .filter((event) => event.event_code?.trim())
        .map((event) => ({
          eventId: event.id,
          clientId: event.client_id,
          eventCode: event.event_code!.trim(),
          adAccountId: normalizeAdAccountId(resolveEventAdAccountId(event, clientAccount)),
        })),
    };
    const eventIdSet = new Set(eventIds);
    const daysByEvent = new Map<string, CreativeDay[]>();
    for (const row of insights) {
      const name = row.ad_name?.trim();
      if (!name) continue;
      const resolved = resolveAdContext(row, index);
      if (!resolved.eventId || !eventIdSet.has(resolved.eventId)) continue;
      const list = daysByEvent.get(resolved.eventId) ?? [];
      list.push({
        eventId: resolved.eventId,
        name,
        objective: creativeObjective({
          campaignObjective: row.campaign_objective,
          optimizationGoal: row.optimization_goal,
          promotedEvent: row.promoted_event,
        }),
        spend: Number(row.spend) || 0,
        impressions: Number(row.impressions) || 0,
        clicks: Number(row.clicks) || 0,
        signups: Number(row.registrations) || 0,
        purchases: Number(row.purchases) || 0,
        adId: row.meta_ad_id,
        adAccountId: row.ad_account_id,
      });
      daysByEvent.set(resolved.eventId, list);
    }
    const scores = await Promise.all(eventIds.map(async (eventId) => ({ eventId, scores: await getCreativeScores(db, eventId) })));
    const scoredByEvent = new Map(scores.map((row) => [row.eventId, row.scores.creatives.map((creative) => creative.creativeName)]));
    const tagsByEvent = new Map<string, CreativeTagRef[]>();
    for (const assignment of assignments) {
      const dimension = assignment.tag?.dimension;
      const label = assignment.tag?.value_label;
      if (!dimension || !label) continue;
      const list = tagsByEvent.get(assignment.event_id) ?? [];
      list.push({ eventId: assignment.event_id, name: assignment.creative_name, dimension, label });
      tagsByEvent.set(assignment.event_id, list);
    }
    const onSale = events.filter((event) => isOnSale(event, today) && !isShowWeek(event.event_date, today));
    const pauses = await Promise.all(
      onSale.map(async (event) => {
        const proposals = await loadEventProposals(db, event.id);
        const lines = proposals.flatMap((proposal) => proposal.lines.filter((line) => line.kind === "pause_creative").map((line) => ({ eventId: event.id, lineId: line.id, name: line.title })));
        return { eventId: event.id, lines };
      }),
    );
    const pauseByEvent = new Map(pauses.map((row) => [row.eventId, row.lines]));
    const tiktok = await Promise.all(eventIds.map(async (eventId) => ({ eventId, rows: await tiktokFor(eventId, service) })));
    const tiktokByEvent = new Map(tiktok.map((row) => [row.eventId, row.rows]));
    const shows: PanelShow[] = events.map((event) => ({ id: event.id, code: event.event_code, name: event.name ?? event.event_code ?? "—", venue_key: event.venue_key }));
    const scopes = scopesForViews(viewsOf(model).viewIds, viewsOf(model).venues, shows, model.clientName);
    const byView: CreativeByView = {};
    for (const [viewId, scope] of scopes) {
      const ids = scope.eventIds;
      const one = ids.length === 1 ? events.find((event) => event.id === ids[0]) : undefined;
      const refreshOn = Boolean(one && onSale.some((event) => event.id === one.id));
      const scored = ids.flatMap((eventId) => (scoredByEvent.get(eventId) ?? []).map((name) => ({ eventId, name })));
      const label = ids.length === 1 ? (one?.name ?? one?.event_code ?? model.clientName) : scope.d2c.label;
      byView[viewId] = buildCreativeSection({
        surface,
        label,
        scored,
        days: ids.flatMap((eventId) => daysByEvent.get(eventId) ?? []),
        tags: ids.flatMap((eventId) => tagsByEvent.get(eventId) ?? []),
        renders: renders.flatMap((render) => {
          const eventId = clipEvent.get(render.clip_id);
          if (!eventId || !ids.includes(eventId) || !render.drive_file_id || !render.drive_file_name) return [];
          return [{ eventId, name: render.drive_file_name, driveFileId: render.drive_file_id, renderId: render.id }];
        }),
        tiktok: ids.flatMap((eventId) => tiktokByEvent.get(eventId) ?? []),
        refreshOn,
        pauses: refreshOn && one ? pauseByEvent.get(one.id) ?? [] : [],
      });
    }
    return byView;
  } catch (error) {
    console.error("[creative-section] read failed", error);
    return null;
  }
}

export function loadInternalCreativeSection(sb: SupabaseClient, clientId: string, model: SalesDashboardModel): Promise<CreativeByView | null> {
  return load(sb, createServiceRoleClient(), clientId, model, "internal");
}

export async function loadShareCreativeSection(clientId: string, model: SalesDashboardModel, now = Date.now()): Promise<CreativeByView | null> {
  const cached = shareCache.get(clientId);
  if (cached && now - cached.at < SHARE_CACHE_MS) return cached.panels;
  const service = createServiceRoleClient();
  const panels = await load(service, service, clientId, model, "share");
  if (panels) shareCache.set(clientId, { at: now, panels });
  return panels;
}
