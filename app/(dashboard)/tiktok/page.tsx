import Link from "next/link";
import { Plus } from "lucide-react";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/dashboard/page-header";
import { TikTokCampaignLibrary } from "@/components/dashboard/tiktok-campaign-library";
import { createClient } from "@/lib/supabase/server";
import { listTikTokDrafts } from "@/lib/db/tiktok-drafts";

export default async function TikTokIndexPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const drafts = await listTikTokDrafts(supabase, { userId: user.id });
  const [clientsById, eventsById] = await Promise.all([
    readAllClients(supabase, user.id),
    readAllEvents(supabase, user.id),
  ]);

  return (
    <>
      <PageHeader
        title="TikTok campaigns"
        description="Manage TikTok drafts, published campaigns, and templates the same way as Meta."
        actions={
          <Link href="/tiktok/new">
            <Button size="sm">
              <Plus className="h-3.5 w-3.5" />
              New TikTok campaign
            </Button>
          </Link>
        }
      />
      <main className="flex-1 px-6 py-6">
        <div className="mx-auto max-w-6xl">
          <TikTokCampaignLibrary
            userId={user.id}
            initialDrafts={drafts}
            clientsById={clientsById}
            eventsById={eventsById}
          />
        </div>
      </main>
    </>
  );
}

async function readAllClients(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<Record<string, { id: string; name: string }>> {
  const { data, error } = await supabase
    .from("clients")
    .select("id, name")
    .eq("user_id", userId)
    .order("name", { ascending: true });
  if (error) return {};
  return Object.fromEntries(
    ((data ?? []) as { id: string; name: string }[]).map((row) => [row.id, row]),
  );
}

async function readAllEvents(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<Record<string, { id: string; name: string; client_id: string }>> {
  const { data, error } = await supabase
    .from("events")
    .select("id, name, client_id")
    .eq("user_id", userId)
    .order("event_date", { ascending: false });
  if (error) return {};
  return Object.fromEntries(
    ((data ?? []) as { id: string; name: string; client_id: string }[]).map((row) => [
      row.id,
      row,
    ]),
  );
}
