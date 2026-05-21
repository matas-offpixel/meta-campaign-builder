import { notFound, redirect } from "next/navigation";

import { GoogleSearchWizardShell } from "@/components/google-search-wizard/wizard-shell";
import { loadGoogleSearchPlanTree } from "@/lib/db/google-search-plans";
import { createClient } from "@/lib/supabase/server";

/**
 * /google-search/[id]
 *
 * Loads the full plan tree server-side (so the wizard hydrates with
 * real data instantly, no client-side loading flash), plus the dropdown
 * context the Plan Setup step needs (linked events + the user's
 * Google Ads accounts). Mirrors the
 * `/tiktok-campaign/[id]` route handler shape — server-rendered shell
 * with the working draft passed in as a prop.
 */
export default async function GoogleSearchPlanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const tree = await loadGoogleSearchPlanTree(supabase, id);
  if (!tree) notFound();

  const [accountsRes, eventsRes, clientRes] = await Promise.all([
    supabase
      .from("google_ads_accounts")
      .select("id, account_name, google_customer_id")
      .eq("user_id", user.id)
      .order("account_name", { ascending: true }),
    supabase
      .from("events")
      .select("id, name, event_code, client_id")
      .eq("user_id", user.id)
      .order("event_date", { ascending: false })
      .limit(200),
    tree.plan.event_id
      ? supabase
          .from("events")
          .select("name, event_code, client:clients!inner(name)")
          .eq("id", tree.plan.event_id)
          .eq("user_id", user.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const googleAdsAccounts = ((accountsRes.data ?? []) as Array<{
    id: string;
    account_name: string | null;
    google_customer_id: string | null;
  }>).map((row) => ({
    id: row.id,
    account_name: row.account_name,
    google_customer_id: row.google_customer_id ?? "—",
  }));

  const events = ((eventsRes.data ?? []) as Array<{
    id: string;
    name: string;
    event_code: string | null;
    client_id: string | null;
  }>).map((row) => ({
    id: row.id,
    name: row.name,
    event_code: row.event_code,
    client_id: row.client_id,
  }));

  const linkedEvent = clientRes.data as
    | { name: string; event_code: string | null; client: { name: string | null } | null }
    | null
    | undefined;

  return (
    <GoogleSearchWizardShell
      initialTree={tree}
      context={{
        eventName: linkedEvent?.name ?? null,
        eventCode: linkedEvent?.event_code ?? null,
        clientName: linkedEvent?.client?.name ?? null,
        googleAdsAccounts,
        events,
      }}
    />
  );
}
