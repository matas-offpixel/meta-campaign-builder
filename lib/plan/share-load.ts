/**
 * Server load for `/share/plan/[token]` after the token has resolved to a
 * plan id. Service-role, one plan, never the list. No Meta / TikTok / Google
 * calls. The URL credential is the token — never this plan id.
 */

import "server-only";

import { loadEventFunnelView } from "@/lib/db/event-funnel-load";
import { loadCampaignAutomationState } from "@/lib/db/campaign-automation";
import {
  loadChannelDefaultsForEvent,
  resolveChannelDefaults,
  type ResolvedChannelDefaults,
} from "@/lib/clients/channel-defaults";
import { loadEventThumbSources } from "@/lib/plan/event-artwork-load";
import { loadAdjustReads } from "@/lib/plan/adjust-reads";
import type { AdjustDecisionRow } from "@/lib/plan/adjust-face";
import { venueKey } from "@/lib/plan/venue-key";
import { todayIsoDate, type PlanEventOption } from "@/lib/plan/event-picker";
import { loadPlanLaunchRecords } from "@/lib/plan/load";
import { rowToCampaignPlanIntent } from "@/lib/plan/persist";
import { loadIdentityNameMap } from "@/lib/plan/identity-names-load";
import { loadLaunchRollupDays, loadPlanBenchmarkRows } from "@/lib/plan/launch-reads";
import { planLaunchedAt, planStampLondonDate } from "@/lib/plan/launch-face";
import { isPlanShareId } from "@/lib/plan/share-role";
import { loadPlanPredictions } from "@/lib/plan/predictions";
import type { CampaignPlan } from "@/lib/plan/types";
import type { IdentityNameMap } from "@/lib/plan/identity-chips";
import type { BenchmarkRow } from "@/lib/plan/benchmarks";
import type { CampaignPlanPrediction } from "@/lib/plan/learn-face";
import type { LaunchRollupDay } from "@/lib/plan/launch-face";
import type { AdjustWindowReads } from "@/lib/plan/adjust-face";
import type { EventFunnelView } from "@/lib/dashboard/event-funnel";

export type SharedPlanWorkspace = {
  plan: CampaignPlan;
  events: PlanEventOption[];
  tiktokAdvertiserId: string | null;
  identityNames: IdentityNameMap;
  funnel: EventFunnelView | null;
  liveSpend: number | null;
  adjustReads: AdjustWindowReads | null;
  thumbUrl: string | null;
  rollupDays: LaunchRollupDay[];
  predictions: CampaignPlanPrediction[];
  benchmarkRows: BenchmarkRow[];
  resolved: ResolvedChannelDefaults | null;
  decisions: AdjustDecisionRow[];
};

export async function loadSharedPlanWorkspace(
  supabase: unknown,
  planId: string,
): Promise<SharedPlanWorkspace | null> {
  if (!isPlanShareId(planId)) return null;
  const client = supabase as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, value: string) => {
          maybeSingle: () => Promise<{
            data: Record<string, unknown> | null;
            error: { message?: string } | null;
          }>;
          order?: (col: string, opts: { ascending: boolean }) => Promise<{
            data: Array<Record<string, unknown>> | null;
            error: { message?: string } | null;
          }>;
        };
      };
    };
  };

  const { data, error } = await client.from("campaign_plans").select("*").eq("id", planId).maybeSingle();
  if (error || !data) return null;

  const row = data as {
    id: string;
    user_id: string;
    name: string | null;
    status: CampaignPlan["status"];
    created_at: string;
    updated_at: string;
  } & Parameters<typeof rowToCampaignPlanIntent>[0];

  const plan: CampaignPlan = {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    status: row.status,
    intent: rowToCampaignPlanIntent(row),
    launches: await loadPlanLaunchRecords(supabase, row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  const eventId = plan.intent.eventId;
  const { data: eventRow } = eventId
    ? await client
        .from("events")
        .select(
          "id, name, client_id, event_date, event_start_at, announcement_at, presale_at, general_sale_at, event_code, venue_name, venue_city, venue_key, kind, ticket_url, signup_url, meta_ad_account_id",
        )
        .eq("id", eventId)
        .maybeSingle()
    : { data: null };

  const event = eventRow as {
    id: string;
    name: string;
    client_id: string | null;
    event_date: string | null;
    event_start_at: string | null;
    announcement_at: string | null;
    presale_at: string | null;
    general_sale_at: string | null;
    event_code: string | null;
    venue_name: string | null;
    venue_city: string | null;
    venue_key?: string | null;
    kind: string | null;
    ticket_url: string | null;
    signup_url: string | null;
    meta_ad_account_id: string | null;
  } | null;

  let clientName: string | null = null;
  let clientMeta: string | null = null;
  let clientGoogle: string | null = null;
  if (event?.client_id) {
    const { data: clientRow } = await client
      .from("clients")
      .select("id, name, meta_ad_account_id, google_ads_customer_id")
      .eq("id", event.client_id)
      .maybeSingle();
    const named = clientRow as {
      name: string | null;
      meta_ad_account_id: string | null;
      google_ads_customer_id: string | null;
    } | null;
    clientName = named?.name ?? null;
    clientMeta = named?.meta_ad_account_id ?? null;
    clientGoogle = named?.google_ads_customer_id ?? null;
  }

  const events: PlanEventOption[] = event
    ? [
        {
          id: event.id,
          name: event.name,
          clientId: event.client_id,
          clientName,
          venueName: event.venue_name?.trim() || event.venue_city?.trim() || null,
          venueKey:
            event.venue_key?.trim() ||
            venueKey(event.venue_name) ||
            venueKey(event.venue_city),
          eventDate: event.event_date,
          eventStartAt: event.event_start_at,
          announcementAt: event.announcement_at,
          presaleAt: event.presale_at,
          generalSaleAt: event.general_sale_at,
          eventCode: event.event_code,
          kind: event.kind,
          metaAdAccountId: clientMeta,
          eventMetaAdAccountId: event.meta_ad_account_id ?? null,
          googleCustomerId: clientGoogle,
          ticketUrl: event.ticket_url,
          signupUrl: event.signup_url,
        },
      ]
    : [];

  const selected = events[0] ?? null;
  const loaded = await loadChannelDefaultsForEvent(supabase, eventId);
  const resolved = loaded ? resolveChannelDefaults(loaded.stored, loaded.overrides) : null;
  const tiktokAdvertiserId = resolved?.tiktokAdvertiser.value ?? null;

  const { data: googleAdsAccountRows } = await (
    supabase as {
      from: (table: string) => {
        select: (cols: string) => {
          eq: (col: string, value: string) => {
            order: (
              col: string,
              opts: { ascending: boolean },
            ) => Promise<{
              data: Array<{
                id: string;
                account_name: string | null;
                google_customer_id: string | null;
              }> | null;
            }>;
          };
        };
      };
    }
  )
    .from("google_ads_accounts")
    .select("id, account_name, google_customer_id")
    .eq("user_id", plan.userId)
    .order("account_name", { ascending: true });

  const googleAdsAccounts = (googleAdsAccountRows ?? []).map((row) => ({
    id: row.id,
    account_name: row.account_name,
    google_customer_id: row.google_customer_id ?? "—",
  }));

  const identityNames = await loadIdentityNameMap(
    supabase as Parameters<typeof loadIdentityNameMap>[0],
    plan.userId,
    googleAdsAccounts,
  );

  const thumbs = eventId
    ? await loadEventThumbSources(
        supabase,
        [eventId],
        new Map([[eventId, event?.name ?? ""]]),
      )
    : null;

  const hasPlatformCampaign = (["meta", "tiktok", "google"] as const).some(
    (adapter) => plan.launches[adapter].platformCampaignId != null,
  );
  const funnel =
    hasPlatformCampaign && eventId ? await loadEventFunnelView(supabase as never, eventId) : null;
  const liveSpend = funnel
    ? funnel.costs.platforms.reduce((sum, row) => sum + row.spend, 0)
    : null;
  const launchedAt = planLaunchedAt(plan.launches);
  const adjustReads =
    hasPlatformCampaign && eventId
      ? await loadAdjustReads(supabase as never, {
          eventId,
          sinceDate: launchedAt ? launchedAt.slice(0, 10) : null,
          campaignId: plan.launches.meta.platformCampaignId,
        })
      : null;
  const rollupDays =
    launchedAt && eventId
      ? await loadLaunchRollupDays(supabase as never, eventId, {
          from: planStampLondonDate(launchedAt),
          to: todayIsoDate(),
        })
      : [];
  const benchmarkRows =
    selected?.clientId && selected.venueKey
      ? await loadPlanBenchmarkRows(supabase as never, {
          clientId: selected.clientId,
          venueKey: selected.venueKey,
        })
      : [];
  const predictions = await loadPlanPredictions(supabase, plan.id);

  let decisions: AdjustDecisionRow[] = [];
  const metaDraftId = plan.launches.meta.draftId;
  if (metaDraftId) {
    try {
      const automation = await loadCampaignAutomationState(
        supabase as never,
        metaDraftId,
        plan.userId,
      );
      decisions = (automation?.decisions ?? []).map((row) => ({
        decidedAt: row.decidedAt,
        action: row.action,
        reasonText: row.reasonText,
        resultCount: row.resultCount,
        applied: row.applied,
        dryRun: row.dryRun,
        adsetId: row.adsetId,
        adsetName: row.adsetName,
        budgetBeforePence: row.budgetBeforePence,
        budgetAfterPence: row.budgetAfterPence,
        metricValue: row.metricValue,
        metricWindow: row.metricWindow,
      }));
    } catch {
      decisions = [];
    }
  }

  return {
    plan,
    events,
    tiktokAdvertiserId,
    identityNames,
    funnel,
    liveSpend,
    adjustReads,
    thumbUrl: thumbs?.get(eventId)?.url ?? null,
    rollupDays,
    predictions,
    benchmarkRows,
    resolved,
    decisions,
  };
}
