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
  const clientIds = unique(drafts.map((draft) => draft.clientId).filter(isString));
  const eventIds = unique(drafts.map((draft) => draft.eventId).filter(isString));
  const [clientsById, eventsById] = await Promise.all([
    readClients(supabase, clientIds),
    readEvents(supabase, eventIds),
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

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isString(value: string | null): value is string {
  return Boolean(value);
}

async function readClients(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: string[],
): Promise<Record<string, { id: string; name: string }>> {
  if (ids.length === 0) return {};
  const { data, error } = await supabase
    .from("clients")
    .select("id, name")
    .in("id", ids);
  if (error) return {};
  return Object.fromEntries(
    ((data ?? []) as { id: string; name: string }[]).map((row) => [row.id, row]),
  );
}

async function readEvents(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: string[],
): Promise<Record<string, { id: string; name: string; client_id: string }>> {
  if (ids.length === 0) return {};
  const { data, error } = await supabase
    .from("events")
    .select("id, name, client_id")
    .in("id", ids);
  if (error) return {};
  return Object.fromEntries(
    ((data ?? []) as { id: string; name: string; client_id: string }[]).map((row) => [
      row.id,
      row,
    ]),
  );
}
