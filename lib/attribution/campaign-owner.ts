/**
 * lib/attribution/campaign-owner.ts
 *
 * Which event a platform campaign belongs to (dashboard v2, HN2).
 *
 * 1. An override (campaign_event_overrides, migration 240) wins: the
 *    campaign counts for the event it names, and for no other.
 * 2. Otherwise the name: it carries the event's code in brackets, matched
 *    case-insensitively, with en and em dashes read as hyphens, and a
 *    closing "[" accepted for "]" ("[NX26-ROBBIEDOHERTY[ Signup" is
 *    Robbie Doherty's). The code must end at the bracket, so "[NX26-DO]"
 *    never matches NX26-DOD.
 *
 *    Case is ignored unless two of the events in play have codes that differ
 *    only by case (prod has UTB0046-New and UTB0046-NEW, two events): those
 *    codes match exactly as written, so neither takes the other's campaigns.
 *    The shared Meta rollup matcher (lib/insights/meta-event-code-match.ts)
 *    stays case-sensitive for the same reason; TikTok's was already
 *    case-insensitive.
 *
 * Relative imports only: the `node --test` runner can't resolve `@/`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { loadAllPaged } from "../db/paged-read.ts";

export type AdPlatform = "meta" | "tiktok" | "google";

/** campaign id → event id, for one platform. */
export type CampaignOverrides = ReadonlyMap<string, string>;

export const NO_OVERRIDES: CampaignOverrides = new Map();

function normalise(text: string): string {
  return text.replace(/[–—−]/g, "-").toLowerCase();
}

/** The name carries "[CODE]" (or the "[CODE[" typo); case-insensitive unless `exactCase`. */
export function nameCarriesCode(campaignName: string, eventCode: string, opts: { exactCase?: boolean } = {}): boolean {
  const dashes = (t: string) => t.replace(/[\u2013\u2014\u2212]/g, "-");
  const code = opts.exactCase ? dashes(eventCode.trim()) : normalise(eventCode.trim());
  if (!code) return false;
  const name = opts.exactCase ? dashes(campaignName) : normalise(campaignName);
  return name.includes(`[${code}]`) || name.includes(`[${code}[`);
}

/** Lower-cased codes that two or more of `codes` share: these match exactly as written. */
export function caseCollisions(codes: readonly string[]): Set<string> {
  const seen = new Map<string, Set<string>>();
  for (const c of codes) {
    const k = c.trim().toLowerCase();
    seen.set(k, (seen.get(k) ?? new Set()).add(c.trim()));
  }
  return new Set([...seen].filter(([, v]) => v.size > 1).map(([k]) => k));
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
  collisions: ReadonlySet<string> = caseCollisions(events.map((e) => e.code)),
): T | null {
  const owner = overrides.get(campaign.id);
  if (owner != null) return events.find((e) => e.eventId === owner) ?? null;
  return events.find((e) => nameCarriesCode(campaign.name, e.code, { exactCase: collisions.has(e.code.trim().toLowerCase()) })) ?? null;
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
