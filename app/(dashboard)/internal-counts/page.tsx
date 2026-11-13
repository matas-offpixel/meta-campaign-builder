import { redirect } from "next/navigation";

import { InternalCountsReviewView } from "@/components/internal-counts/review-list";
import { gmailStatus, lastPullReadAt, laterOf } from "@/lib/internal-counts/gmail-session";
import { gmailStatusLine } from "@/lib/internal-counts/review-words";
import { flashFor, readReviewList } from "@/lib/internal-counts/review-read";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

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
  const status = await gmailStatus();
  const lastRead = laterOf(await lastPullReadAt(createServiceRoleClient()), status.readAt);
  const view = await readReviewList(supabase, {
    statusLine: gmailStatusLine(status.state, status.mailbox, lastRead),
    mailbox: status.mailbox,
    flash: flashFor(params),
  });
  return (
    <main className="px-4 py-6 sm:px-6">
      <InternalCountsReviewView view={view} />
    </main>
  );
}
