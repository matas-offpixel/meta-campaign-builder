import { redirect } from "next/navigation";

import { TikTokWizardShell } from "@/components/tiktok-wizard/wizard-shell";
import { getTikTokDraft, upsertTikTokDraft } from "@/lib/db/tiktok-drafts";
import { createClient } from "@/lib/supabase/server";
import { readTikTokAccountCredentials } from "@/lib/tiktok/api-account";
import { fetchTikTokIdentities } from "@/lib/tiktok/identity";
import {
  resolveTikTokDraftIdentityBcIdOnLoad,
  tikTokIdentityBcIdIsServerResolvable,
} from "@/lib/tiktok-wizard/migrate-draft";
import {
  isTikTokWritesEnabled,
  TIKTOK_WRITES_DISABLED_REASON,
} from "@/lib/tiktok/write/feature-flag";
import { createDefaultTikTokDraft } from "@/lib/types/tiktok-draft";
import { loadPlanForTikTokDraft } from "@/lib/plan/linked-plan";

export default async function TikTokCampaignPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");

  const loaded = await getTikTokDraft(supabase, id);
  const draft = loaded ?? createDefaultTikTokDraft(id);
  if (
    tikTokIdentityBcIdIsServerResolvable(draft) &&
    draft.accountSetup.advertiserId
  ) {
    try {
      const credentials = await readTikTokAccountCredentials(supabase, {
        userId: data.user.id,
        advertiserId: draft.accountSetup.advertiserId,
      });
      if (credentials?.accessToken) {
        await resolveTikTokDraftIdentityBcIdOnLoad({
          draft,
          fetchIdentities: () =>
            fetchTikTokIdentities({
              advertiserId: draft.accountSetup.advertiserId!,
              token: credentials.accessToken,
            }),
          persist: async (next) => {
            await upsertTikTokDraft(supabase, next.id, {
              ...next,
              userId: data.user.id,
            });
          },
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[tiktok/draft] identityBcId heal draft=${draft.id} failed: ${message}`,
      );
    }
  }
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

  const linkedPlan = await loadPlanForTikTokDraft(supabase, draft.id, data.user.id);

  return (
    <TikTokWizardShell
      draft={draft}
      linkedPlan={linkedPlan}
      context={{
        eventName: event?.name ?? null,
        eventDate: event?.event_date ?? null,
        clientName: client?.name ?? null,
        advertiserName: advertiser?.account_name ?? null,
        eventEditPath: draft.eventId ? `/events/${draft.eventId}/edit` : null,
        writesEnabled: isTikTokWritesEnabled(),
        writesDisabledReason: isTikTokWritesEnabled()
          ? null
          : TIKTOK_WRITES_DISABLED_REASON,
      }}
    />
  );
}
