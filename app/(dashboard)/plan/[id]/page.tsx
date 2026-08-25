import { redirect } from "next/navigation";

import { PageHeader } from "@/components/dashboard/page-header";
import { PlanWorkspace } from "@/components/plan/plan-workspace";
import { createEmptyCampaignPlan } from "@/lib/plan/empty-plan";
import { loadPlanLaunchRecords } from "@/lib/plan/load";
import type { CampaignPlan } from "@/lib/plan/types";
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

  const { data: events } = await supabase
    .from("events")
    .select("id, name, client_id")
    .eq("user_id", user.id)
    .order("event_date", { ascending: false });

  const eventRows = (events ?? []) as {
    id: string;
    name: string;
    client_id: string | null;
  }[];
  const clientIds = [
    ...new Set(eventRows.map((event) => event.client_id).filter(Boolean)),
  ] as string[];
  const { data: clients } = clientIds.length
    ? await supabase
        .from("clients")
        .select("id, meta_ad_account_id, google_ads_customer_id")
        .in("id", clientIds)
    : { data: [] as never[] };
  const clientById = new Map(
    ((clients ?? []) as {
      id: string;
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

  const eventOptions = eventRows.map((event) => {
    const client = event.client_id ? clientById.get(event.client_id) : undefined;
    return {
      id: event.id,
      name: event.name,
      metaAdAccountId: client?.meta_ad_account_id ?? null,
      googleCustomerId: client?.google_ads_customer_id ?? null,
    };
  });

  let plan: CampaignPlan | null = null;
  if (id !== "new") {
    const { data, error } = await supabase
      .from("campaign_plans")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!error && data) {
      const row = data as {
        id: string;
        user_id: string;
        name: string | null;
        status: CampaignPlan["status"];
        event_id: string;
        objective_intent: CampaignPlan["intent"]["objectiveIntent"];
        total_daily_budget: number;
        daily_budget_meta: number;
        daily_budget_tiktok: number;
        daily_budget_google: number;
        destination_url: string;
        audience_cluster_ref: string | null;
        creative_set_ref: string | null;
        start_date: string | null;
        end_date: string | null;
        created_at: string;
        updated_at: string;
      };
      plan = {
        id: row.id,
        userId: row.user_id,
        name: row.name,
        status: row.status,
        intent: {
          eventId: row.event_id,
          objectiveIntent: row.objective_intent,
          budget: {
            totalDaily: Number(row.total_daily_budget),
            metaDaily: Number(row.daily_budget_meta),
            tiktokDaily: Number(row.daily_budget_tiktok),
            googleDaily: Number(row.daily_budget_google),
          },
          destinationUrl: row.destination_url,
          audienceClusterRef: row.audience_cluster_ref,
          creativeSetRef: row.creative_set_ref,
          startDate: row.start_date,
          endDate: row.end_date,
        },
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
      eventId:
        eventFromQuery && eventOptions.some((event) => event.id === eventFromQuery)
          ? eventFromQuery
          : eventOptions[0]?.id ?? "",
      name: "",
    });

  return (
    <>
      <PageHeader
        title={workspacePlan.name || "New plan"}
        description="Shared inputs, three adapter previews, one paused launch."
      />
      <main className="flex-1 px-6 py-6">
        <div className="mx-auto max-w-6xl">
          {id !== "new" && !plan ? (
            <p className="mb-4 rounded-lg border border-dashed border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
              That plan id is not in the database (migration 157 may be
              unapplied). Showing a new workspace instead of a fake stored plan.
            </p>
          ) : null}
          <PlanWorkspace
            initialPlan={workspacePlan}
            events={eventOptions}
            tiktokAdvertiserId={advertiserIds.length === 1 ? advertiserIds[0] : null}
          />
        </div>
      </main>
    </>
  );
}
