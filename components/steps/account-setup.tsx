"use client";

import { useEffect } from "react";
import { AlertCircle, AlertTriangle, RefreshCw } from "lucide-react";
import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
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

  // After accounts load, validate and auto-select as appropriate
  useEffect(() => {
    if (accounts.loading || accounts.data.length === 0) return;

    const storedId = settings.metaAdAccountId || settings.adAccountId;

    // Debug: log what the draft has vs. what Meta returns
    console.log(
      "[AccountSetup] Draft account:", storedId || "(none)",
      "| Meta accounts loaded:", accounts.data.map((a) => a.id).join(", "),
    );

    const isStoredAccountValid = storedId
      ? accounts.data.some((a) => a.id === storedId)
      : false;

    if (!isStoredAccountValid) {
      if (accounts.data.length === 1) {
        // Auto-select the only available account
        const only = accounts.data[0];
        console.log("[AccountSetup] Stale/missing account — auto-selecting:", only.id);
        update({
          adAccountId: only.id,
          metaAdAccountId: only.id,
          metaPixelId: undefined,
          pixelId: undefined,
        });
      } else if (storedId) {
        // Multiple accounts available but stored ID isn't among them — clear stale
        console.warn("[AccountSetup] Stored account", storedId, "not found in Meta accounts — clearing.");
        update({
          adAccountId: "",
          metaAdAccountId: undefined,
          metaPixelId: undefined,
          pixelId: undefined,
        });
      }
      // If storedId is empty and there are multiple accounts, leave the user to choose
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts.data, accounts.loading]);

  // ── Derived state ──────────────────────────────────────────────────────────

  // True only once accounts have loaded and the stored ID isn't in the list
  const storedId = settings.metaAdAccountId || settings.adAccountId;
  const isStaleAccount =
    !accounts.loading &&
    accounts.data.length > 0 &&
    !!storedId &&
    !accounts.data.some((a) => a.id === storedId);

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleAccountChange(id: string) {
    console.log("[AccountSetup] User selected account:", id);
    // Keep both fields identical; clear downstream pixel selection
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

        {/* Stale-account warning — shown when the draft's saved account is no
            longer accessible (e.g. loaded from an old draft or template) */}
        {isStaleAccount && (
          <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm text-warning-foreground">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div className="flex-1 space-y-1">
              <p className="font-medium">Stale ad account</p>
              <p className="text-xs text-muted-foreground">
                This draft was saved with account{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                  {storedId}
                </code>{" "}
                which is not accessible under your current Meta token. Please
                select the correct account below.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 gap-1.5"
              onClick={() => handleAccountChange(accounts.data[0]?.id ?? "")}
              disabled={accounts.data.length === 0}
            >
              <RefreshCw className="h-3 w-3" />
              Use first available
            </Button>
          </div>
        )}

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
          {/* Debug info — visible in development, low-key in prod */}
          {settings.metaAdAccountId && (
            <p className="mt-1 font-mono text-[10px] text-muted-foreground/60">
              {settings.metaAdAccountId}
            </p>
          )}
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
