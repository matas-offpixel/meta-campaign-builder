/**
 * Join a Meta ad to its client and event.
 *
 * Order: launched_ads by meta_ad_id, then launched_ad_sets by
 * meta_adset_id, then the [EVENT_CODE] in campaign_name (how ads this
 * app did not launch reach an event). A ledger row that carries neither
 * a client nor an event falls through to the next source.
 *
 * A code that matches several events is narrowed to those on the row's
 * ad account; still not unique → null. Never guesses.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { campaignMatchesBracketedEventCode } from "../insights/meta-event-code-match.ts";
import { normalizeAdAccountId, resolveEventAdAccountId } from "../meta/ad-account.ts";

/**
 * Group ads by what they show, not by name. The same key the Meta import
 * uses to collapse one-object-per-ad duplicates into one creative.
 */
export { creativeContentKey, type CreativeContentSpec } from "../meta/import/content-key.ts";

export type AdContextSource = "launched_ads" | "launched_ad_sets" | "campaign_code";

export type AdContext = {
  clientId: string | null;
  eventId: string | null;
  source: AdContextSource | null;
};

export type AdFactRow = {
  meta_ad_id: string;
  meta_adset_id?: string | null;
  campaign_name?: string | null;
  ad_account_id?: string | null;
};

type Link = { clientId: string | null; eventId: string | null };

export type CodedEvent = {
  eventId: string;
  clientId: string | null;
  eventCode: string;
  adAccountId: string | null;
};

export type AdContextIndex = {
  launchedAds: ReadonlyMap<string, Link>;
  launchedAdSets: ReadonlyMap<string, Link>;
  codedEvents: readonly CodedEvent[];
};

const NONE: AdContext = { clientId: null, eventId: null, source: null };

function linked(link: Link | undefined): link is Link {
  return Boolean(link && (link.clientId || link.eventId));
}

export function resolveAdContext(row: AdFactRow, index: AdContextIndex): AdContext {
  const ad = index.launchedAds.get(row.meta_ad_id);
  if (linked(ad)) return { ...ad, source: "launched_ads" };

  const adSet = row.meta_adset_id ? index.launchedAdSets.get(row.meta_adset_id) : undefined;
  if (linked(adSet)) return { ...adSet, source: "launched_ad_sets" };

  const name = row.campaign_name ?? "";
  if (!name.includes("[")) return NONE;
  let matches = index.codedEvents.filter((e) => campaignMatchesBracketedEventCode(name, e.eventCode));
  if (matches.length > 1) {
    const account = normalizeAdAccountId(row.ad_account_id);
    matches = account ? matches.filter((e) => e.adAccountId === account) : [];
  }
  if (matches.length !== 1) return NONE;
  return { clientId: matches[0].clientId, eventId: matches[0].eventId, source: "campaign_code" };
}

async function loadAll<T>(db: SupabaseClient, table: string, columns: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...((data ?? []) as T[]));
    if ((data ?? []).length < 1000) break;
  }
  return rows;
}

/** Service-role read of the three join sources. */
export async function loadAdContextIndex(db: SupabaseClient): Promise<AdContextIndex> {
  type LedgerRow = { client_id: string | null; event_id: string | null };
  const [ads, adSets, events, clients] = await Promise.all([
    loadAll<LedgerRow & { meta_ad_id: string }>(db, "launched_ads", "meta_ad_id, client_id, event_id"),
    loadAll<LedgerRow & { meta_adset_id: string }>(db, "launched_ad_sets", "meta_adset_id, client_id, event_id"),
    loadAll<{ id: string; client_id: string | null; event_code: string | null; meta_ad_account_id: string | null }>(
      db,
      "events",
      "id, client_id, event_code, meta_ad_account_id",
    ),
    loadAll<{ id: string; meta_ad_account_id: string | null }>(db, "clients", "id, meta_ad_account_id"),
  ]);
  const clientAccount = new Map(clients.map((c) => [c.id, c.meta_ad_account_id]));
  return {
    launchedAds: new Map(ads.map((r) => [r.meta_ad_id, { clientId: r.client_id, eventId: r.event_id }])),
    launchedAdSets: new Map(adSets.map((r) => [r.meta_adset_id, { clientId: r.client_id, eventId: r.event_id }])),
    codedEvents: events
      .filter((e) => e.event_code?.trim())
      .map((e) => ({
        eventId: e.id,
        clientId: e.client_id,
        eventCode: e.event_code!.trim(),
        // NULL on the event inherits the client's account.
        adAccountId: normalizeAdAccountId(
          resolveEventAdAccountId(e, e.client_id ? clientAccount.get(e.client_id) : null),
        ),
      })),
  };
}
