"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CircleHelp } from "lucide-react";

import { AdGroupsKeywordsStep } from "@/components/google-search-wizard/steps/ad-groups-keywords";
import { NegativesStep } from "@/components/google-search-wizard/steps/negatives";
import { AudiencesStep as MetaAudiencesStep } from "@/components/steps/audiences/audiences-step";
import { AudiencesStep as TikTokAudiencesStep } from "@/components/tiktok-wizard/steps/audiences";
import { getTikTokDraft, upsertTikTokDraft } from "@/lib/db/tiktok-drafts";
import { useGoogleSearchTree } from "@/lib/wizard/use-google-search-tree";
import { googleKeywordBlockers } from "@/lib/plan/drawer";
import { tikTokNeedsRegionalLocation, tikTokRegionalRegion } from "@/lib/plan/mml-wizard";
import type { MmlChannel, MmlChannelSelection } from "@/lib/plan/mml-wizard";
import type { PlanEventOption } from "@/lib/plan/event-picker";
import type { ResolvedChannelDefaults } from "@/lib/clients/channel-defaults";
import type { TikTokRegionOption } from "@/lib/tiktok/audience";
import { validateTikTokWizardStep } from "@/lib/tiktok-wizard/validation";
import { createClient } from "@/lib/supabase/client";
import type { AdSetSuggestion, AudienceSettings, CampaignDraft, CampaignSettings } from "@/lib/types";
import type { TikTokCampaignDraft } from "@/lib/types/tiktok-draft";
import { validateStep } from "@/lib/validation";

/**
 * Step 4. One tab per channel chosen in step 1, in the audiences tab style.
 * Meta is the creator's audiences step. TikTok starts open and regional.
 * Google is the Search keywords tab.
 */
export function MmlStepAudiences({
  channels,
  draft,
  resolved,
  events,
  eventId,
  tiktokDraftId,
  googleDraftId,
  onAudiences,
  onSettings,
  onPageInstagramOverride,
  onBlockers,
}: {
  channels: MmlChannelSelection;
  draft: CampaignDraft | null;
  resolved: ResolvedChannelDefaults | null;
  events: PlanEventOption[];
  eventId: string;
  tiktokDraftId: string | null;
  googleDraftId: string | null;
  onAudiences: (audiences: AudienceSettings) => void;
  onSettings: (settings: CampaignSettings) => void;
  onPageInstagramOverride: (pageId: string, igId: string) => void;
  onBlockers: (errors: string[]) => void;
}) {
  const selected = (["meta", "tiktok", "google"] as const).filter((channel) => channels[channel]);
  const [tab, setTab] = useState<MmlChannel>(selected[0] ?? "meta");
  const active = selected.includes(tab) ? tab : (selected[0] ?? "meta");
  const venueName = events.find((event) => event.id === eventId)?.venueName ?? null;
  const [tiktok, setTiktok] = useState<TikTokCampaignDraft | null>(null);
  const [googleBlockers, setGoogleBlockers] = useState<string[]>([]);
  const seededLocation = useRef<string | null>(null);

  useEffect(() => {
    if (!tiktokDraftId || !channels.tiktok) return;
    let cancelled = false;
    void getTikTokDraft(createClient(), tiktokDraftId).then((loaded) => {
      if (!cancelled) setTiktok(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [tiktokDraftId, channels.tiktok]);

  useEffect(() => {
    if (!tiktok || seededLocation.current === tiktok.id) return;
    if (!tikTokNeedsRegionalLocation(tiktok.audiences.locationCodes) || !tiktok.accountSetup.advertiserId) return;
    let cancelled = false;
    const advertiserId = tiktok.accountSetup.advertiserId;
    void fetch(`/api/tiktok/audience/regions?advertiser_id=${encodeURIComponent(advertiserId)}`)
      .then(async (res) => (await res.json()) as { regions?: TikTokRegionOption[] })
      .then(async (json) => {
        if (cancelled) return;
        seededLocation.current = tiktok.id;
        const region = tikTokRegionalRegion(json.regions ?? [], venueName);
        if (!region) return;
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || cancelled) return;
        const next: TikTokCampaignDraft = {
          ...tiktok,
          audiences: {
            ...tiktok.audiences,
            locationCodes: [region.id],
            locationLabels: { ...tiktok.audiences.locationLabels, [region.id]: region.name },
          },
        };
        setTiktok(next);
        await upsertTikTokDraft(supabase, next.id, { ...next, userId: user.id });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [tiktok, venueName]);

  const metaErrors = draft ? validateStep(3, draft, resolved).errors : [];
  const tiktokBlockers = tiktok
    ? validateTikTokWizardStep(tiktok, 3).filter((issue) => issue.step === 3 && issue.blocksContinue)
    : [];
  const googleBlockersText = googleBlockers;
  const blockerKey = [...metaErrors, ...tiktokBlockers.map((issue) => issue.message), ...googleBlockersText].join("\n");

  useEffect(() => {
    onBlockers(blockerKey ? blockerKey.split("\n") : []);
  }, [blockerKey, onBlockers]);

  const counts = useMemo(
    () => ({
      meta: metaErrors.length,
      tiktok: tiktokBlockers.length,
      google: googleBlockersText.length,
    }),
    [metaErrors.length, tiktokBlockers.length, googleBlockersText.length],
  );

  async function saveTikTok(patch: Partial<TikTokCampaignDraft>) {
    if (!tiktok) return;
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const next = { ...tiktok, ...patch, audiences: patch.audiences ?? tiktok.audiences };
    setTiktok(next);
    await upsertTikTokDraft(supabase, next.id, { ...next, userId: user.id });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex gap-0 border-b border-border">
        {selected.map((channel) => (
          <button
            key={channel}
            type="button"
            data-mml-audience-tab={channel}
            onClick={() => setTab(channel)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors ${
              active === channel
                ? "border-b-2 border-foreground text-foreground -mb-px"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <StatusDot count={counts[channel]} />
            {channel === "meta" ? "Meta" : channel === "tiktok" ? "TikTok" : "Google"}
            {counts[channel] > 0 ? <span className="text-xs text-warning">{counts[channel]}</span> : null}
          </button>
        ))}
      </div>

      {active === "meta" && draft ? (
        <MetaAudiencesStep
          audiences={draft.audiences}
          onChange={onAudiences}
          settings={draft.settings}
          onSettingsChange={onSettings}
          onPageInstagramOverride={onPageInstagramOverride}
          adAccountId={draft.settings.metaAdAccountId}
          clientId={draft.settings.clientId}
          eventId={draft.settings.eventId}
          campaignName={draft.settings.campaignName}
          imported={draft.importMeta != null}
          adSetSuggestions={draft.adSetSuggestions as AdSetSuggestion[]}
        />
      ) : null}

      {active === "tiktok" && !tiktok ? (
        <p className="text-sm text-muted-foreground">Loading the TikTok draft…</p>
      ) : null}

      {active === "tiktok" && tiktok ? (
        <div className="space-y-3">
          <p className="text-sm">
            {(tiktok.audiences.interestGroups ?? []).length === 0 &&
            tiktok.audiences.interestCategoryIds.length === 0
              ? "Open audience"
              : "Interests"}
          </p>
          <p className="text-sm text-muted-foreground">Regional · nationwide decided by budget in step 6</p>
          <details className="rounded-md border border-border bg-card">
            <summary className="flex cursor-pointer list-none items-center gap-1 px-4 py-3 text-sm font-medium">
              details
              <CircleHelp className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            </summary>
            <div className="px-4 pb-4">
              <TikTokAudiencesStep surface="drawer" draft={tiktok} onSave={saveTikTok} />
            </div>
          </details>
        </div>
      ) : null}

      {channels.google && googleDraftId ? (
        <div className={active === "google" ? undefined : "hidden"}>
          <GoogleKeywordsTab planId={googleDraftId} onBlockers={setGoogleBlockers} />
        </div>
      ) : null}
    </div>
  );
}

function GoogleKeywordsTab({
  planId,
  onBlockers,
}: {
  planId: string;
  onBlockers: (errors: string[]) => void;
}) {
  const google = useGoogleSearchTree(planId);
  const errors = google.tree ? googleKeywordBlockers(google.tree).map((row) => row.full) : [];
  const key = errors.join("\n");
  useEffect(() => {
    onBlockers(key ? key.split("\n") : []);
  }, [key, onBlockers]);
  if (!google.tree) return <p className="text-sm text-muted-foreground">Loading keywords…</p>;
  return (
    <div className="space-y-4">
      <AdGroupsKeywordsStep surface="drawer" tree={google.tree} onChange={google.onChange} />
      <NegativesStep surface="drawer" tree={google.tree} onChange={google.onChange} />
    </div>
  );
}

function StatusDot({ count }: { count: number }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-1.5 w-1.5 rounded-full ${count > 0 ? "bg-warning" : "bg-emerald-700"}`}
    />
  );
}
