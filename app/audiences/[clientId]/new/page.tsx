import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/dashboard/page-header";
import { createClient } from "@/lib/supabase/server";
import { isFunnelStage } from "@/lib/audiences/metadata";
import { AudienceCreateForm } from "./audience-create-form";

interface Props {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{
    event_id?: string;
    presetBundle?: string;
  }>;
}

export default async function NewAudiencePage({ params, searchParams }: Props) {
  const { clientId } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [clientRes, eventsRes] = await Promise.all([
    supabase
      .from("clients")
      .select("id, name, slug, meta_ad_account_id")
      .eq("id", clientId)
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("events")
      .select("id, name, event_code")
      .eq("client_id", clientId)
      .eq("user_id", user.id)
      .order("event_date", { ascending: false }),
  ]);

  if (!clientRes.data) notFound();

  const client = clientRes.data as {
    id: string;
    name: string;
    slug: string | null;
    meta_ad_account_id: string | null;
  };
  const events = ((eventsRes.data ?? []) as {
    id: string;
    name: string;
    event_code: string | null;
  }[]).map((event) => ({
    id: event.id,
    name: event.name,
    eventCode: event.event_code,
  }));
  const initialPresetBundle = isFunnelStage(sp.presetBundle)
    ? sp.presetBundle
    : undefined;

  return (
    <>
      <PageHeader
        title="New Meta audience"
        description="Create draft custom audience definitions. Live Meta writes land in PR-B."
      />
      <main className="flex-1 px-6 py-6">
        <div className="mx-auto max-w-4xl">
          <AudienceCreateForm
            client={{
              id: client.id,
              name: client.name,
              slug: client.slug,
              metaAdAccountId: client.meta_ad_account_id,
            }}
            events={events}
            initialEventId={sp.event_id}
            initialPresetBundle={initialPresetBundle}
          />
        </div>
      </main>
    </>
  );
}
