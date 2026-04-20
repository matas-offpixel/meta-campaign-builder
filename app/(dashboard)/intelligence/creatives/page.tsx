import { redirect } from "next/navigation";

import { PageHeader } from "@/components/dashboard/page-header";
import { CreativeHeatmapPage } from "@/components/intelligence/creative-heatmap";
import { createClient } from "@/lib/supabase/server";

/**
 * Creative heatmap shell — auth gate only. The client component owns the
 * ad-account selector and the data fetch so the page can stay a Suspense-
 * friendly server component without prefetching anything we don't yet know.
 */
export default async function IntelligenceCreativesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <>
      <PageHeader
        title="Creative heatmap"
        description="Last-30-day Meta ad performance, ranked by CPL with annotated tags."
      />
      <main className="flex-1 px-6 py-6">
        <div className="mx-auto max-w-6xl">
          <CreativeHeatmapPage />
        </div>
      </main>
    </>
  );
}
