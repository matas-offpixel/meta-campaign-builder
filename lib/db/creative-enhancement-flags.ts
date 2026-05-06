/**
 * lib/db/creative-enhancement-flags.ts
 *
 * Read helpers for creative_enhancement_flags — callers must enforce
 * client ownership (service-role + explicit check).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { FlaggedFeatureMap } from "@/lib/meta/enhancement-policy";

export interface EnhancementFlagRow {
  id: string;
  ad_id: string;
  ad_name: string | null;
  creative_id: string;
  flagged_features: FlaggedFeatureMap;
  severity_score: number;
  scanned_at: string;
  event_id: string | null;
  campaign_id: string | null;
  ad_account_id: string;
}

export interface EnhancementFlagsApiPayload {
  open_flags: Array<
    EnhancementFlagRow & {
      event_name: string | null;
    }
  >;
  total_open: number;
  total_severity: number;
  standard_enhancements_count: number;
  last_scan_at: string | null;
}

function parseFlaggedFeatures(raw: unknown): FlaggedFeatureMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: FlaggedFeatureMap = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === "OPT_IN" || v === "DEFAULT_OPT_IN") {
      out[k] = v;
    }
  }
  return out;
}

export async function fetchEnhancementFlagsForClient(
  admin: SupabaseClient,
  params: {
    clientId: string;
    /** When set, only flags tied to these events (excludes null event_id). */
    eventIds?: readonly string[] | null;
    limit?: number;
    /** When true, include tracked-only rows (e.g. inline_comment–only) in results and totals. */
    includeTracked?: boolean;
  },
): Promise<EnhancementFlagsApiPayload> {
  const limit = Math.min(Math.max(1, params.limit ?? 200), 200);

  const { data: lastScanRow } = await admin
    .from("creative_enhancement_flags")
    .select("scanned_at")
    .eq("client_id", params.clientId)
    .order("scanned_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const eventIds = params.eventIds?.filter(Boolean) ?? [];

  let query = admin
    .from("creative_enhancement_flags")
    .select(
      "id, ad_id, ad_name, creative_id, flagged_features, severity_score, scanned_at, event_id, campaign_id, ad_account_id, events(name)",
    )
    .eq("client_id", params.clientId)
    .is("resolved_at", null);

  if (!params.includeTracked) {
    query = query.eq("tracked_only", false);
  }

  if (eventIds.length > 0) {
    query = query.in("event_id", [...eventIds]);
  }

  const { data: rows, error } = await query
    .order("severity_score", { ascending: false })
    .order("scanned_at", { ascending: false });
  if (error) throw new Error(error.message);

  const allRows = rows ?? [];
  let total_severity = 0;
  let standard_enhancements_count = 0;

  for (const row of allRows) {
    const ev = row as unknown as {
      severity_score: number;
      flagged_features: unknown;
    };
    total_severity += ev.severity_score;
    const flagged_features = parseFlaggedFeatures(ev.flagged_features);
    if (
      flagged_features.standard_enhancements === "OPT_IN" ||
      flagged_features.standard_enhancements === "DEFAULT_OPT_IN"
    ) {
      standard_enhancements_count += 1;
    }
  }

  const open_flags: EnhancementFlagsApiPayload["open_flags"] = [];
  for (const row of allRows.slice(0, limit)) {
    const ev = row as unknown as {
      id: string;
      ad_id: string;
      ad_name: string | null;
      creative_id: string;
      flagged_features: unknown;
      severity_score: number;
      scanned_at: string;
      event_id: string | null;
      campaign_id: string | null;
      ad_account_id: string;
      events: { name: string } | null | { name: string }[];
    };
    const flagged_features = parseFlaggedFeatures(ev.flagged_features);
    const eventRel = ev.events;
    const event_name = Array.isArray(eventRel)
      ? (eventRel[0]?.name ?? null)
      : (eventRel?.name ?? null);

    open_flags.push({
      id: ev.id,
      ad_id: ev.ad_id,
      ad_name: ev.ad_name,
      creative_id: ev.creative_id,
      flagged_features,
      severity_score: ev.severity_score,
      scanned_at: ev.scanned_at,
      event_id: ev.event_id,
      event_name,
      campaign_id: ev.campaign_id,
      ad_account_id: ev.ad_account_id,
    });
  }

  return {
    open_flags,
    total_open: allRows.length,
    total_severity,
    standard_enhancements_count,
    last_scan_at: lastScanRow?.scanned_at ?? null,
  };
}
