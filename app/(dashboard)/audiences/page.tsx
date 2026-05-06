import { redirect } from "next/navigation";

import { PageHeader } from "@/components/dashboard/page-header";
import { AudienceBuilderPage } from "@/components/intelligence/audience-builder";
import { createClient } from "@/lib/supabase/server";

export default async function AudienceSeedsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <>
      <PageHeader
        title="Audience seeds"
        description="Legacy cross-event seed filters for discovery and lookalike planning."
      />
      <main className="flex-1 px-6 py-6">
        <div className="mx-auto max-w-6xl">
          <AudienceBuilderPage />
        </div>
      </main>
    </>
  );
}
