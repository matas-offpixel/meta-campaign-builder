"use client";

import { CardDescription, Datum, StatusLine, StepSurfaceProvider, type StepSurface } from "@/components/steps/step-surface";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  shouldOpenManualIdentityHatch,
  tikTokIdentityFace,
  tikTokIdentityOptionView,
} from "@/lib/tiktok-wizard/account-setup";
import { TIKTOK_PIXEL_ID_PATTERN } from "@/lib/tiktok-wizard/validation";
import type { TikTokIdentityType } from "@/lib/tiktok/identity";
import {
  formatTikTokOptimisationEventLabel,
  isUnsupportedTikTokOptimisationEvent,
  tikTokUnsupportedOptimisationEventMessage,
} from "@/lib/tiktok/optimisation-event";
import type { TikTokAccount } from "@/lib/types/tiktok";
import type { TikTokCampaignDraft } from "@/lib/types/tiktok-draft";
import { InfoTip } from "@/components/viz/info-tip";
import { TIKTOK_DRAWER_COPY } from "@/lib/plan/drawer";
import {
  isTikTokConversionObjective,
  tikTokPixelNotFiredMessage,
  tikTokSalesPixelNotFiredMessage,
} from "@/lib/plan/tiktok-early";

interface TikTokIdentityOption {
  identity_id: string;
  display_name: string;
  identity_type: TikTokIdentityType | null;
  avatar_url?: string | null;
  identity_bc_id?: string | null;
}

interface TikTokPixelOption {
  pixel_id: string;
  pixel_name: string;
  status: string | null;
}

interface TikTokPixelEventOption {
  optimization_event: string;
  name: string;
}

const MANUAL_IDENTITY_TYPES: TikTokIdentityType[] = [
  "AUTH_CODE",
  "BC_AUTH_TT",
  "CUSTOMIZED_USER",
  "TT_USER",
];

export function AccountSetupStep({
  draft,
  onSave,
  surface = "wizard",
}: {
  draft: TikTokCampaignDraft;
  onSave: (patch: Partial<TikTokCampaignDraft>) => Promise<void>;
  surface?: StepSurface;
}) {
  const [accounts, setAccounts] = useState<TikTokAccount[]>([]);
  const [identities, setIdentities] = useState<TikTokIdentityOption[]>([]);
  const [pixels, setPixels] = useState<TikTokPixelOption[]>([]);
  const [pixelEvents, setPixelEvents] = useState<TikTokPixelEventOption[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [identityWarning, setIdentityWarning] = useState<string | null>(null);
  const [identityFailed, setIdentityFailed] = useState(false);
  const [identityReload, setIdentityReload] = useState(0);
  const [pixelWarning, setPixelWarning] = useState<string | null>(null);
  const [pixelApiFailed, setPixelApiFailed] = useState(false);
  const [manualIdentityId, setManualIdentityId] = useState(
    draft.accountSetup.identityId ?? "",
  );
  const [manualIdentityType, setManualIdentityType] = useState<
    TikTokIdentityType | ""
  >(
    draft.accountSetup.identityType &&
      draft.accountSetup.identityType !== "MANUAL"
      ? draft.accountSetup.identityType
      : "",
  );
  const [manualIdentityName, setManualIdentityName] = useState(
    draft.accountSetup.identityManualName ?? "",
  );
  const [manualPixelId, setManualPixelId] = useState(
    draft.accountSetup.pixelId ?? "",
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingAccounts(true);
    fetch("/api/tiktok/accounts", { cache: "no-store" })
      .then((res) => res.json())
      .then((json: { ok?: boolean; accounts?: TikTokAccount[] }) => {
        if (cancelled) return;
        setAccounts(json.ok ? (json.accounts ?? []) : []);
      })
      .catch(() => {
        if (!cancelled) setAccounts([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingAccounts(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const selectedAdvertiserId = draft.accountSetup.advertiserId;
    if (!selectedAdvertiserId) {
      setIdentities([]);
      setPixels([]);
      setPixelEvents([]);
      return;
    }
    const advertiserId = selectedAdvertiserId;
    let cancelled = false;
    setLoadingDetails(true);
    setIdentityWarning(null);
    setIdentityFailed(false);
    setPixelWarning(null);
    setPixelApiFailed(false);

    async function loadDetails() {
      const [identityRes, pixelRes] = await Promise.allSettled([
        fetch(`/api/tiktok/identities?advertiser_id=${encodeURIComponent(advertiserId)}`),
        fetch(`/api/tiktok/pixels?advertiser_id=${encodeURIComponent(advertiserId)}`),
      ]);
      if (cancelled) return;

      if (identityRes.status === "fulfilled") {
        const json = (await identityRes.value.json().catch(() => null)) as {
          ok?: boolean;
          failed?: boolean;
          identities?: TikTokIdentityOption[];
          error?: string;
        } | null;
        const next = json?.ok ? (json.identities ?? []) : [];
        setIdentities(next);
        if (json?.failed === true) {
          setIdentityFailed(true);
          setIdentityWarning(
            json.error || "TikTok identity read failed",
          );
        } else if (!json?.ok && json?.error) {
          setIdentityFailed(true);
          setIdentityWarning(json.error);
        } else if (next.length === 0) {
          setIdentityFailed(false);
          setIdentityWarning(
            "No identities available. Use the manual override below.",
          );
        }
      } else {
        setIdentities([]);
        setIdentityFailed(true);
        setIdentityWarning(
          "TikTok identity API returned: request failed.",
        );
      }

      if (pixelRes.status === "fulfilled") {
        const json = (await pixelRes.value.json().catch(() => null)) as {
          ok?: boolean;
          pixels?: TikTokPixelOption[];
          currency?: string | null;
          timezone?: string | null;
          error?: string;
        } | null;
        const next = json?.ok ? (json.pixels ?? []) : [];
        setPixels(next);
        if (json?.ok) {
          const nextAccount: Partial<typeof draft.accountSetup> = {};
          if (json.currency && json.currency !== draft.accountSetup.currency) {
            nextAccount.currency = json.currency;
          }
          if (json.timezone && json.timezone !== draft.accountSetup.timezone) {
            nextAccount.timezone = json.timezone;
          }
          if (Object.keys(nextAccount).length > 0) {
            await persist(nextAccount);
          }
        }
        if (!json?.ok && json?.error) {
          setPixelApiFailed(true);
          setPixelWarning(`TikTok pixel API returned: ${json.error}. Enter a pixel ID manually below.`);
        } else if (next.length === 0) {
          setPixelWarning("No pixels configured for this advertiser.");
        }
      } else {
        setPixels([]);
        setPixelApiFailed(true);
        setPixelWarning("TikTok pixel API returned: request failed. Enter a pixel ID manually below.");
      }
    }

    void loadDetails().finally(() => {
      if (!cancelled) setLoadingDetails(false);
    });
    return () => {
      cancelled = true;
    };
  }, [draft.accountSetup.advertiserId, identityReload]);

  useEffect(() => {
    const advertiserId = draft.accountSetup.advertiserId;
    const pixelId = draft.accountSetup.pixelId;
    if (!advertiserId || !pixelId) {
      setPixelEvents([]);
      return;
    }
    let cancelled = false;
    setLoadingEvents(true);
    fetch(
      `/api/tiktok/pixels?advertiser_id=${encodeURIComponent(advertiserId)}&pixel_id=${encodeURIComponent(pixelId)}`,
    )
      .then((res) => res.json())
      .then((json: { ok?: boolean; events?: TikTokPixelEventOption[] }) => {
        if (cancelled) return;
        setPixelEvents(json.ok ? (json.events ?? []) : []);
      })
      .catch(() => {
        if (!cancelled) setPixelEvents([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingEvents(false);
      });
    return () => {
      cancelled = true;
    };
  }, [draft.accountSetup.advertiserId, draft.accountSetup.pixelId]);

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === draft.accountSetup.tiktokAccountId),
    [accounts, draft.accountSetup.tiktokAccountId],
  );
  const selectedIdentityNeedsType = Boolean(
    draft.accountSetup.identityId &&
      !isListedIdentityType(draft.accountSetup.identityType),
  );
  const hatchAutoOpen = shouldOpenManualIdentityHatch({
    identityFailed,
    identitiesLength: identities.length,
    selectedIdentityNeedsType,
    loadingDetails,
    hasAdvertiser: Boolean(draft.accountSetup.advertiserId),
  });

  async function saveAccount(accountId: string) {
    const account = accounts.find((candidate) => candidate.id === accountId);
    await persist({
      tiktokAccountId: account?.id ?? null,
      advertiserId: account?.tiktok_advertiser_id ?? null,
      identityId: null,
      identityDisplayName: null,
      identityManualName: null,
      identityBcId: null,
      identityType: null,
      pixelId: null,
      pixelName: null,
      optimisationEvent: null,
      currency: null,
    });
    setManualIdentityId("");
    setManualIdentityType("");
    setManualIdentityName("");
  }

  async function saveIdentity(identityId: string) {
    const identity = identities.find((candidate) => candidate.identity_id === identityId);
    const resolvedType =
      identity && isListedIdentityType(identity.identity_type)
        ? identity.identity_type
        : null;
    await persist({
      identityId: identity?.identity_id ?? null,
      identityDisplayName: identity?.display_name ?? null,
      identityManualName: null,
      identityBcId: identity?.identity_bc_id?.trim() || null,
      identityType: resolvedType,
    });
    if (resolvedType) {
      setManualIdentityId("");
      setManualIdentityType("");
      setManualIdentityName("");
      return;
    }
    setManualIdentityId(identity?.identity_id ?? "");
    setManualIdentityType("");
    setManualIdentityName("");
  }

  async function saveIdentityType(nextType: TikTokIdentityType | "") {
    setManualIdentityType(nextType);
    if (!nextType || !draft.accountSetup.identityId) return;
    if (isListedIdentityType(draft.accountSetup.identityType)) return;
    await persist({ identityType: nextType });
  }

  async function savePixel(pixelId: string) {
    const pixel = pixels.find((candidate) => candidate.pixel_id === pixelId);
    await persist({
      pixelId: pixel?.pixel_id ?? null,
      pixelName: pixel?.pixel_name ?? null,
      optimisationEvent: null,
    });
  }

  async function saveOptimisationEvent(optimizationEvent: string) {
    await persist({
      optimisationEvent: optimizationEvent || null,
    });
  }

  async function saveManualPixel() {
    const value = manualPixelId.trim();
    if (value && !TIKTOK_PIXEL_ID_PATTERN.test(value)) {
      setSaveError("TikTok pixel IDs are typically numeric strings.");
      return;
    }
    await persist({
      pixelId: value || null,
      pixelName: value ? `Manual pixel ${value}` : null,
      optimisationEvent: null,
    });
  }

  async function saveManualIdentity() {
    const identityId = manualIdentityId.trim();
    const displayName = manualIdentityName.trim();
    if (!identityId || !manualIdentityType) {
      setSaveError(
        "A manual identity requires a valid TikTok identity ID and type (AUTH_CODE, BC_AUTH_TT, CUSTOMIZED_USER, or TT_USER).",
      );
      return;
    }
    await persist({
      identityId,
      identityDisplayName: displayName || identityId,
      identityManualName: displayName || identityId,
      identityBcId: null,
      identityType: manualIdentityType,
    });
  }

  async function persist(accountSetup: Partial<TikTokCampaignDraft["accountSetup"]>) {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave({
        accountSetup: {
          ...draft.accountSetup,
          ...accountSetup,
        },
      });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save account setup");
    } finally {
      setSaving(false);
    }
  }

  return (
    <StepSurfaceProvider surface={surface}>
    <div className="space-y-6">
      

      {saveError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {saveError}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Select
          id="tiktok-advertiser"
          label="TikTok advertiser"
          value={draft.accountSetup.tiktokAccountId ?? ""}
          onChange={(event) => void saveAccount(event.target.value)}
          disabled={loadingAccounts || saving}
          placeholder={loadingAccounts ? "Loading advertisers..." : "Select advertiser"}
          options={accounts
            .filter((account) => Boolean(account.tiktok_advertiser_id))
            .map((account) => ({
              value: account.id,
              label: `${account.account_name} (${account.tiktok_advertiser_id})`,
            }))}
        />
        <ReadOnlySummary
          label="Selected advertiser"
          value={
            selectedAccount
              ? selectedAccount.tiktok_advertiser_id
              : draft.accountSetup.advertiserId
          }
        />
      </div>

      {!loadingAccounts && accounts.filter((account) => Boolean(account.tiktok_advertiser_id)).length === 0 && (
        <StatusLine className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
          Connect a TikTok account first in{" "}
          <Link className="underline" href="/settings">
            Settings
          </Link>
          .
        </StatusLine>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <TikTokIdentityPicker
            identities={identities}
            selectedId={draft.accountSetup.identityId}
            disabled={!draft.accountSetup.advertiserId || loadingDetails || saving}
            loading={loadingDetails}
            onSelect={(identityId) => void saveIdentity(identityId)}
          />
          {selectedIdentityNeedsType && (
            <StatusLine className="text-sm text-amber-700 dark:text-amber-300">
              TikTok did not report a type for this identity. Pick AUTH_CODE,
              BC_AUTH_TT, CUSTOMIZED_USER, or TT_USER from the type select
              before continuing.
            </StatusLine>
          )}
        </div>
        <ManualIdentityHatch autoOpen={hatchAutoOpen}>
        <div className="space-y-2">
          <Input
            id="tiktok-manual-identity-id"
            label="Manual identity ID"
            value={manualIdentityId}
            onChange={(event) => setManualIdentityId(event.target.value)}
            placeholder="TikTok identity_id"
            disabled={!draft.accountSetup.advertiserId || saving}
          />
          <Select
            id="tiktok-manual-identity-type"
            label="Manual identity type"
            value={manualIdentityType}
            onChange={(event) =>
              void saveIdentityType(event.target.value as TikTokIdentityType | "")
            }
            disabled={!draft.accountSetup.advertiserId || saving}
            placeholder="Select identity type"
            options={MANUAL_IDENTITY_TYPES.map((value) => ({
              value,
              label: value,
            }))}
          />
          <Input
            id="tiktok-manual-identity-name"
            label="Manual display name"
            value={manualIdentityName}
            onChange={(event) => setManualIdentityName(event.target.value)}
            placeholder="Optional display name"
            disabled={!draft.accountSetup.advertiserId || saving}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void saveManualIdentity()}
            disabled={!draft.accountSetup.advertiserId || saving}
          >
            Save manual identity
          </Button>
        </div>
        </ManualIdentityHatch>
      </div>

      {identityFailed && identityWarning && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <Datum>{identityWarning}</Datum>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setIdentityReload((count) => count + 1)}
            disabled={!draft.accountSetup.advertiserId || loadingDetails}
          >
            Retry
          </Button>
        </div>
      )}
      {!identityFailed && identityWarning && (
        <StatusLine className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
          {identityWarning}
        </StatusLine>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Select
          id="tiktok-pixel"
          label="TikTok pixel"
          value={draft.accountSetup.pixelId ?? ""}
          onChange={(event) => void savePixel(event.target.value)}
          disabled={!draft.accountSetup.advertiserId || loadingDetails || saving || pixels.length === 0}
          placeholder={loadingDetails ? "Loading pixels..." : "Select pixel"}
          options={pixels.map((pixel) => ({
            value: pixel.pixel_id,
            label: pixel.status ? `${pixel.pixel_name} · ${pixel.status}` : pixel.pixel_name,
          }))}
        />
        <Select
          id="tiktok-optimisation-event"
          label="Optimisation event"
          value={draft.accountSetup.optimisationEvent ?? ""}
          onChange={(event) => void saveOptimisationEvent(event.target.value)}
          disabled={
            !draft.accountSetup.pixelId ||
            loadingEvents ||
            saving ||
            pixelEvents.length === 0
          }
          placeholder={
            !draft.accountSetup.pixelId
              ? "Select a pixel first"
              : loadingEvents
                ? "Loading pixel events..."
                : pixelEvents.length === 0
                  ? "No events on this pixel"
                  : "Select conversion event"
          }
          options={pixelEvents.map((event) => ({
            value: event.optimization_event,
            label: formatTikTokOptimisationEventLabel(
              event,
              draft.campaignSetup.objective,
            ),
          }))}
        />
      </div>
      {!loadingEvents &&
        draft.accountSetup.pixelId &&
        pixelEvents.length === 0 &&
        isTikTokConversionObjective(draft.campaignSetup.objective) && (
          <StatusLine
            tone="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {draft.campaignSetup.objective === "CONVERSIONS"
              ? tikTokSalesPixelNotFiredMessage(
                  draft.accountSetup.pixelName ??
                    pixels.find((pixel) => pixel.pixel_id === draft.accountSetup.pixelId)
                      ?.pixel_name ??
                    "This pixel",
                )
              : tikTokPixelNotFiredMessage(
                  draft.accountSetup.pixelName ??
                    pixels.find((pixel) => pixel.pixel_id === draft.accountSetup.pixelId)
                      ?.pixel_name ??
                    "This pixel",
                )}
          </StatusLine>
        )}

      {isUnsupportedTikTokOptimisationEvent(
        draft.campaignSetup.objective,
        draft.accountSetup.optimisationEvent,
        pixelEvents.find(
          (event) =>
            event.optimization_event === draft.accountSetup.optimisationEvent,
        )?.name,
      ) &&
        draft.accountSetup.optimisationEvent && (
          <StatusLine tone="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {tikTokUnsupportedOptimisationEventMessage(
              draft.accountSetup.optimisationEvent,
            )}
          </StatusLine>
        )}

      {pixelWarning && (
        <Datum className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          {pixelWarning}{" "}
          {!pixelApiFailed && (
            <a
              className="underline"
              href="https://ads.tiktok.com/i18n/events_manager"
              rel="noreferrer"
              target="_blank"
            >
              Open TikTok Events Manager
            </a>
          )}
        </Datum>
      )}

      {pixelApiFailed && (
        <div className="grid gap-3 rounded-md border border-border bg-background p-3 md:grid-cols-[1fr_auto] md:items-end">
          <Input
            id="tiktok-manual-pixel"
            label="Manual pixel ID"
            value={manualPixelId}
            onChange={(event) => setManualPixelId(event.target.value)}
            placeholder="Numeric TikTok pixel ID"
            disabled={!draft.accountSetup.advertiserId || saving}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => void saveManualPixel()}
            disabled={!draft.accountSetup.advertiserId || saving}
          >
            Save pixel ID
          </Button>
        </div>
      )}
    </div>
      </StepSurfaceProvider>
  );
}

function isListedIdentityType(
  value: TikTokIdentityType | "MANUAL" | null | undefined,
): value is TikTokIdentityType {
  return MANUAL_IDENTITY_TYPES.includes(value as TikTokIdentityType);
}

function ManualIdentityHatch({
  children,
  autoOpen,
}: {
  children: ReactNode;
  autoOpen: boolean;
}) {
  const [open, setOpen] = useState(autoOpen);
  useEffect(() => {
    if (autoOpen) setOpen(true);
  }, [autoOpen]);
  return (
    <div data-hatch="BC_AUTH_TT">
      <button
        type="button"
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
        BC_AUTH_TT
      </button>
      <InfoTip label={TIKTOK_DRAWER_COPY.manualIdentityTip} />
      {open ? <div className="mt-2">{children}</div> : null}
    </div>
  );
}

function TikTokIdentityPicker({
  identities,
  selectedId,
  disabled,
  loading,
  onSelect,
}: {
  identities: TikTokIdentityOption[];
  selectedId: string | null;
  disabled: boolean;
  loading: boolean;
  onSelect: (identityId: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div id="tiktok-identity-label" className="text-sm font-medium text-foreground">
        TikTok identity
      </div>
      <div
        id="tiktok-identity"
        role="radiogroup"
        aria-labelledby="tiktok-identity-label"
        className="space-y-2"
      >
        {loading ? (
          <Datum className="text-sm text-muted-foreground">Loading identities...</Datum>
        ) : identities.length === 0 ? (
          <Datum className="text-sm text-muted-foreground">Select identity</Datum>
        ) : (
          identities.map((identity) => {
            const view = tikTokIdentityOptionView({
              display_name: identity.display_name,
              avatar_url: identity.avatar_url ?? null,
              identity_type: identity.identity_type,
            });
            const selected = selectedId === identity.identity_id;
            return (
              <button
                key={identity.identity_id}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={disabled}
                title={view.typeCaption ?? "type unknown"}
                onClick={() => onSelect(identity.identity_id)}
                className={`flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors
                  focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring
                  disabled:cursor-not-allowed disabled:opacity-40
                  ${selected ? "border-primary bg-muted/40" : "border-border-strong hover:bg-muted/30"}`}
              >
                <TikTokIdentityAvatar
                  displayName={view.label}
                  avatarUrl={identity.avatar_url ?? null}
                />
                <span className="min-w-0 flex-1">
                  <Datum className="block truncate text-sm text-foreground">{view.label}</Datum>
                  {view.typeCaption ? (
                    <Datum className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                      {view.typeCaption}
                    </Datum>
                  ) : null}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function TikTokIdentityAvatar({
  displayName,
  avatarUrl,
}: {
  displayName: string;
  avatarUrl: string | null;
}) {
  const [broken, setBroken] = useState(false);
  const face = tikTokIdentityFace(broken ? null : avatarUrl, displayName);
  if (face.kind === "chip") {
    return (
      <span
        data-identity-face="chip"
        aria-hidden="true"
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground"
      >
        {face.initial}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      data-identity-face="image"
      src={face.src}
      alt=""
      className="h-8 w-8 shrink-0 rounded-full object-cover"
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}

function ReadOnlySummary({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <Datum className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Datum>
      <Datum className="mt-1 text-sm text-foreground">{value || "Not selected"}</Datum>
    </div>
  );
}
