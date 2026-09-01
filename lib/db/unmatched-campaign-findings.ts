/**
 * Read the last unmatched-campaign scan snapshot (written by the
 * rollup-sync-events guard into notification_dedupe_state).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  UNMATCHED_CAMPAIGN_SNAPSHOT_KEY,
  type UnmatchedCampaignFinding,
} from "@/lib/insights/unmatched-campaign-code";

export interface UnmatchedCampaignSnapshot {
  scannedAt: string | null;
  findings: UnmatchedCampaignFinding[];
}

export async function loadUnmatchedCampaignSnapshot(
  supabase: SupabaseClient,
): Promise<UnmatchedCampaignSnapshot> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as any;
  const { data, error } = await sb
    .from("notification_dedupe_state")
    .select("last_fired_at, data")
    .eq("dedupe_key", UNMATCHED_CAMPAIGN_SNAPSHOT_KEY)
    .maybeSingle();

  if (error || !data) {
    return { scannedAt: null, findings: [] };
  }

  const raw = data as {
    last_fired_at: string | null;
    data: { scannedAt?: string; findings?: UnmatchedCampaignFinding[] } | null;
  };
  const findings = Array.isArray(raw.data?.findings) ? raw.data.findings : [];
  return {
    scannedAt: raw.data?.scannedAt ?? raw.last_fired_at,
    findings,
  };
}
