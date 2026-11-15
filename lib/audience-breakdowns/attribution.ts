/**
 * lib/audience-breakdowns/attribution.ts
 *
 * Which show a breakdown row belongs to. No new matcher: Meta uses the
 * dashboard's D1 rule (lib/dashboard/sales-calc/figures.ts
 * metaCampaignOwners: override, then events.meta_campaign_id, then the
 * "[CODE]" exactly as written); TikTok uses lib/attribution/campaign-owner.ts
 * campaignOwner (override, then the "[CODE]"), as the TikTok rollup leg does.
 *
 * Shows of archived clients are left out (lib/db/client-status.ts), so their
 * campaigns attribute to nothing, and their accounts are not read.
 *
 * Relative imports only: the `node --test` runner can't resolve `@/`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { campaignOwner, loadCampaignOverrides } from "../attribution/campaign-owner.ts";
import { loadArchivedClientIds } from "../db/client-status.ts";
import { loadAllPaged } from "../db/paged-read.ts";
import { metaCampaignOwners, orderShows } from "../dashboard/sales-calc/figures.ts";

type Db = Pick<SupabaseClient, "from">;

export type BreakdownShow = {
  eventId: string;
  clientId: string | null;
  code: string;
  /** event_date, or "9999-12-31" when unset, for show order. */
  showDate: string;
  linkedCampaignIds: string[];
  metaAdAccountId: string | null;
  /** The event's own TikTok account, else its client's. */
  tiktokAccountId: string | null;
};

export type BreakdownScope = {
  shows: BreakdownShow[];
  metaOverrides: Record<string, string>;
  tiktokOverrides: Map<string, string>;
  /** Client id → its Meta account and TikTok account, for non-archived clients. */
  clients: Map<string, { metaAdAccountId: string | null; tiktokAccountId: string | null }>;
  archivedClients: number;
};

const NO_DATE = "9999-12-31";

export function splitCampaignIds(raw: string | null | undefined): string[] {
  return (raw ?? "").split(",").map((id) => id.trim()).filter(Boolean);
}

/** Every show with a code whose client isn't archived (a show with no client counts as active), plus both platforms' overrides. Throws on a read error. */
export async function loadBreakdownScope(db: Db): Promise<BreakdownScope> {
  const archived = await loadArchivedClientIds(db);
  const [events, clients, metaOverrides, tiktokOverrides] = await Promise.all([
    loadAllPaged<{
      id: string;
      client_id: string | null;
      event_code: string | null;
      event_date: string | null;
      meta_campaign_id: string | null;
      meta_ad_account_id: string | null;
      tiktok_account_id: string | null;
    }>(db, "events", "id,client_id,event_code,event_date,meta_campaign_id,meta_ad_account_id,tiktok_account_id", ["id"], (q) =>
      q.not("event_code", "is", null),
    ),
    loadAllPaged<{ id: string; meta_ad_account_id: string | null; tiktok_account_id: string | null }>(
      db,
      "clients",
      "id,meta_ad_account_id,tiktok_account_id",
      ["id"],
    ),
    loadCampaignOverrides(db, "meta"),
    loadCampaignOverrides(db, "tiktok"),
  ]);
  const clientMap = new Map<string, { metaAdAccountId: string | null; tiktokAccountId: string | null }>();
  for (const c of clients) {
    if (archived.has(c.id)) continue;
    clientMap.set(c.id, { metaAdAccountId: c.meta_ad_account_id, tiktokAccountId: c.tiktok_account_id });
  }
  const shows: BreakdownShow[] = [];
  for (const e of events) {
    if (!e.event_code?.trim()) continue;
    if (e.client_id && archived.has(e.client_id)) continue;
    const client = e.client_id ? clientMap.get(e.client_id) : undefined;
    shows.push({
      eventId: e.id,
      clientId: e.client_id,
      code: e.event_code,
      showDate: e.event_date ?? NO_DATE,
      linkedCampaignIds: splitCampaignIds(e.meta_campaign_id),
      metaAdAccountId: e.meta_ad_account_id ?? client?.metaAdAccountId ?? null,
      tiktokAccountId: e.tiktok_account_id ?? client?.tiktokAccountId ?? null,
    });
  }
  return {
    shows: orderShows(shows),
    metaOverrides: Object.fromEntries(metaOverrides),
    tiktokOverrides: tiktokOverrides,
    clients: clientMap,
    archivedClients: archived.size,
  };
}

/** What the owner rules read off a show. */
export type OwnerShow = Pick<BreakdownShow, "eventId" | "code" | "showDate" | "linkedCampaignIds">;

/** Campaign id → show id for the Meta campaigns named in `names` (id → campaign name). */
export function metaOwners(scope: { shows: readonly OwnerShow[]; metaOverrides: Readonly<Record<string, string>> }, names: ReadonlyMap<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [id, owner] of metaCampaignOwners(scope.shows, names, scope.metaOverrides)) out.set(id, owner.eventId);
  return out;
}

/** Campaign id → show id for TikTok campaigns: override, else the [CODE]. A campaign with no name and no override has no owner. */
export function tiktokOwners(scope: { shows: readonly OwnerShow[]; tiktokOverrides: ReadonlyMap<string, string> }, names: ReadonlyMap<string, string>, ids: Iterable<string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const id of ids) {
    const override = scope.tiktokOverrides.get(id);
    if (override == null && !names.has(id)) continue;
    const owner = campaignOwner(scope.shows, { id, name: names.get(id) ?? "" }, scope.tiktokOverrides);
    if (owner) out.set(id, owner.eventId);
  }
  return out;
}

/**
 * Does a stored row still belong to `eventId` by today's rule? Used by the
 * readers, so an override added after the row was written moves it.
 * Meta: override, else the stored event_id (written by the link-or-code
 * rule). TikTok: override, else the stored event_id.
 */
export function rowBelongsTo(
  eventId: string,
  row: { campaignId: string; storedEventId: string | null },
  overrides: ReadonlyMap<string, string> | Readonly<Record<string, string>>,
): boolean {
  const override = overrides instanceof Map ? overrides.get(row.campaignId) : (overrides as Record<string, string>)[row.campaignId];
  if (override != null) return override === eventId;
  return row.storedEventId === eventId;
}
