/**
 * Campaign-first scan for the unmatched [CODE] guard.
 * Read-only Meta insights + event catalog. No writes to Meta.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  UNMATCHED_CAMPAIGN_SNAPSHOT_KEY,
  UNMATCHED_CAMPAIGN_SPEND_PRESET,
  evaluateUnmatchedCampaigns,
  notifyUnmatchedCampaigns,
  type CampaignSpendRow,
  type EventCodeCatalogRow,
  type UnmatchedCampaignFinding,
} from "@/lib/insights/unmatched-campaign-code";
import { withActPrefix } from "@/lib/meta/ad-account-id";
import { graphGetWithToken } from "@/lib/meta/client";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import type { NotifyOptions, NotifyResult } from "@/lib/notify/slack";

export interface AdAccountScanTarget {
  adAccountId: string;
  userId: string;
}

export type CampaignSpendFetcher = (
  adAccountId: string,
  token: string,
) => Promise<CampaignSpendRow[]>;

interface InsightsPage {
  data?: Array<{
    campaign_id?: string;
    campaign_name?: string;
    spend?: string;
  }>;
  paging?: { cursors?: { after?: string }; next?: string };
}

export async function fetchAccountCampaignSpend(
  adAccountId: string,
  token: string,
): Promise<CampaignSpendRow[]> {
  const accountPath = withActPrefix(adAccountId);
  const rows: CampaignSpendRow[] = [];
  let after: string | undefined;
  for (let page = 0; page < 10; page++) {
    const params: Record<string, string> = {
      fields: "campaign_id,campaign_name,spend",
      date_preset: UNMATCHED_CAMPAIGN_SPEND_PRESET,
      level: "campaign",
      limit: "200",
    };
    if (after) params.after = after;
    const res = await graphGetWithToken<InsightsPage>(
      `/${accountPath}/insights`,
      params,
      token,
      { maxAttempts: 1 },
    );
    for (const raw of res.data ?? []) {
      if (!raw.campaign_id || !raw.campaign_name) continue;
      const spendMajor = Number.parseFloat(raw.spend ?? "");
      rows.push({
        campaignId: raw.campaign_id,
        campaignName: raw.campaign_name,
        adAccountId: accountPath,
        spendMajor: Number.isFinite(spendMajor) ? spendMajor : 0,
      });
    }
    after = res.paging?.cursors?.after;
    if (!res.paging?.next || !after) break;
  }
  return rows;
}

export async function loadEventCodeCatalog(
  supabase: SupabaseClient,
): Promise<EventCodeCatalogRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as any;
  const { data, error } = await sb
    .from("events")
    .select("event_code, status")
    .not("event_code", "is", null)
    .neq("event_code", "");
  if (error) {
    throw new Error(`loadEventCodeCatalog: ${error.message}`);
  }
  const rows = (data ?? []) as Array<{ event_code: string | null; status: string | null }>;
  return rows
    .map((row) => ({
      eventCode: (row.event_code ?? "").trim(),
      status: row.status,
    }))
    .filter((row) => row.eventCode.length > 0);
}

export async function persistUnmatchedCampaignSnapshot(
  supabase: SupabaseClient,
  findings: readonly UnmatchedCampaignFinding[],
  scannedAt: string,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as any;
  const { error } = await sb.from("notification_dedupe_state").upsert({
    dedupe_key: UNMATCHED_CAMPAIGN_SNAPSHOT_KEY,
    last_fired_at: scannedAt,
    fire_count: 1,
    data: { scannedAt, findings },
  });
  if (error) {
    throw new Error(`persistUnmatchedCampaignSnapshot: ${error.message}`);
  }
}

export async function runUnmatchedCampaignCodeGuard(args: {
  supabase: SupabaseClient;
  accounts: readonly AdAccountScanTarget[];
  notify: (opts: NotifyOptions) => Promise<NotifyResult>;
  fetchSpend?: CampaignSpendFetcher;
  now?: Date;
}): Promise<{
  accountsScanned: number;
  campaignsConsidered: number;
  findings: UnmatchedCampaignFinding[];
  alarmed: number;
  sent: number;
}> {
  const catalog = await loadEventCodeCatalog(args.supabase);
  const seenAccounts = new Set<string>();
  const campaigns: CampaignSpendRow[] = [];
  const fetchSpend = args.fetchSpend ?? fetchAccountCampaignSpend;

  for (const account of args.accounts) {
    const key = withActPrefix(account.adAccountId);
    if (!account.adAccountId || seenAccounts.has(key)) continue;
    seenAccounts.add(key);
    try {
      const { token } = await resolveServerMetaToken(args.supabase, account.userId);
      const rows = await fetchSpend(account.adAccountId, token);
      campaigns.push(...rows);
    } catch (err) {
      console.warn(
        `[unmatched-campaign-code] account=${key} scan failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  const findings = evaluateUnmatchedCampaigns(campaigns, catalog);
  const { alarmed, sent } = await notifyUnmatchedCampaigns(findings, args.notify);
  const scannedAt = (args.now ?? new Date()).toISOString();
  try {
    await persistUnmatchedCampaignSnapshot(args.supabase, findings, scannedAt);
  } catch (err) {
    console.warn(
      `[unmatched-campaign-code] snapshot persist failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  return {
    accountsScanned: seenAccounts.size,
    campaignsConsidered: campaigns.length,
    findings,
    alarmed,
    sent,
  };
}
