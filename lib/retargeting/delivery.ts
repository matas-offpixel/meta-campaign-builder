/**
 * HR4 — what the daily read asks Meta about a running `{code} · Retargeting`
 * campaign (docs/design-record/2026-11-17-retargeting-campaign.html, RT3,
 * RT5, RT9). Reads only, one attempt each, counted:
 *
 *   1. GET /{campaign}  effective_status, and its ad sets' id, name,
 *      daily_budget and effective_status (the tiers, by RT1's names);
 *   2. GET /{campaign}/insights  level=adset over the 7 days: frequency;
 *   3. GET /{adset}/delivery_estimate  per tier: Meta's pool band for the
 *      ad set's targeting with its exclusions applied.
 *
 * Spend and attributed purchases come from ad_daily_insights (the app's
 * ledger), not from here. A failed read leaves its figure null; the panel
 * shows "—" for it.
 */

import type { GraphGet } from "../onsale-refresh/purchase-read.ts";
import { poolBand, tierAdSetName, TIERS, type Tier } from "./words.ts";

export type RunningTier = { adsetId: string; dailyMinor: number | null; effectiveStatus: string | null; frequency: number | null; pool: string | null };

export type RunningRead = {
  /** The campaign's effective_status; null when the read failed. */
  status: string | null;
  tiers: Partial<Record<Tier, RunningTier>>;
  calls: number;
  errors: string[];
};

const num = (value: unknown): number | null => {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) ? n : null;
};
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The tier an ad set belongs to, by RT1's name; else by the ids the Create line stored. */
export function tierOf(name: string | null | undefined, adsetId: string, code: string, known: Partial<Record<Tier, string>>): Tier | null {
  const value = (name ?? "").trim().toLowerCase();
  // Longest name first: "· Mid Bottom" also ends "· Mid …" otherwise.
  for (const tier of [...TIERS].sort((a, b) => tierAdSetName(code, b).length - tierAdSetName(code, a).length)) {
    if (value === tierAdSetName(code, tier).toLowerCase()) return tier;
  }
  for (const tier of TIERS) if (known[tier] === adsetId) return tier;
  return null;
}

/** Delivering means Meta says ACTIVE; anything else is off (RT9: "{code} · Retargeting is off."). */
export function isOff(status: string | null): boolean {
  return status != null && status !== "ACTIVE";
}

export function deliveryBand(body: unknown): string | null {
  const row = (body as { data?: { estimate_ready?: boolean; estimate_mau_lower_bound?: unknown; estimate_mau_upper_bound?: unknown }[] } | null)?.data?.[0];
  if (!row || row.estimate_ready === false) return null;
  const lower = num(row.estimate_mau_lower_bound);
  const upper = num(row.estimate_mau_upper_bound);
  if (lower == null || upper == null) return null;
  return poolBand(lower, upper);
}

export async function readRunning(graphGet: GraphGet, args: { campaignId: string; code: string; since: string; until: string; known?: Partial<Record<Tier, string>> }): Promise<RunningRead> {
  const out: RunningRead = { status: null, tiers: {}, calls: 0, errors: [] };
  const known = args.known ?? {};
  try {
    out.calls += 1;
    const body = (await graphGet(`/${args.campaignId}`, { fields: "effective_status,adsets.limit(25){id,name,daily_budget,effective_status}" })) as {
      effective_status?: string;
      adsets?: { data?: { id: string; name?: string; daily_budget?: string | number; effective_status?: string }[] };
    };
    out.status = body.effective_status ?? null;
    for (const set of body.adsets?.data ?? []) {
      const tier = tierOf(set.name, set.id, args.code, known);
      if (!tier || out.tiers[tier]) continue;
      out.tiers[tier] = { adsetId: set.id, dailyMinor: num(set.daily_budget), effectiveStatus: set.effective_status ?? null, frequency: null, pool: null };
    }
  } catch (err) {
    out.errors.push(`campaign: ${message(err)}`);
    return out;
  }
  try {
    out.calls += 1;
    const body = (await graphGet(`/${args.campaignId}/insights`, { level: "adset", fields: "adset_id,frequency", time_range: JSON.stringify({ since: args.since, until: args.until }), limit: "25" })) as { data?: { adset_id?: string; frequency?: string | number }[] };
    for (const row of body.data ?? []) {
      const tier = TIERS.find((name) => out.tiers[name]?.adsetId === row.adset_id);
      const frequency = num(row.frequency);
      if (tier && frequency != null) out.tiers[tier]!.frequency = frequency;
    }
  } catch (err) {
    out.errors.push(`insights: ${message(err)}`);
  }
  for (const tier of TIERS) {
    const row = out.tiers[tier];
    if (!row) continue;
    try {
      out.calls += 1;
      row.pool = deliveryBand(await graphGet(`/${row.adsetId}/delivery_estimate`, { optimization_goal: "OFFSITE_CONVERSIONS" }));
    } catch (err) {
      out.errors.push(`delivery_estimate ${tier}: ${message(err)}`);
    }
  }
  return out;
}
