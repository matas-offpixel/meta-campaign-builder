/**
 * lib/attribution/campaign-owner.ts
 *
 * Which event a platform campaign belongs to (dashboard v2, HN2).
 *
 * 1. An override (campaign_event_overrides, migration 240) wins: the
 *    campaign counts for the event it names, and for no other.
 * 2. Otherwise the name carries "[CODE]" exactly as the event's code is
 *    written: same case, same characters, both brackets. Nothing is
 *    normalised (Matas, 14 Nov). A campaign named "[NX26-Locklead]", or
 *    "[NX26-ROBBIEDOHERTY[", or with no code at all, needs an override row.
 *
 * Relative imports only: the `node --test` runner can't resolve `@/`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { loadAllPaged } from "../db/paged-read.ts";

export type AdPlatform = "meta" | "tiktok" | "google";

/** campaign id → event id, for one platform. */
export type CampaignOverrides = ReadonlyMap<string, string>;

export const NO_OVERRIDES: CampaignOverrides = new Map();

/** The name carries "[CODE]" exactly as written. No case folding, no dash folding, no "[CODE[". */
export function nameCarriesCode(campaignName: string, eventCode: string): boolean {
  if (!eventCode) return false;
  return campaignName.includes(`[${eventCode}]`);
}

/** Override first, then the name. */
export function campaignBelongsTo(
  event: { eventId: string; code: string },
  campaign: { id: string; name: string },
  overrides: CampaignOverrides,
  matchName: (name: string, code: string) => boolean = nameCarriesCode,
): boolean {
  const owner = overrides.get(campaign.id);
  if (owner != null) return owner === event.eventId;
  return matchName(campaign.name, event.code);
}

/**
 * The first event (in the given order) a campaign belongs to: its override,
 * else the first whose code its name carries. Null when none.
 */
export function campaignOwner<T extends { eventId: string; code: string }>(
  events: readonly T[],
  campaign: { id: string; name: string },
  overrides: CampaignOverrides,
): T | null {
  const owner = overrides.get(campaign.id);
  if (owner != null) return events.find((e) => e.eventId === owner) ?? null;
  return events.find((e) => nameCarriesCode(campaign.name, e.code)) ?? null;
}

type Db = Pick<SupabaseClient, "from">;

/** Missing table (migration 240 not applied) reads as no overrides. */
export function isMissingOverridesTable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /campaign_event_overrides/.test(message) && /(does not exist|schema cache|not find)/i.test(message);
}

/** Every override for a platform the caller can read. Paged, ordered by the key, deduped. */
export async function loadCampaignOverrides(sb: Db, platform: AdPlatform): Promise<Map<string, string>> {
  try {
    const rows = await loadAllPaged<{ platform: string; campaign_id: string; event_id: string }>(
      sb,
      "campaign_event_overrides",
      "platform,campaign_id,event_id",
      ["platform", "campaign_id"],
      (q) => q.eq("platform", platform),
    );
    return new Map(rows.map((r) => [r.campaign_id, r.event_id]));
  } catch (error) {
    if (isMissingOverridesTable(error)) return new Map();
    throw error;
  }
}
