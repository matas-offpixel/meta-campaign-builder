import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { listOverviewEvents } from "@/lib/db/overview-server";
import { OverviewTable } from "@/components/dashboard/overview/overview-table";
import { PageHeader } from "@/components/dashboard/page-header";
import type { OverviewFilter } from "@/lib/types/overview";

interface Props {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

function parseFilter(value: string | string[] | undefined): OverviewFilter {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "past" ? "past" : "future";
}

/**
 * Campaign overview dashboard — dense operational table covering every
 * event across every client. The daily nerve centre for spotting which
 * campaigns are due a push, which are bleeding budget, and which are
 * still on plan.
 *
 * Server component: fetches the OverviewRow[] via listOverviewEvents
 * with the current filter (`?filter=future|past`, default future), then
 * hands off to <OverviewTable> for sorting + Load Stats interactions.
 *
 * Spend columns intentionally arrive null — the user opts in via the
 * Load Stats button so a cold view doesn't fan out 20 Meta calls.
 */
export default async function OverviewPage({ searchParams }: Props) {
  const sp = await searchParams;
  const filter = parseFilter(sp.filter);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const rows = await listOverviewEvents(user.id, filter);

  return (
    <>
      <PageHeader
        title="Overview"
        description="Every campaign across every client — daily ops view."
      />
      <main className="flex-1 px-6 py-6">
        <div className="mx-auto max-w-[1400px]">
          <OverviewTable initialRows={rows} initialFilter={filter} />
        </div>
      </main>
    </>
  );
}
