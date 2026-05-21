import Link from "next/link";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import type { GoogleSearchPlan } from "@/lib/google-search/types";

import { GoogleSearchPlanActions } from "@/components/google-search/plan-actions";

const STATUS_BADGE: Record<GoogleSearchPlan["status"], string> = {
  draft: "bg-muted text-foreground",
  pushed: "bg-emerald-100 text-emerald-900",
  partially_pushed: "bg-amber-100 text-amber-900",
  archived: "bg-muted text-muted-foreground",
};

/**
 * Library landing for Google Search plans. Mirrors the TikTok index —
 * server-fetched list, status pills, and per-row "Open wizard" CTA. The
 * page header surfaces both creation paths: a blank plan or an xlsx
 * import (Phase 1 importer).
 */
export default async function GoogleSearchIndexPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [plansRes, accountsRes, eventsRes] = await Promise.all([
    supabase
      .from("google_search_plans")
      .select("*")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(200),
    supabase
      .from("google_ads_accounts")
      .select("id, account_name, google_customer_id")
      .eq("user_id", user.id)
      .order("account_name", { ascending: true }),
    supabase
      .from("events")
      .select("id, name, event_code")
      .eq("user_id", user.id)
      .order("event_date", { ascending: false })
      .limit(200),
  ]);

  const plans = (plansRes.data ?? []) as GoogleSearchPlan[];
  const accounts = (accountsRes.data ?? []) as Array<{
    id: string;
    account_name: string | null;
    google_customer_id: string | null;
  }>;
  const events = (eventsRes.data ?? []) as Array<{
    id: string;
    name: string;
    event_code: string | null;
  }>;
  const eventsById = new Map(events.map((e) => [e.id, e]));

  return (
    <>
      <PageHeader
        title="Google Search plans"
        description="Search-side plan trees per event. Import a J2-style xlsx to seed a draft, or build one from scratch."
        actions={<GoogleSearchPlanActions accounts={accounts} events={events} />}
      />
      <main className="flex-1 px-6 py-6">
        <div className="mx-auto max-w-6xl space-y-4">
          {plans.length === 0 ? (
            <section className="rounded-md border border-dashed border-border bg-card p-12 text-center">
              <p className="font-heading text-lg tracking-wide">No plans yet</p>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                Drop in a Junction 2-style plan xlsx to seed everything (campaigns, ad groups,
                keywords, RSAs, negatives) or start a blank one for a brand-new event.
              </p>
              <div className="mt-6 flex justify-center">
                <GoogleSearchPlanActions accounts={accounts} events={events} />
              </div>
            </section>
          ) : (
            <div className="overflow-hidden rounded-md border border-border bg-card">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="p-3">Name</th>
                    <th className="p-3">Linked event</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Budget</th>
                    <th className="p-3">Updated</th>
                    <th className="p-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {plans.map((plan) => {
                    const event = plan.event_id ? eventsById.get(plan.event_id) : null;
                    return (
                      <tr key={plan.id} className="border-t border-border">
                        <td className="p-3 font-medium">{plan.name || "Untitled plan"}</td>
                        <td className="p-3 text-muted-foreground">
                          {event
                            ? `${event.name}${event.event_code ? ` (${event.event_code})` : ""}`
                            : "—"}
                        </td>
                        <td className="p-3">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                              STATUS_BADGE[plan.status]
                            }`}
                          >
                            {plan.status}
                          </span>
                        </td>
                        <td className="p-3 text-muted-foreground">
                          {plan.total_budget != null
                            ? `£${plan.total_budget.toFixed(2)}`
                            : "—"}
                        </td>
                        <td className="p-3 text-muted-foreground">
                          {new Date(plan.updated_at).toLocaleDateString("en-GB")}
                        </td>
                        <td className="p-3 text-right">
                          <Link href={`/google-search/${plan.id}`}>
                            <Button variant="outline" size="sm">
                              Open wizard
                            </Button>
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
