"use client";

import { useEffect } from "react";
import { AlertCircle } from "lucide-react";
import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import type { CampaignSettings } from "@/lib/types";
import { useFetchAdAccounts, useFetchPixels } from "@/lib/hooks/useMeta";

// ─── Inline spinner ───────────────────────────────────────────────────────────

function Spinner() {
  return (
    <span
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent opacity-60"
      aria-label="Loading"
    />
  );
}

// ─── Field-level status row ───────────────────────────────────────────────────

function FieldStatus({
  loading,
  error,
  count,
}: {
  loading: boolean;
  error: string | null;
  count: number;
}) {
  if (loading) {
    return (
      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Spinner />
        Loading…
      </p>
    );
  }
  if (error) {
    return (
      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-destructive">
        <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
        {error}
      </p>
    );
  }
  if (count === 0) {
    return (
      <p className="mt-1.5 text-xs text-muted-foreground">
        No items found for this account.
      </p>
    );
  }
  return null;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface AccountSetupProps {
  settings: CampaignSettings;
  onChange: (settings: CampaignSettings) => void;
}

export function AccountSetup({ settings, onChange }: AccountSetupProps) {
  const update = (patch: Partial<CampaignSettings>) =>
    onChange({ ...settings, ...patch });

  // ── Data fetching ──────────────────────────────────────────────────────────
  const accounts = useFetchAdAccounts();
  const pixels = useFetchPixels(settings.metaAdAccountId);

  // Auto-select the first ad account once accounts have loaded, if none chosen
  useEffect(() => {
    if (
      !settings.metaAdAccountId &&
      accounts.data.length === 1 &&
      !accounts.loading
    ) {
      const only = accounts.data[0];
      update({
        adAccountId: only.id,
        metaAdAccountId: only.id,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts.data, accounts.loading]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleAccountChange(id: string) {
    // Clear downstream pixel selection when account changes
    update({
      adAccountId: id,
      metaAdAccountId: id,
      metaPixelId: undefined,
      pixelId: undefined,
    });
  }

  function handlePixelChange(pixelId: string) {
    update({
      pixelId: pixelId || undefined,
      metaPixelId: pixelId || undefined,
    });
  }

  function accountStatusLabel(status: number): string {
    switch (status) {
      case 1:   return "Active";
      case 2:   return "Disabled";
      case 3:   return "Unsettled";
      case 101: return "Closed";
      default:  return `Status ${status}`;
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h2 className="font-heading text-2xl tracking-wide">Account Setup</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Select your Meta ad account and optional conversion pixel.
          Facebook page and Instagram account are chosen per ad in the Creatives step.
        </p>
      </div>

      {/* ── Ad Account ─────────────────────────────────────────────────────── */}
      <Card>
        <CardTitle>Ad Account</CardTitle>
        <CardDescription>
          The Meta ad account this campaign will run under.
        </CardDescription>
        <div className="mt-3">
          <Select
            value={settings.metaAdAccountId ?? ""}
            onChange={(e) => handleAccountChange(e.target.value)}
            placeholder={
              accounts.loading ? "Loading accounts…" : "Select ad account…"
            }
            disabled={accounts.loading || accounts.data.length === 0}
            options={accounts.data.map((a) => ({
              value: a.id,
              label: `${a.name} · ${a.currency} · ${accountStatusLabel(a.account_status)}`,
            }))}
          />
          <FieldStatus
            loading={accounts.loading}
            error={accounts.error}
            count={accounts.data.length}
          />
        </div>
      </Card>

      {/* ── Pixel ──────────────────────────────────────────────────────────── */}
      <Card>
        <CardTitle>Pixel</CardTitle>
        <CardDescription>
          Optional — attach a Meta pixel for conversion tracking.{" "}
          {!settings.metaAdAccountId && (
            <span className="text-muted-foreground">
              Select an ad account first.
            </span>
          )}
        </CardDescription>
        <div className="mt-3">
          <Select
            value={settings.metaPixelId ?? ""}
            onChange={(e) => handlePixelChange(e.target.value)}
            placeholder={
              !settings.metaAdAccountId
                ? "Select an ad account first…"
                : pixels.loading
                  ? "Loading pixels…"
                  : "Select pixel (optional)…"
            }
            disabled={!settings.metaAdAccountId || pixels.loading}
            options={[
              { value: "", label: "None" },
              ...pixels.data.map((p) => ({
                value: p.id,
                label: `${p.name} (${p.id})`,
              })),
            ]}
          />
          <FieldStatus
            loading={pixels.loading}
            error={pixels.error}
            count={pixels.data.length}
          />
        </div>
      </Card>
    </div>
  );
}
