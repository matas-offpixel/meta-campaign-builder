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

  const draft = (await getTikTokDraft(supabase, id)) ?? createDefaultTikTokDraft(id);
  return <TikTokWizardShell draft={draft} />;
}
