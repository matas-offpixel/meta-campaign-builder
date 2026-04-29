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
  return <TikTokWizardShell draft={draft} />;
}
