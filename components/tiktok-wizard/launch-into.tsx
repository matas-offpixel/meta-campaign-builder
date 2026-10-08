"use client";

import { useEffect, useMemo, useState } from "react";

import { Datum, StatusLine } from "@/components/steps/step-surface";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { describeTikTokAttachLaunch, TIKTOK_LAUNCH_MODE_LABELS } from "@/lib/tiktok/attach/summary";
import { inheritTikTokConversion } from "@/lib/tiktok/attach/plan";
import { draftObjectiveForTikTokObjectiveType } from "@/lib/tiktok/attach/targets";
import {
  filterTikTokAttachOptions,
  tikTokAttachBudgetLabel,
  tikTokAttachCampaignDisabledReason,
  toggleTikTokAttachAdGroup,
  toggleTikTokAttachCampaign,
  type TikTokAttachAdGroupOption,
  type TikTokAttachCampaignOption,
} from "@/lib/tiktok/attach/picker";
import {
  TIKTOK_LAUNCH_MODES,
  type TikTokCampaignDraft,
  type TikTokLaunchMode,
} from "@/lib/types/tiktok-draft";

type Load<T> = { status: "idle" | "loading" } | { status: "ok"; rows: T[] } | { status: "error"; message: string };
type Keyed<T> = { key: string; result: Load<T> };

/** The response for `key`, or loading while it is in flight; idle with no key. */
function view<T>(state: Keyed<T> | null, key: string | null): Load<T> {
  if (!key) return { status: "idle" };
  return state?.key === key ? state.result : { status: "loading" };
}

/**
 * "Launch into" — New campaign, or existing campaigns / ad groups on the
 * draft's advertiser. Selections are stored on the draft with their
 * names as they were when picked; Launch re-reads them live.
 */
export function TikTokLaunchInto({
  draft,
  onSave,
  disabled = false,
}: {
  draft: TikTokCampaignDraft;
  onSave: (patch: Partial<TikTokCampaignDraft>) => Promise<void>;
  disabled?: boolean;
}) {
  const mode: TikTokLaunchMode = draft.launchMode ?? "new";
  const advertiserId = draft.accountSetup.advertiserId;
  const [campaignState, setCampaigns] = useState<Keyed<TikTokAttachCampaignOption> | null>(null);
  const [adGroupState, setAdGroups] = useState<Keyed<TikTokAttachAdGroupOption> | null>(null);
  const [campaignQuery, setCampaignQuery] = useState("");
  const [adGroupQuery, setAdGroupQuery] = useState("");

  const selectedCampaigns = useMemo(() => draft.attachCampaigns ?? [], [draft.attachCampaigns]);
  const selectedAdGroups = draft.attachAdGroups ?? [];
  const campaignKey = selectedCampaigns.map((c) => c.id).join(",");
  const campaignsUrl =
    mode !== "new" && advertiserId
      ? `/api/tiktok/attach-targets?advertiserId=${encodeURIComponent(advertiserId)}`
      : null;
  const adGroupsUrl =
    (mode === "attach_adgroup" || mode === "attach_campaign") && advertiserId && campaignKey
      ? `/api/tiktok/attach-targets?advertiserId=${encodeURIComponent(advertiserId)}&campaignIds=${encodeURIComponent(campaignKey)}`
      : null;
  const campaigns = view(campaignState, campaignsUrl);
  const adGroups = view(adGroupState, adGroupsUrl);

  useEffect(() => {
    if (!campaignsUrl) return;
    let cancelled = false;
    fetch(campaignsUrl)
      .then((res) => res.json())
      .then((body: { ok: boolean; error?: string; campaigns?: TikTokAttachCampaignOption[] }) => {
        if (cancelled) return;
        setCampaigns({
          key: campaignsUrl,
          result: body.ok
            ? { status: "ok", rows: body.campaigns ?? [] }
            : { status: "error", message: body.error ?? "Could not read TikTok campaigns" },
        });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setCampaigns({
            key: campaignsUrl,
            result: { status: "error", message: err instanceof Error ? err.message : String(err) },
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [campaignsUrl]);

  useEffect(() => {
    if (!adGroupsUrl) return;
    let cancelled = false;
    fetch(adGroupsUrl)
      .then((res) => res.json())
      .then((body: { ok: boolean; error?: string; adGroups?: TikTokAttachAdGroupOption[] }) => {
        if (cancelled) return;
        setAdGroups({
          key: adGroupsUrl,
          result: body.ok
            ? { status: "ok", rows: body.adGroups ?? [] }
            : { status: "error", message: body.error ?? "Could not read TikTok ad groups" },
        });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setAdGroups({
            key: adGroupsUrl,
            result: { status: "error", message: err instanceof Error ? err.message : String(err) },
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [adGroupsUrl]);

  const summary = describeTikTokAttachLaunch(draft);
  const draftPixel = draft.accountSetup.pixelId;
  const draftEvent = draft.accountSetup.optimisationEvent;

  return (
    <section aria-label="Launch into" className="space-y-3 rounded-md border border-border bg-background p-4">
      <Select
        id="tiktok-launch-into"
        label="Launch into"
        className="w-64"
        value={mode}
        disabled={disabled}
        options={TIKTOK_LAUNCH_MODES.map((value) => ({ value, label: TIKTOK_LAUNCH_MODE_LABELS[value] }))}
        onChange={(event) => void onSave({ launchMode: event.target.value as TikTokLaunchMode })}
      />

      {mode !== "new" && !advertiserId ? (
        <StatusLine tone="alert" className="text-sm text-red-700">
          Pick a TikTok advertiser first.
        </StatusLine>
      ) : null}

      {mode !== "new" && advertiserId ? (
        <div className="space-y-2">
          <Datum className="text-sm font-medium">
            {mode === "attach_adgroup" ? "Campaigns to browse" : "Campaigns"}
          </Datum>
          <Input
            id="tiktok-attach-campaign-search"
            placeholder="Search campaigns"
            value={campaignQuery}
            disabled={disabled}
            onChange={(event) => setCampaignQuery(event.target.value)}
          />
          {campaigns.status === "loading" ? <Datum className="text-xs text-muted-foreground">Reading campaigns…</Datum> : null}
          {campaigns.status === "error" ? (
            <StatusLine tone="alert" className="text-sm text-red-700">{campaigns.message}</StatusLine>
          ) : null}
          {campaigns.status === "ok" ? (
            <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
              {filterTikTokAttachOptions(campaigns.rows, campaignQuery).map((option) => {
                const reason = tikTokAttachCampaignDisabledReason(option, mode);
                const checked = selectedCampaigns.some((s) => s.id === option.id);
                return (
                  <li key={option.id}>
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled || (reason != null && !checked)}
                        onChange={() =>
                          void onSave({ attachCampaigns: toggleTikTokAttachCampaign(selectedCampaigns, option) })
                        }
                      />
                      <span>
                        <span className="font-medium">{option.name}</span>{" "}
                        <span className="text-xs text-muted-foreground">
                          {option.operationStatus ?? "—"} · {option.objectiveType ?? "—"} ·{" "}
                          {tikTokAttachBudgetLabel(option)} ·{" "}
                          {option.adGroupCount == null ? "? ad groups" : `${option.adGroupCount} ad groups`}
                          {reason ? ` · ${reason}` : ""}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}

      {mode === "attach_adgroup" && campaignKey ? (
        <div className="space-y-2">
          <Datum className="text-sm font-medium">Ad groups</Datum>
          <Input
            id="tiktok-attach-adgroup-search"
            placeholder="Search ad groups"
            value={adGroupQuery}
            disabled={disabled}
            onChange={(event) => setAdGroupQuery(event.target.value)}
          />
          {adGroups.status === "loading" ? <Datum className="text-xs text-muted-foreground">Reading ad groups…</Datum> : null}
          {adGroups.status === "error" ? (
            <StatusLine tone="alert" className="text-sm text-red-700">{adGroups.message}</StatusLine>
          ) : null}
          {adGroups.status === "ok" ? (
            <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
              {filterTikTokAttachOptions(adGroups.rows, adGroupQuery).map((option) => {
                const checked = selectedAdGroups.some((s) => s.id === option.id);
                const campaignName =
                  selectedCampaigns.find((c) => c.id === option.campaignId)?.name ?? option.campaignName ?? option.campaignId;
                return (
                  <li key={option.id}>
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled || (option.smartPlus && !checked)}
                        onChange={() =>
                          void onSave({
                            attachAdGroups: toggleTikTokAttachAdGroup(selectedAdGroups, option, campaignName),
                          })
                        }
                      />
                      <span>
                        <span className="font-medium">{option.name}</span>{" "}
                        <span className="text-xs text-muted-foreground">
                          {campaignName} · {option.operationStatus ?? "—"} · {option.optimizationGoal ?? "—"}
                          {option.optimizationEvent ? ` · ${option.optimizationEvent}` : ""}
                          {option.smartPlus ? " · Smart+ — not supported" : ""}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}

      {mode === "attach_campaign" && selectedCampaigns.length > 0 ? (
        <div className="space-y-1 text-sm">
          <Datum className="font-medium">Pixel and event for new ad groups</Datum>
          {adGroups.status === "ok"
            ? selectedCampaigns.map((campaign) => {
                const inherited = inheritTikTokConversion(
                  adGroups.rows.filter((row) => row.campaignId === campaign.id),
                  draftObjectiveForTikTokObjectiveType(campaign.objectiveType),
                );
                return (
                  <Datum key={campaign.id} className="text-xs text-muted-foreground">
                    {campaign.name}:{" "}
                    {inherited
                      ? `${inherited.pixelId} · ${inherited.optimisationEvent} (${inherited.matching} of ${inherited.withPixel} ad groups)`
                      : "no ad group with a usable pixel and event — the draft's is used"}
                  </Datum>
                );
              })
            : null}
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={Boolean(draft.attachConversionOverride)}
              disabled={disabled || !draftPixel || !draftEvent}
              onChange={(event) =>
                void onSave({
                  attachConversionOverride:
                    event.target.checked && draftPixel && draftEvent
                      ? { pixelId: draftPixel, optimisationEvent: draftEvent }
                      : null,
                })
              }
            />
            Use the draft&apos;s pixel and event instead ({draftPixel ?? "none"} · {draftEvent ?? "none"})
          </label>
        </div>
      ) : null}

      {summary ? (
        <div className="space-y-1 rounded-md bg-muted/40 p-3 text-sm">
          <Datum className="font-medium">Launch creates {summary.headline}</Datum>
          {summary.into.length > 0 ? (
            <ul className="list-disc pl-5 text-xs text-muted-foreground">
              {summary.into.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
          <Datum className="text-xs text-muted-foreground">
            Existing campaigns and ad groups are never changed. If a write fails, only what this launch created is removed.
          </Datum>
        </div>
      ) : null}
    </section>
  );
}
