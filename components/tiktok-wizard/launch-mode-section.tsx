"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Info, Layers, Link2, ListChecks, Plus, X } from "lucide-react";

import { CardDescription, Datum, StatusLine } from "@/components/steps/step-surface";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  inheritTikTokConversion,
  tikTokAttachObjectiveMismatchMessage,
  tikTokAttachSmartPlusMessage,
  tikTokAttachUnsupportedObjectiveMessage,
} from "@/lib/tiktok/attach/plan";
import { draftObjectiveForTikTokObjectiveType } from "@/lib/tiktok/attach/targets";
import {
  filterTikTokAttachOptions,
  tikTokAttachCampaignDisabledReason,
  toggleTikTokAttachAdGroup,
  toggleTikTokAttachCampaign,
  type TikTokAttachAdGroupOption,
  type TikTokAttachCampaignOption,
} from "@/lib/tiktok/attach/picker";
import { validOptimisationGoalForObjective } from "@/lib/tiktok-wizard/campaign-setup";
import {
  isSmartPlusTikTokSnapshot,
  TIKTOK_ATTACH_ALL_NOTE,
  TIKTOK_CAMPAIGN_SUB_TILES,
  TIKTOK_LAUNCH_MODE_READ_ONLY_NOTE,
  TIKTOK_LAUNCH_TILES,
  tikTokLaunchModeForTile,
  tikTokLaunchModeOf,
  tikTokLaunchModePatch,
  tikTokLaunchModeReadOnly,
  tikTokLaunchTileForMode,
  tikTokObjectiveBadge,
  tikTokStatusChip,
  type TikTokLaunchTile,
} from "@/lib/tiktok-wizard/launch-mode";
import type {
  TikTokAttachCampaignSnapshot,
  TikTokCampaignDraft,
  TikTokLaunchMode,
} from "@/lib/types/tiktok-draft";

type Load<T> = { status: "idle" | "loading" } | { status: "ok"; rows: T[] } | { status: "error"; message: string };
type Keyed<T> = { key: string; result: Load<T> };

/** The response for `key`, or loading while it is in flight; idle with no key. */
function view<T>(state: Keyed<T> | null, key: string | null): Load<T> {
  if (!key) return { status: "idle" };
  return state?.key === key ? state.result : { status: "loading" };
}

function useAttachRows<T>(url: string | null, field: "campaigns" | "adGroups", fallback: string): Load<T> {
  const [state, setState] = useState<Keyed<T> | null>(null);
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    fetch(url)
      .then((res) => res.json())
      .then((body: { ok: boolean; error?: string } & Partial<Record<typeof field, T[]>>) => {
        if (cancelled) return;
        setState({
          key: url,
          result: body.ok
            ? { status: "ok", rows: body[field] ?? [] }
            : { status: "error", message: body.error ?? fallback },
        });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({
            key: url,
            result: { status: "error", message: err instanceof Error ? err.message : String(err) },
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [url, field, fallback]);
  return view(state, url);
}

const TILE_ICONS: Record<TikTokLaunchTile, typeof Plus> = {
  new: Plus,
  campaign: Link2,
  adgroup: Layers,
};

const SUB_TILE_ICONS = { attach_campaign: Plus, attach_all_adgroups: ListChecks } as const;

/**
 * "What do you want to do?" — new campaign, existing campaigns or
 * existing ad groups on the draft's advertiser. Selections are stored on
 * the draft with their names as they were when picked; Launch re-reads
 * them live. Read-only once the draft has launched.
 */
export function TikTokLaunchModeSection({
  draft,
  onSave,
  compact = false,
}: {
  draft: TikTokCampaignDraft;
  onSave: (patch: Partial<TikTokCampaignDraft>) => Promise<void>;
  compact?: boolean;
}) {
  const readOnly = tikTokLaunchModeReadOnly(draft);
  const mode = tikTokLaunchModeOf(draft);
  const tile = tikTokLaunchTileForMode(mode);
  const advertiserId = draft.accountSetup.advertiserId;
  const [campaignQuery, setCampaignQuery] = useState("");
  const [adGroupQuery, setAdGroupQuery] = useState("");

  const selectedCampaigns = useMemo(() => draft.attachCampaigns ?? [], [draft.attachCampaigns]);
  const selectedAdGroups = draft.attachAdGroups ?? [];
  const campaignKey = selectedCampaigns.map((c) => c.id).join(",");
  const campaignsUrl =
    mode !== "new" && advertiserId && !readOnly
      ? `/api/tiktok/attach-targets?advertiserId=${encodeURIComponent(advertiserId)}`
      : null;
  const adGroupsUrl =
    (mode === "attach_adgroup" || mode === "attach_campaign") && advertiserId && campaignKey && !readOnly
      ? `/api/tiktok/attach-targets?advertiserId=${encodeURIComponent(advertiserId)}&campaignIds=${encodeURIComponent(campaignKey)}`
      : null;
  const campaigns = useAttachRows<TikTokAttachCampaignOption>(campaignsUrl, "campaigns", "Could not read TikTok campaigns");
  const adGroups = useAttachRows<TikTokAttachAdGroupOption>(adGroupsUrl, "adGroups", "Could not read TikTok ad groups");

  function setMode(next: TikTokLaunchMode) {
    if (readOnly) return;
    const patch = tikTokLaunchModePatch(draft, next);
    if (Object.keys(patch).length > 0) void onSave(patch);
  }

  function removeCampaign(campaign: TikTokAttachCampaignSnapshot) {
    void onSave({
      attachCampaigns: selectedCampaigns.filter((c) => c.id !== campaign.id),
      ...(mode === "attach_adgroup"
        ? { attachAdGroups: selectedAdGroups.filter((g) => g.campaignId !== campaign.id) }
        : {}),
    });
  }

  const draftPixel = draft.accountSetup.pixelId;
  const draftEvent = draft.accountSetup.optimisationEvent;
  const draftGoal = draft.campaignSetup.optimisationGoal;
  const campaignFamily = tile === "campaign";

  return (
    <section aria-label="Launch into" className={compact ? "space-y-2" : "space-y-4"}>
      <Block compact={compact} title="What do you want to do?" description="Create a fresh campaign at launch, add a new ad group to a live campaign, or add new ads under existing live ad groups.">
        <div className={`grid grid-cols-1 gap-2 ${compact ? "" : "sm:grid-cols-3"}`}>
          {TIKTOK_LAUNCH_TILES.map((option) => (
            <Tile
              key={option.tile}
              icon={TILE_ICONS[option.tile]}
              label={option.label}
              description={option.description}
              selected={tile === option.tile}
              disabled={readOnly}
              compact={compact}
              onClick={() => setMode(tikTokLaunchModeForTile(option.tile, mode))}
            />
          ))}
        </div>
        {readOnly ? (
          <StatusLine className="mt-2 text-xs text-muted-foreground">{TIKTOK_LAUNCH_MODE_READ_ONLY_NOTE}</StatusLine>
        ) : null}
      </Block>

      {mode !== "new" && !advertiserId ? (
        <StatusLine tone="alert" className="text-sm text-red-700">
          Pick a TikTok advertiser first.
        </StatusLine>
      ) : null}

      {mode !== "new" && advertiserId && !readOnly ? (
        <Block
          compact={compact}
          title={
            mode === "attach_adgroup"
              ? "Pick parent campaigns"
              : selectedCampaigns.length > 0
                ? `Pick existing campaigns (${selectedCampaigns.length} selected)`
                : "Pick existing campaigns"
          }
          description={
            mode === "attach_adgroup"
              ? "Choose the campaigns whose ad groups you want to add ads to."
              : "Each campaign keeps its own objective and budget. Smart+ campaigns can't be selected."
          }
        >
          <Input
            id="tiktok-attach-campaign-search"
            placeholder="Search campaigns"
            value={campaignQuery}
            onChange={(event) => setCampaignQuery(event.target.value)}
          />
          {campaigns.status === "loading" ? <Datum className="mt-2 text-xs text-muted-foreground">Reading campaigns…</Datum> : null}
          {campaigns.status === "error" ? (
            <StatusLine tone="alert" className="mt-2 text-sm text-red-700">{campaigns.message}</StatusLine>
          ) : null}
          {campaigns.status === "ok" ? (
            <ul className={`mt-2 space-y-1 overflow-y-auto text-sm ${compact ? "max-h-48" : "max-h-64"}`}>
              {filterTikTokAttachOptions(campaigns.rows, campaignQuery).map((option) => {
                const reason = tikTokAttachCampaignDisabledReason(option, mode);
                const checked = selectedCampaigns.some((s) => s.id === option.id);
                return (
                  <li key={option.id}>
                    <label className={`flex items-start gap-2 ${reason && !checked ? "opacity-50" : ""}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={reason != null && !checked}
                        onChange={() =>
                          void onSave({ attachCampaigns: toggleTikTokAttachCampaign(selectedCampaigns, option) })
                        }
                      />
                      <span>
                        <span className="font-medium">{option.name}</span>{" "}
                        <span className="text-xs text-muted-foreground">
                          {tikTokStatusChip(option.operationStatus)} · {option.objectiveType ?? "—"} ·{" "}
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
        </Block>
      ) : null}

      {campaignFamily && selectedCampaigns.length > 0 ? (
        <Block
          compact={compact}
          title={selectedCampaigns.length === 1 ? "Selected campaign" : `Selected campaigns (${selectedCampaigns.length})`}
        >
          <ul className="space-y-2">
            {selectedCampaigns.map((campaign) => {
              const objective = draftObjectiveForTikTokObjectiveType(campaign.objectiveType);
              const smartPlus = isSmartPlusTikTokSnapshot(campaign);
              const inherited =
                mode === "attach_campaign" && adGroups.status === "ok"
                  ? inheritTikTokConversion(
                      adGroups.rows.filter((row) => row.campaignId === campaign.id),
                      objective,
                    )
                  : null;
              const mismatch =
                mode !== "attach_campaign" || smartPlus
                  ? null
                  : !objective
                    ? tikTokAttachUnsupportedObjectiveMessage({
                        campaignName: campaign.name,
                        objectiveType: campaign.objectiveType,
                      })
                    : draftGoal && !validOptimisationGoalForObjective(objective, draftGoal)
                      ? tikTokAttachObjectiveMismatchMessage({
                          campaignName: campaign.name,
                          objectiveType: campaign.objectiveType ?? objective,
                          goal: draftGoal,
                        })
                      : null;
              return (
                <li
                  key={campaign.id}
                  data-selected-campaign={campaign.id}
                  className="flex items-start gap-3 rounded-md border border-primary bg-primary-light/40 p-3 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium">{campaign.name}</span>
                      <Badge variant="primary">{tikTokObjectiveBadge(campaign.objectiveType)}</Badge>
                      <Badge variant="outline">{tikTokStatusChip(campaign.status)}</Badge>
                      {smartPlus ? <Badge variant="destructive">Smart+ — not supported</Badge> : null}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <code className="rounded bg-muted px-1.5 py-0.5">{campaign.id}</code>
                      <span>Raw objective: {campaign.objectiveType ?? "—"}</span>
                      <span>CBO {campaign.budgetOptimizeOn ? "on" : "off"}</span>
                      {campaign.adGroupCount != null ? (
                        <span>{campaign.adGroupCount} ad group{campaign.adGroupCount === 1 ? "" : "s"}</span>
                      ) : null}
                    </div>
                    {mode === "attach_campaign" && !draft.attachConversionOverride && !readOnly ? (
                      <Datum className="mt-1 text-[11px] text-muted-foreground">
                        {adGroups.status === "ok"
                          ? inherited
                            ? `Pixel ${inherited.pixelId} · ${inherited.optimisationEvent} (from ${inherited.matching} of ${inherited.withPixel} ad groups)`
                            : "No ad group with a usable pixel and event: the draft's is used"
                          : adGroups.status === "loading"
                            ? "Reading pixel and event…"
                            : null}
                      </Datum>
                    ) : null}
                    {smartPlus ? (
                      <StatusLine tone="alert" className="mt-1 text-xs text-red-700">
                        {tikTokAttachSmartPlusMessage("campaign", campaign.name)}
                      </StatusLine>
                    ) : null}
                    {mismatch ? (
                      <StatusLine tone="alert" className="mt-1 text-xs text-red-700">{mismatch}</StatusLine>
                    ) : null}
                  </div>
                  {readOnly ? null : (
                    <button
                      type="button"
                      onClick={() => removeCampaign(campaign)}
                      className="rounded p-1 text-muted-foreground hover:bg-card hover:text-foreground"
                      aria-label={`Remove ${campaign.name}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="mt-4 space-y-2">
            <Datum className="text-sm text-muted-foreground">What should happen under each campaign at launch?</Datum>
            <div className={`grid grid-cols-1 gap-2 ${compact ? "" : "sm:grid-cols-2"}`}>
              {TIKTOK_CAMPAIGN_SUB_TILES.map((option) => (
                <Tile
                  key={option.mode}
                  icon={SUB_TILE_ICONS[option.mode]}
                  label={option.label}
                  description={option.description}
                  selected={mode === option.mode}
                  disabled={readOnly}
                  compact={compact}
                  onClick={() => setMode(option.mode)}
                />
              ))}
            </div>
          </div>

          {mode === "attach_all_adgroups" ? (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-primary/30 bg-primary-light/30 px-3 py-2 text-xs">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <span>
                <span className="font-medium text-foreground">Attach-all mode.</span> {TIKTOK_ATTACH_ALL_NOTE}
              </span>
            </div>
          ) : null}

          {mode === "attach_campaign" && !readOnly ? (
            <label className="mt-3 flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={Boolean(draft.attachConversionOverride)}
                disabled={!draftPixel || !draftEvent}
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
          ) : null}
        </Block>
      ) : null}

      {mode === "attach_adgroup" && (selectedCampaigns.length > 0 || selectedAdGroups.length > 0) ? (
        <Block
          compact={compact}
          title={selectedAdGroups.length > 0 ? `Ad groups (${selectedAdGroups.length} selected)` : "Pick ad groups"}
          description="New ads are added to each. Audience, budget and optimisation stay as they are."
        >
          {selectedAdGroups.length > 0 ? (
            <ul className="mb-3 space-y-2">
              {selectedAdGroups.map((group) => {
                const smartPlus = isSmartPlusTikTokSnapshot(group);
                return (
                  <li
                    key={group.id}
                    data-selected-adgroup={group.id}
                    className="flex items-start gap-3 rounded-md border border-primary bg-primary-light/40 p-3 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium">{group.name}</span>
                        <Badge variant="outline">{tikTokStatusChip(group.status)}</Badge>
                        {smartPlus ? <Badge variant="destructive">Smart+ — not supported</Badge> : null}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        <code className="rounded bg-muted px-1.5 py-0.5">{group.id}</code>
                        <span>{group.campaignName}</span>
                        <span>
                          {group.optimizationGoal ?? "—"}
                          {group.optimizationEvent ? ` · ${group.optimizationEvent}` : ""}
                          {group.pixelId ? ` · pixel ${group.pixelId}` : ""}
                        </span>
                      </div>
                    </div>
                    {readOnly ? null : (
                      <button
                        type="button"
                        onClick={() =>
                          void onSave({ attachAdGroups: selectedAdGroups.filter((g) => g.id !== group.id) })
                        }
                        className="rounded p-1 text-muted-foreground hover:bg-card hover:text-foreground"
                        aria-label={`Remove ${group.name}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}
          {!readOnly && campaignKey ? (
            <>
              <Input
                id="tiktok-attach-adgroup-search"
                placeholder="Search ad groups"
                value={adGroupQuery}
                onChange={(event) => setAdGroupQuery(event.target.value)}
              />
              {adGroups.status === "loading" ? <Datum className="mt-2 text-xs text-muted-foreground">Reading ad groups…</Datum> : null}
              {adGroups.status === "error" ? (
                <StatusLine tone="alert" className="mt-2 text-sm text-red-700">{adGroups.message}</StatusLine>
              ) : null}
              {adGroups.status === "ok" ? (
                <ul className={`mt-2 space-y-1 overflow-y-auto text-sm ${compact ? "max-h-48" : "max-h-64"}`}>
                  {filterTikTokAttachOptions(adGroups.rows, adGroupQuery).map((option) => {
                    const checked = selectedAdGroups.some((s) => s.id === option.id);
                    const campaignName =
                      selectedCampaigns.find((c) => c.id === option.campaignId)?.name ?? option.campaignName ?? option.campaignId;
                    return (
                      <li key={option.id}>
                        <label className={`flex items-start gap-2 ${option.smartPlus && !checked ? "opacity-50" : ""}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={option.smartPlus && !checked}
                            onChange={() =>
                              void onSave({
                                attachAdGroups: toggleTikTokAttachAdGroup(selectedAdGroups, option, campaignName),
                              })
                            }
                          />
                          <span>
                            <span className="font-medium">{option.name}</span>{" "}
                            <span className="text-xs text-muted-foreground">
                              {campaignName} · {tikTokStatusChip(option.operationStatus)} · {option.optimizationGoal ?? "—"}
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
            </>
          ) : null}
        </Block>
      ) : null}
    </section>
  );
}

function Block({
  compact,
  title,
  description,
  children,
}: {
  compact: boolean;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  if (compact) {
    return (
      <div className="space-y-2">
        <Datum className="text-xs font-medium text-foreground">{title}</Datum>
        {children}
      </div>
    );
  }
  return (
    <Card>
      <CardTitle>{title}</CardTitle>
      {description ? <CardDescription>{description}</CardDescription> : null}
      <div className="mt-3">{children}</div>
    </Card>
  );
}

function Tile({
  icon: Icon,
  label,
  description,
  selected,
  disabled,
  compact,
  onClick,
}: {
  icon: typeof Plus;
  label: string;
  description: string;
  selected: boolean;
  disabled: boolean;
  compact: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={`flex items-start gap-3 rounded-md border text-left transition-colors ${compact ? "px-2 py-2" : "px-3 py-3"}
        ${disabled
          ? selected
            ? "cursor-not-allowed border-foreground bg-card ring-1 ring-foreground opacity-70"
            : "cursor-not-allowed border-border bg-muted/30 opacity-50"
          : selected
            ? "border-foreground bg-card ring-1 ring-foreground"
            : "border-border-strong hover:bg-card/60"}`}
    >
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${selected ? "text-foreground" : "text-muted-foreground"}`} />
      <div className="min-w-0 flex-1">
        <Datum className="text-sm font-medium">{label}</Datum>
        <Datum className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{description}</Datum>
      </div>
    </button>
  );
}
