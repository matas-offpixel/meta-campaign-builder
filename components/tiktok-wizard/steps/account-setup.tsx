"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { TIKTOK_PIXEL_ID_PATTERN } from "@/lib/tiktok-wizard/validation";
import type { TikTokAccount } from "@/lib/types/tiktok";
import type { TikTokCampaignDraft } from "@/lib/types/tiktok-draft";

interface TikTokIdentityOption {
  identity_id: string;
  display_name: string;
  identity_type: "PERSONAL_HUB" | "CUSTOMIZED_USER" | "TT_USER";
}

interface TikTokPixelOption {
  pixel_id: string;
  pixel_name: string;
  status: string | null;
}

export function AccountSetupStep({
  draft,
  onSave,
}: {
  draft: TikTokCampaignDraft;
  onSave: (patch: Partial<TikTokCampaignDraft>) => Promise<void>;
}) {
  const [accounts, setAccounts] = useState<TikTokAccount[]>([]);
  const [identities, setIdentities] = useState<TikTokIdentityOption[]>([]);
  const [pixels, setPixels] = useState<TikTokPixelOption[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [identityWarning, setIdentityWarning] = useState<string | null>(null);
  const [pixelWarning, setPixelWarning] = useState<string | null>(null);
  const [pixelApiFailed, setPixelApiFailed] = useState(false);
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
      return;
    }
    const advertiserId = selectedAdvertiserId;
    let cancelled = false;
    setLoadingDetails(true);
    setIdentityWarning(null);
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
          identities?: TikTokIdentityOption[];
          error?: string;
        } | null;
        const next = json?.ok ? (json.identities ?? []) : [];
        setIdentities(next);
        if (!json?.ok && json?.error) {
          setIdentityWarning(
            `TikTok identity API returned: ${json.error}. Use manual override below.`,
          );
        } else if (next.length === 0) {
          setIdentityWarning(
            "No identities available. Use the manual override below.",
          );
        }
      } else {
        setIdentities([]);
        setIdentityWarning(
          "TikTok identity API returned: request failed. Use manual override below.",
        );
      }

      if (pixelRes.status === "fulfilled") {
        const json = (await pixelRes.value.json().catch(() => null)) as {
          ok?: boolean;
          pixels?: TikTokPixelOption[];
          error?: string;
        } | null;
        const next = json?.ok ? (json.pixels ?? []) : [];
        setPixels(next);
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
  }, [draft.accountSetup.advertiserId]);

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === draft.accountSetup.tiktokAccountId),
    [accounts, draft.accountSetup.tiktokAccountId],
  );

  async function saveAccount(accountId: string) {
    const account = accounts.find((candidate) => candidate.id === accountId);
    await persist({
      tiktokAccountId: account?.id ?? null,
      advertiserId: account?.tiktok_advertiser_id ?? null,
      identityId: null,
      identityDisplayName: null,
      identityManualName: null,
      identityType: null,
      pixelId: null,
      pixelName: null,
    });
    setManualIdentityName("");
  }

  async function saveIdentity(identityId: string) {
    const identity = identities.find((candidate) => candidate.identity_id === identityId);
    await persist({
      identityId: identity?.identity_id ?? null,
      identityDisplayName: identity?.display_name ?? null,
      identityManualName: null,
      identityType: identity?.identity_type ?? null,
    });
    setManualIdentityName("");
  }

  async function savePixel(pixelId: string) {
    const pixel = pixels.find((candidate) => candidate.pixel_id === pixelId);
    await persist({
      pixelId: pixel?.pixel_id ?? null,
      pixelName: pixel?.pixel_name ?? null,
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
    });
  }

  async function saveManualIdentity() {
    const value = manualIdentityName.trim();
    await persist({
      identityId: null,
      identityDisplayName: value || null,
      identityManualName: value || null,
      identityType: value ? "MANUAL" : null,
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
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-xl">Account setup</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Choose the TikTok advertiser, identity, and optional pixel for this
          draft. One advertiser is stored per draft.
        </p>
      </div>

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
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
          Connect a TikTok account first in{" "}
          <Link className="underline" href="/settings">
            Settings
          </Link>
          .
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Select
          id="tiktok-identity"
          label="TikTok identity"
          value={draft.accountSetup.identityId ?? ""}
          onChange={(event) => void saveIdentity(event.target.value)}
          disabled={!draft.accountSetup.advertiserId || loadingDetails || saving || identities.length === 0}
          placeholder={loadingDetails ? "Loading identities..." : "Select identity"}
          options={identities.map((identity) => ({
            value: identity.identity_id,
            label: `${identity.display_name} · ${identity.identity_type}`,
          }))}
        />
        <div className="space-y-2">
          <Input
            id="tiktok-manual-identity"
            label="Manual identity override"
            value={manualIdentityName}
            onChange={(event) => setManualIdentityName(event.target.value)}
            placeholder="TikTok page / identity name"
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
      </div>

      {identityWarning && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
          {identityWarning}
        </p>
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
        <ReadOnlySummary
          label="Saved pixel"
          value={draft.accountSetup.pixelName ?? draft.accountSetup.pixelId}
        />
      </div>

      {pixelWarning && (
        <p className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
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
        </p>
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
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm text-foreground">{value || "Not selected"}</p>
    </div>
  );
}
