import { redirect } from "next/navigation";

import { PageHeader } from "@/components/dashboard/page-header";
import { AudienceBuilderPage } from "@/components/intelligence/audience-builder";
import { createClient } from "@/lib/supabase/server";

/**
 * Server shell for the audience builder. Auth is gated here so the client
 * component never renders without a signed-in user; everything else is
 * fetched client-side because the filter inputs drive the full request.
 */
export default async function IntelligenceAudiencesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <>
      <PageHeader
        title="Audience builder"
        description="Cross-event filters that surface who you've reached and who you can lookalike."
      />
      <main className="flex-1 px-6 py-6">
        <div className="mx-auto max-w-6xl">
          <AudienceBuilderPage />
        </div>
      </main>
    </>
  );
}
