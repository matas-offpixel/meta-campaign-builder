import { redirect } from "next/navigation";

import { TikTokWizardShell } from "@/components/tiktok-wizard/wizard-shell";
import { getTikTokDraft } from "@/lib/db/tiktok-drafts";
import { createClient } from "@/lib/supabase/server";
import { createDefaultTikTokDraft } from "@/lib/types/tiktok-draft";

export default async function TikTokCampaignPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");

  const loaded = await getTikTokDraft(supabase, id);
  const draft = loaded ?? createDefaultTikTokDraft(id);
  if (draft.eventId && !draft.campaignSetup.eventCode) {
    const { data: event } = await supabase
      .from("events")
      .select("event_code")
      .eq("id", draft.eventId)
      .eq("user_id", data.user.id)
      .maybeSingle();
    draft.campaignSetup.eventCode =
      ((event as { event_code?: string | null } | null)?.event_code ?? null);
  }

  const [{ data: event }, { data: client }, { data: advertiser }] = await Promise.all([
    draft.eventId
      ? supabase
          .from("events")
          .select("name, event_date")
          .eq("id", draft.eventId)
          .eq("user_id", data.user.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    draft.clientId
      ? supabase
          .from("clients")
          .select("name")
          .eq("id", draft.clientId)
          .eq("user_id", data.user.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    draft.accountSetup.tiktokAccountId
      ? supabase
          .from("tiktok_accounts")
          .select("account_name")
          .eq("id", draft.accountSetup.tiktokAccountId)
          .eq("user_id", data.user.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return (
    <TikTokWizardShell
      draft={draft}
      context={{
        eventName: event?.name ?? null,
        eventDate: event?.event_date ?? null,
        clientName: client?.name ?? null,
        advertiserName: advertiser?.account_name ?? null,
        eventEditPath: draft.eventId ? `/events/${draft.eventId}/edit` : null,
      }}
    />
  );
}
