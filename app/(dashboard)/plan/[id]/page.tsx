import { redirect } from "next/navigation";

import { PageHeader } from "@/components/dashboard/page-header";
import { PlanWorkspace } from "@/components/plan/plan-workspace";
import { loadEventFunnelView } from "@/lib/db/event-funnel-load";
import { listPresetsForClient } from "@/lib/db/optimisation-presets";
import { presetPrimaryRule, resolvePreset } from "@/lib/optimisation/presets";
import { loadEventThumbSources } from "@/lib/plan/event-artwork-load";
import { createEmptyCampaignPlan } from "@/lib/plan/empty-plan";
import {
  defaultPlanEventId,
  todayIsoDate,
  type PlanEventOption,
} from "@/lib/plan/event-picker";
import { loadPlanLaunchRecords } from "@/lib/plan/load";
import { rowToCampaignPlanIntent } from "@/lib/plan/persist";
import { planLadderObjective } from "@/lib/plan/prepare-draft";
import { isRelationMissing } from "@/lib/plan/schema-probe";
import type { CampaignPlan } from "@/lib/plan/types";
import { PLAN_SURFACE_MAX_WIDTH_CLASS } from "@/lib/plan/surface";
import { createClient } from "@/lib/supabase/server";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ event?: string }>;
}

export default async function PlanDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { event: eventFromQuery } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  /**
   * `ticket_url` / `signup_url` back zone A's `ⓘ` — the typed Destination
   * URL field is gone, so the destination is read off the event.
   * `announcement_at` / `event_start_at` are what `derivePhase` needs for
   * the derived plan name, now that the name input is gone too.
   */
  const { data: events } = await supabase
    .from("events")
    .select(
      "id, name, client_id, event_date, event_start_at, announcement_at, presale_at, general_sale_at, event_code, venue_name, venue_city, kind, ticket_url, signup_url",
    )
    .eq("user_id", user.id)
    .order("event_date", { ascending: false });

  const eventRows = (events ?? []) as {
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
    kind: string | null;
    ticket_url: string | null;
    signup_url: string | null;
  }[];
  const clientIds = [
    ...new Set(eventRows.map((event) => event.client_id).filter(Boolean)),
  ] as string[];
  const { data: clients } = clientIds.length
    ? await supabase
        .from("clients")
        .select("id, name, meta_ad_account_id, google_ads_customer_id")
        .in("id", clientIds)
    : { data: [] as never[] };
  const clientById = new Map(
    ((clients ?? []) as {
      id: string;
      name: string;
      meta_ad_account_id: string | null;
      google_ads_customer_id: string | null;
    }[]).map((client) => [client.id, client]),
  );

  const { data: tiktokAccounts } = await supabase
    .from("tiktok_accounts")
    .select("tiktok_advertiser_id")
    .eq("user_id", user.id);
  const advertiserIds = [
    ...new Set(
      ((tiktokAccounts ?? []) as { tiktok_advertiser_id: string | null }[])
        .map((row) => row.tiktok_advertiser_id)
        .filter((id): id is string => !!id),
    ),
  ];

  const eventOptions: PlanEventOption[] = eventRows.map((event) => {
    const client = event.client_id ? clientById.get(event.client_id) : undefined;
    return {
      id: event.id,
      name: event.name,
      clientId: event.client_id,
      clientName: client?.name ?? null,
      venueName: event.venue_name?.trim() || event.venue_city?.trim() || null,
      eventDate: event.event_date,
      eventStartAt: event.event_start_at,
      announcementAt: event.announcement_at,
      presaleAt: event.presale_at,
      generalSaleAt: event.general_sale_at,
      eventCode: event.event_code,
      kind: event.kind,
      metaAdAccountId: client?.meta_ad_account_id ?? null,
      googleCustomerId: client?.google_ads_customer_id ?? null,
      ticketUrl: event.ticket_url,
      signupUrl: event.signup_url,
    };
  });

  let plan: CampaignPlan | null = null;
  let loadError: { code?: string; message?: string } | null = null;
  if (id !== "new") {
    const { data, error } = await supabase
      .from("campaign_plans")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    loadError = error;
    if (!error && data) {
      const row = data as {
        id: string;
        user_id: string;
        name: string | null;
        status: CampaignPlan["status"];
        created_at: string;
        updated_at: string;
      } & Parameters<typeof rowToCampaignPlanIntent>[0];
      plan = {
        id: row.id,
        userId: row.user_id,
        name: row.name,
        status: row.status,
        intent: rowToCampaignPlanIntent(row),
        launches: await loadPlanLaunchRecords(supabase, row.id),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    }
  }

  const workspacePlan =
    plan ??
    createEmptyCampaignPlan({
      userId: user.id,
      eventId: defaultPlanEventId(eventOptions, {
        today: todayIsoDate(),
        preferredId: eventFromQuery,
      }),
      name: "",
    });

  const selectedEvent = eventOptions.find(
    (event) => event.id === workspacePlan.intent.eventId,
  );

  const thumbs = workspacePlan.intent.eventId
    ? await loadEventThumbSources(
        supabase,
        [workspacePlan.intent.eventId],
        new Map(eventRows.map((event) => [event.id, event.name])),
      )
    : null;

  /**
   * Zone D never shows an empty field: with no `target_value` the chip
   * renders the client preset's benchmark behind an `industry seed` badge.
   */
  let targetBenchmark: number | null = null;
  if (selectedEvent?.clientId) {
    const presets = await listPresetsForClient(supabase, selectedEvent.clientId);
    const resolved = resolvePreset(
      selectedEvent.clientId,
      planLadderObjective(workspacePlan),
      presets,
    );
    targetBenchmark = presetPrimaryRule(resolved.preset)?.benchmarkTarget ?? null;
  }

  /**
   * LIVE state only. `platformCampaignId` is the cheap test for "there is
   * something on a platform to have delivered"; without one, the rollup
   * read would be a full funnel query for a plan that has never launched.
   */
  const hasPlatformCampaign = (["meta", "tiktok", "google"] as const).some(
    (adapter) => workspacePlan.launches[adapter].platformCampaignId != null,
  );
  const funnel =
    hasPlatformCampaign && workspacePlan.intent.eventId
      ? await loadEventFunnelView(supabase, workspacePlan.intent.eventId)
      : null;
  const liveSpend = funnel
    ? funnel.costs.platforms.reduce((sum, row) => sum + row.spend, 0)
    : null;

  return (
    <>
      <PageHeader
        title={workspacePlan.name || "New plan"}
        contentClassName={PLAN_SURFACE_MAX_WIDTH_CLASS}
      />
      <main className="flex-1 px-6 py-6">
        <div className={`mx-auto ${PLAN_SURFACE_MAX_WIDTH_CLASS}`}>
          {id !== "new" && !plan ? (
            <p className="mb-4 rounded-lg border border-dashed border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
              {isRelationMissing(loadError)
                ? "campaign_plans is not in this database (migration 157)."
                : "That plan was not found. Showing a new workspace instead of a fake stored plan."}
            </p>
          ) : null}
          <PlanWorkspace
            initialPlan={workspacePlan}
            events={eventOptions}
            tiktokAdvertiserId={advertiserIds.length === 1 ? advertiserIds[0] : null}
            isNew={id === "new"}
            funnel={funnel}
            liveSpend={liveSpend}
            thumbUrl={thumbs?.get(workspacePlan.intent.eventId)?.url ?? null}
            targetBenchmark={targetBenchmark}
          />
        </div>
      </main>
    </>
  );
}
