import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PlanWorkspace } from "@/components/plan/plan-workspace";
import { PLAN_SURFACE_MAX_WIDTH_CLASS } from "@/lib/plan/surface";
import { loadSharedPlanWorkspace } from "@/lib/plan/share-load";
import { createServiceRoleClient } from "@/lib/supabase/server";

interface Props {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Plan · Off Pixel",
    robots: { index: false, follow: false },
  };
}

/**
 * Canon §1.6 — a client's share link opens one plan, never the list.
 * Same canvas under `role=client`. `/share/` is already public; this
 * route does not widen PUBLIC_PREFIXES. The plan id is the credential.
 */
export default async function PlanSharePage({ params }: Props) {
  const { id } = await params;
  const supabase = createServiceRoleClient();
  const loaded = await loadSharedPlanWorkspace(supabase, id);
  if (!loaded) notFound();

  return (
    <main className="flex-1 px-6 py-6">
      <div className={`mx-auto ${PLAN_SURFACE_MAX_WIDTH_CLASS}`}>
        <PlanWorkspace
          role="client"
          initialPlan={loaded.plan}
          events={loaded.events}
          tiktokAdvertiserId={loaded.tiktokAdvertiserId}
          identityNames={loaded.identityNames}
          funnel={loaded.funnel}
          liveSpend={loaded.liveSpend}
          adjustReads={loaded.adjustReads}
          thumbUrl={loaded.thumbUrl}
          rollupDays={loaded.rollupDays}
          predictions={loaded.predictions}
          benchmarkRows={loaded.benchmarkRows}
          initialResolved={loaded.resolved}
          initialDecisions={loaded.decisions}
        />
      </div>
    </main>
  );
}
