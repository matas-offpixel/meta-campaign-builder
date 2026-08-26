import Link from "next/link";
import { Plus } from "lucide-react";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/dashboard/page-header";
import { isRelationMissing } from "@/lib/plan/schema-probe";
import { createClient } from "@/lib/supabase/server";

interface PlanListRow {
  id: string;
  name: string | null;
  status: string;
  event_id: string;
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
                <li key={row.id} className="px-4 py-3 text-sm">
                  <Link href={`/plan/${row.id}`} className="font-medium underline">
                    {row.name || "Untitled plan"}
                  </Link>
                  <span className="ml-2 text-muted-foreground">{row.status}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </>
  );
}
