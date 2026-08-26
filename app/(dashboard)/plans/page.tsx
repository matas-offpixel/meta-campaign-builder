import Link from "next/link";
import { Plus } from "lucide-react";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/dashboard/page-header";
import { PlanDeleteAction } from "@/components/plan/plan-delete-action";
import { EventThumb } from "@/components/viz/event-thumb";
import { InfoTip } from "@/components/viz/info-tip";
import { MetricChip } from "@/components/viz/metric-chip";
import { StatusStrip } from "@/components/viz/status-strip";
import { loadEventThumbSources } from "@/lib/plan/event-artwork-load";
import { emptyPlanLaunches } from "@/lib/plan/load";
import { isRelationMissing } from "@/lib/plan/schema-probe";
import { IDLE_PLAN_LAUNCH, type CampaignPlanLaunches } from "@/lib/plan/types";
import { createClient } from "@/lib/supabase/server";

interface PlanListRow {
  id: string;
  name: string | null;
  status: string;
  event_id: string;
  total_daily_budget: number | string | null;
  start_date: string | null;
  end_date: string | null;
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

function dateRangeLabel(start: string | null, end: string | null): string | null {
  if (!start && !end) return null;
  if (start && end) return `${start}–${end}`;
  return start ?? end;
}

export default async function PlansPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error } = await supabase
    .from("campaign_plans")
    .select("id, name, status, event_id, total_daily_budget, start_date, end_date")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });

  const tableMissing = isRelationMissing(error);

  const rows = (data ?? []) as PlanListRow[];
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

  const eventIds = [...new Set(rows.map((row) => row.event_id).filter(Boolean))];
  const { data: eventRows } = eventIds.length
    ? await supabase.from("events").select("id, name").in("id", eventIds)
    : { data: [] as never[] };
  const eventNames = new Map(
    ((eventRows ?? []) as Array<{ id: string; name: string }>).map((row) => [row.id, row.name]),
  );
  const thumbs = await loadEventThumbSources(supabase, eventIds, eventNames);

  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            Plans
            <InfoTip label="One set of inputs for Meta, TikTok, and Google. Everything launches paused." />
          </span>
        }
        actions={
          <Link href="/plan/new">
            <Button size="sm">
              <Plus className="h-3.5 w-3.5" />
              New plan
            </Button>
          </Link>
        }
      />
      <main className="flex-1 px-6 py-6">
        <div className="mx-auto max-w-6xl space-y-4">
          {tableMissing ? (
            <p className="rounded-lg border border-dashed border-border bg-muted/40 px-4 py-6 text-sm text-muted-foreground">
              No plans table yet. Migration 157 has not been applied.
            </p>
          ) : rows.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border bg-muted/40 px-4 py-6 text-sm text-muted-foreground">
              No plans yet.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {rows.map((row) => {
                const thumb = thumbs.get(row.event_id);
                const budget = Number(row.total_daily_budget);
                const range = dateRangeLabel(row.start_date, row.end_date);
                return (
                  <li key={row.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                    <Link href={`/plan/${row.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                      <EventThumb url={thumb?.url} name={thumb?.name ?? row.name} />
                      <span className="truncate font-medium">{row.name || "Untitled plan"}</span>
                      <StatusStrip
                        launches={launchesByPlan.get(row.id) ?? emptyPlanLaunches()}
                      />
                      {Number.isFinite(budget) && budget > 0 ? (
                        <MetricChip label={`${budget} pounds per day`}>£{budget}/d</MetricChip>
                      ) : null}
                      {range ? <MetricChip label={range}>{range}</MetricChip> : null}
                    </Link>
                    <PlanDeleteAction
                      planId={row.id}
                      launches={launchesByPlan.get(row.id) ?? emptyPlanLaunches()}
                      persisted
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </main>
    </>
  );
}
