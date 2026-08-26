import Link from "next/link";
import { Plus } from "lucide-react";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/dashboard/page-header";
import { PlanDeleteAction } from "@/components/plan/plan-delete-action";
import { emptyPlanLaunches } from "@/lib/plan/load";
import { isRelationMissing } from "@/lib/plan/schema-probe";
import { IDLE_PLAN_LAUNCH, type CampaignPlanLaunches } from "@/lib/plan/types";
import { createClient } from "@/lib/supabase/server";

interface PlanListRow {
  id: string;
  name: string | null;
  status: string;
  event_id: string;
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
    .select("id, name, status, event_id")
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

  return (
    <>
      <PageHeader
        title="Plans"
        description="One set of inputs for Meta, TikTok, and Google. Everything launches paused."
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
              No plans table yet. Migration 157 has not been applied — the list
              cannot load stored plans. You can still open a new plan workspace.
            </p>
          ) : rows.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border bg-muted/40 px-4 py-6 text-sm text-muted-foreground">
              No plans yet. Create one from an event to enter the shared inputs
              once.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {rows.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div>
                    <Link href={`/plan/${row.id}`} className="font-medium underline">
                      {row.name || "Untitled plan"}
                    </Link>
                    <span className="ml-2 text-muted-foreground">{row.status}</span>
                  </div>
                  <PlanDeleteAction
                    planId={row.id}
                    launches={launchesByPlan.get(row.id) ?? emptyPlanLaunches()}
                    persisted
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </>
  );
}
