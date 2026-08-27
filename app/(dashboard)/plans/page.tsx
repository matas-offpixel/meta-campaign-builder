import { redirect } from "next/navigation";

import { PageHeader } from "@/components/dashboard/page-header";
import { PlanLibrary } from "@/components/library/plan-library";
import type { PlanLibraryItem } from "@/lib/plan/library";
import { InfoTip } from "@/components/viz/info-tip";
import { loadEventThumbSources } from "@/lib/plan/event-artwork-load";
import type { PlanEventOption } from "@/lib/plan/event-picker";
import { emptyPlanLaunches } from "@/lib/plan/load";
import { loadPlanTemplatesForUser } from "@/lib/plan/plan-templates";
import { isRelationMissing } from "@/lib/plan/schema-probe";
import { IDLE_PLAN_LAUNCH, type CampaignPlan, type CampaignPlanLaunches } from "@/lib/plan/types";
import { createClient } from "@/lib/supabase/server";

interface PlanListRow {
  id: string;
  name: string | null;
  status: CampaignPlan["status"];
  event_id: string;
  objective_intent: CampaignPlan["intent"]["objectiveIntent"] | null;
  total_daily_budget: number | string | null;
  start_date: string | null;
  end_date: string | null;
  updated_at: string;
}

interface LaunchStatusRow {
  plan_id: string;
  status?: CampaignPlanLaunches["meta"]["status"];
  draft_id?: string | null;
  platform_campaign_id?: string | null;
  error?: string | null;
}

function toLaunch(row: LaunchStatusRow | undefined) {
  if (!row) return { ...IDLE_PLAN_LAUNCH };
  return {
    status: row.status ?? "idle",
    platformCampaignId: row.platform_campaign_id ?? null,
    draftId: row.draft_id ?? null,
    error: row.error ?? null,
  };
}

export default async function PlansPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error } = await supabase
    .from("campaign_plans")
    .select(
      "id, name, status, event_id, objective_intent, total_daily_budget, start_date, end_date, updated_at",
    )
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });

  const tableMissing = isRelationMissing(error);

  const rows = tableMissing ? [] : ((data ?? []) as PlanListRow[]);
  const ids = rows.map((row) => row.id);
  const launchesByPlan = new Map<string, CampaignPlanLaunches>();
  if (ids.length > 0) {
    const [meta, tiktok, google] = await Promise.all([
      supabase
        .from("campaign_plan_meta_launch")
        .select("plan_id, status, draft_id, platform_campaign_id, error")
        .in("plan_id", ids),
      supabase
        .from("campaign_plan_tiktok_launch")
        .select("plan_id, status, draft_id, platform_campaign_id, error")
        .in("plan_id", ids),
      supabase
        .from("campaign_plan_google_launch")
        .select("plan_id, status, draft_id, platform_campaign_id, error")
        .in("plan_id", ids),
    ]);
    const metaBy = new Map(
      ((meta.data ?? []) as LaunchStatusRow[]).map((row) => [row.plan_id, row]),
    );
    const tiktokBy = new Map(
      ((tiktok.data ?? []) as LaunchStatusRow[]).map((row) => [row.plan_id, row]),
    );
    const googleBy = new Map(
      ((google.data ?? []) as LaunchStatusRow[]).map((row) => [row.plan_id, row]),
    );
    for (const id of ids) {
      launchesByPlan.set(id, {
        meta: toLaunch(metaBy.get(id)),
        tiktok: toLaunch(tiktokBy.get(id)),
        google: toLaunch(googleBy.get(id)),
      });
    }
  }

  const { data: events } = await supabase
    .from("events")
    .select(
      "id, name, client_id, event_date, presale_at, general_sale_at, event_code, venue_name, venue_city, kind, ticket_url, signup_url",
    )
    .eq("user_id", user.id)
    .order("event_date", { ascending: false });

  const eventRows = (events ?? []) as {
    id: string;
    name: string;
    client_id: string | null;
    event_date: string | null;
    presale_at: string | null;
    general_sale_at: string | null;
    event_code: string | null;
    venue_name: string | null;
    venue_city: string | null;
    kind: string | null;
    ticket_url: string | null;
    signup_url: string | null;
  }[];
  const clientIds = [...new Set(eventRows.map((event) => event.client_id).filter(Boolean))] as string[];
  const { data: clients } = clientIds.length
    ? await supabase.from("clients").select("id, name").in("id", clientIds)
    : { data: [] as never[] };
  const clientById = new Map(
    ((clients ?? []) as Array<{ id: string; name: string }>).map((client) => [client.id, client]),
  );

  const eventOptions: PlanEventOption[] = eventRows.map((event) => {
    const client = event.client_id ? clientById.get(event.client_id) : undefined;
    return {
      id: event.id,
      name: event.name,
      clientId: event.client_id,
      clientName: client?.name ?? null,
      venueName: event.venue_name?.trim() || event.venue_city?.trim() || null,
      eventDate: event.event_date,
      presaleAt: event.presale_at,
      generalSaleAt: event.general_sale_at,
      eventCode: event.event_code,
      kind: event.kind,
      ticketUrl: event.ticket_url,
      signupUrl: event.signup_url,
    };
  });

  const eventNames = new Map(eventRows.map((event) => [event.id, event.name]));
  const thumbs = await loadEventThumbSources(
    supabase,
    [...new Set(rows.map((row) => row.event_id).filter(Boolean))],
    eventNames,
  );

  const templatesResult = tableMissing
    ? { ok: true as const, templates: [], tableMissing: true }
    : await loadPlanTemplatesForUser(supabase, user.id);
  const templates = templatesResult.ok ? templatesResult.templates : [];
  const templatesMissing = templatesResult.ok
    ? templatesResult.tableMissing === true
    : false;

  const plans: PlanLibraryItem[] = rows.map((row) => {
    const thumb = thumbs.get(row.event_id);
    return {
      id: row.id,
      name: row.name,
      status: row.status,
      eventId: row.event_id,
      eventName: eventNames.get(row.event_id) ?? thumb?.name ?? null,
      thumbUrl: thumb?.url ?? null,
      objectiveIntent: row.objective_intent,
      totalDaily: Number(row.total_daily_budget) || 0,
      startDate: row.start_date,
      endDate: row.end_date,
      launches: launchesByPlan.get(row.id) ?? emptyPlanLaunches(),
      updatedAt: row.updated_at,
    };
  });

  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            Plans
            <InfoTip label="One set of inputs for Meta, TikTok, and Google. Everything launches paused." />
          </span>
        }
      />
      <main className="flex-1 px-6 py-6">
        <div className="mx-auto max-w-6xl space-y-4">
          {/* No plans yet / PlanDeleteAction: PlanLibrary + PlanRow keep list empty copy and #863 gating. */}
          {tableMissing ? (
            <p className="rounded-lg border border-dashed border-border bg-muted/40 px-4 py-6 text-sm text-muted-foreground">
              No plans table yet. Migration 157 has not been applied.
            </p>
          ) : (
            <PlanLibrary
              plans={plans}
              events={eventOptions}
              templates={templates}
              tableMissing={false}
              templatesMissing={templatesMissing}
            />
          )}
        </div>
      </main>
    </>
  );
}
