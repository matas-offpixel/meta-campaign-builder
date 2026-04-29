import { redirect } from "next/navigation";

import { PageHeader } from "@/components/dashboard/page-header";
import { TikTokDraftCreateForm } from "@/components/tiktok/tiktok-draft-create-form";
import { createClient } from "@/lib/supabase/server";

interface Props {
  searchParams: Promise<{ client?: string; event?: string }>;
}

export default async function NewTikTokCampaignPage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [clientsRes, eventsRes] = await Promise.all([
    supabase
      .from("clients")
      .select("id, name")
      .eq("user_id", user.id)
      .not("tiktok_account_id", "is", null)
      .order("name", { ascending: true }),
    supabase
      .from("events")
      .select("id, name, client_id")
      .eq("user_id", user.id)
      .order("event_date", { ascending: false }),
  ]);
  const clients = ((clientsRes.data ?? []) as { id: string; name: string }[]).map(
    (client) => ({ id: client.id, name: client.name }),
  );
  const events = ((eventsRes.data ?? []) as {
    id: string;
    name: string;
    client_id: string | null;
  }[]).map((event) => ({
    id: event.id,
    name: event.name,
    clientId: event.client_id,
  }));

  return (
    <>
      <PageHeader
        title="New TikTok campaign"
        description="Pick a TikTok-connected client and optional event, then continue in the TikTok wizard."
      />
      <main className="flex-1 px-6 py-6">
        <div className="mx-auto max-w-4xl">
          <TikTokDraftCreateForm
            clients={clients}
            events={events}
            initialClientId={sp.client ?? ""}
            initialEventId={sp.event ?? ""}
          />
        </div>
      </main>
    </>
  );
}
