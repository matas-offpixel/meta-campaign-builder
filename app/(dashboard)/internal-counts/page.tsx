import { redirect } from "next/navigation";

import { InternalCountsReviewView } from "@/components/internal-counts/review-list";
import { gmailOAuthConfigFromEnv } from "@/lib/gmail/oauth";
import { gmailTokenKey } from "@/lib/gmail/connection";
import { flashFor, readReviewList } from "@/lib/internal-counts/review-read";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** The Internal Counts review list (D8, HD1). Internal only. */
export default async function InternalCountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const params = await searchParams;
  const view = await readReviewList(supabase, {
    gmailConfigured: gmailOAuthConfigFromEnv().config !== null && gmailTokenKey() !== null,
    flash: flashFor(params),
  });
  return (
    <main className="px-4 py-6 sm:px-6">
      <InternalCountsReviewView view={view} />
    </main>
  );
}
