"use client";

import { useEffect, useState } from "react";
import { AlertCircle, AlertTriangle, RefreshCw, Loader2, Link2, CheckCircle2 } from "lucide-react";
import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { Button } from "@/components/ui/button";
import type { CampaignSettings } from "@/lib/types";
import { useFetchAdAccounts, useFetchPixels, useFacebookConnectionStatus } from "@/lib/hooks/useMeta";
import { connectFacebookAccount, FB_SCOPES, type ScopeDebugInfo } from "@/lib/facebook-connect";

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
  /** Used as OAuth return path after linking Facebook */
  campaignId?: string;
}

export function AccountSetup({ settings, onChange, campaignId }: AccountSetupProps) {
  const update = (patch: Partial<CampaignSettings>) =>
    onChange({ ...settings, ...patch });

  const [fbConnectBusy, setFbConnectBusy] = useState(false);
  const [fbScopeDebug, setFbScopeDebug] = useState<ScopeDebugInfo | null>(null);
  const {
    connected: facebookConnected,
    expired: fbTokenExpired,
    loading: fbStatusLoading,
    refresh: refreshFbStatus,
  } = useFacebookConnectionStatus();

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

  async function handleConnectFacebook() {
    setFbConnectBusy(true);
    setFbScopeDebug(null);
    try {
      const returnPath = campaignId ? `/campaign/${campaignId}` : "/";
      await connectFacebookAccount({
        returnPath,
        onScopeDebug: (info) => setFbScopeDebug(info),
      });
    } catch (e) {
      console.error("[AccountSetup] Connect Facebook:", e);
      alert(e instanceof Error ? e.message : "Could not start Facebook connection.");
      setFbConnectBusy(false);
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

      {/* ── Facebook (user token) ─────────────────────────────────────────── */}
      <Card>
        <CardTitle>Facebook connection</CardTitle>
        <CardDescription>
          Link Facebook to load <strong>your</strong> pages (&quot;Load My Pages&quot;), Instagram identities, and other Meta features that use your personal Facebook access.
          Ad accounts and pixels below still use the app&apos;s Meta integration.
        </CardDescription>
        {/* ── Expiry warning — shown when a Meta API call detected a stale token */}
        {fbTokenExpired && (
          <div className="mt-3 flex items-start gap-3 rounded-lg border border-warning/50 bg-warning/10 px-4 py-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-warning-foreground">
                Facebook session expired
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Your Facebook token is no longer valid. Reconnect to reload ad
                accounts, pages, and pixels.
              </p>
            </div>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-3">
          {fbStatusLoading ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Checking connection…
            </p>
          ) : fbTokenExpired ? (
            <p className="flex items-center gap-2 text-xs text-warning">
              <AlertTriangle className="h-3.5 w-3.5" />
              Session expired
            </p>
          ) : facebookConnected ? (
            <p className="flex items-center gap-2 text-xs text-success">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Facebook connected
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Not connected — required for &quot;Load My Pages&quot; and similar features.
            </p>
          )}
          <Button
            type="button"
            variant={fbTokenExpired ? "primary" : facebookConnected ? "outline" : "primary"}
            size="sm"
            className="gap-1.5"
            disabled={fbConnectBusy}
            onClick={() => {
              void handleConnectFacebook();
            }}
          >
            {fbConnectBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Link2 className="h-3.5 w-3.5" />
            )}
            {fbTokenExpired
              ? "Reconnect Facebook"
              : facebookConnected
                ? "Reconnect Facebook"
                : "Connect Facebook"}
          </Button>
          {facebookConnected && !fbTokenExpired && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={() => void refreshFbStatus()}
            >
              Refresh status
            </Button>
          )}
        </div>

        {/* ── [DEBUG] Scope inspector — remove once confirmed working ──────── */}
        {fbScopeDebug && (
          <div className="mt-3 rounded-md border border-dashed border-warning/60 bg-warning/5 p-3 font-mono text-[11px] leading-relaxed text-foreground">
            <p className="mb-1 font-sans text-xs font-semibold text-warning">
              DEBUG — OAuth scope (remove once verified)
            </p>
            <p>
              <span className="text-muted-foreground">Desired (FB_SCOPES):&nbsp;&nbsp;</span>
              <span className="text-foreground">{FB_SCOPES}</span>
            </p>
            <p>
              <span className="text-muted-foreground">GoTrue URL scope:&nbsp;&nbsp;&nbsp;&nbsp;</span>
              <span className={fbScopeDebug.goTrueScope !== FB_SCOPES ? "text-warning" : "text-foreground"}>
                {fbScopeDebug.goTrueScope || "(empty)"}
              </span>
            </p>
            <p>
              <span className="text-muted-foreground">GoTrue tokens parsed:&nbsp;</span>
              <span className="text-foreground">
                [{fbScopeDebug.goTrueTokens.join(", ") || "—"}]
              </span>
            </p>
            <p>
              <span className="text-muted-foreground">Final tokens (forced):&nbsp;</span>
              <span className="text-foreground">
                [{fbScopeDebug.finalTokens.join(", ")}]
              </span>
            </p>
            <p>
              <span className="text-muted-foreground">Sent to Facebook:&nbsp;&nbsp;&nbsp;&nbsp;</span>
              <span className={fbScopeDebug.finalScope === FB_SCOPES ? "text-success" : "text-destructive"}>
                {fbScopeDebug.finalScope || "(EMPTY — bug!)"}
              </span>{" "}
              {fbScopeDebug.finalScope === FB_SCOPES ? "✓" : "✗"}
            </p>
            <p className="mt-1 break-all text-[10px] text-muted-foreground">
              URL: {fbScopeDebug.finalUrl.slice(0, 300)}
            </p>
          </div>
        )}
        {/* ── end DEBUG ────────────────────────────────────────────────────── */}
      </Card>

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
          <Combobox
            value={settings.metaAdAccountId ?? ""}
            onChange={handleAccountChange}
            placeholder={
              fbTokenExpired
                ? "Reconnect Facebook to load accounts"
                : accounts.loading
                  ? "Loading accounts…"
                  : "Select ad account…"
            }
            loading={accounts.loading && accounts.data.length === 0}
            disabled={fbTokenExpired || (accounts.data.length === 0 && !accounts.loading)}
            emptyText="No ad accounts found"
            options={accounts.data.map((a) => ({
              value: a.id,
              label: a.name,
              sublabel: `${a.id} · ${a.currency} · ${accountStatusLabel(a.account_status)}`,
              dimmed: a.account_status !== 1,
            }))}
          />
          <FieldStatus
            loading={accounts.loading && accounts.data.length === 0}
            // Don't surface raw Meta token-error text — the expiry banner above
            // already explains the issue clearly.
            error={fbTokenExpired ? null : accounts.error}
            count={fbTokenExpired ? 0 : accounts.data.length}
          />
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
          {!settings.metaAdAccountId && !fbTokenExpired && (
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
              fbTokenExpired
                ? "Reconnect Facebook to load pixels"
                : !settings.metaAdAccountId
                  ? "Select an ad account first…"
                  : pixels.loading
                    ? "Loading pixels…"
                    : "Select pixel (optional)…"
            }
            disabled={fbTokenExpired || !settings.metaAdAccountId || pixels.loading}
            options={[
              { value: "", label: "None" },
              ...pixels.data.map((p) => ({
                value: p.id,
                label: `${p.name} (${p.id})`,
              })),
            ]}
          />
          <FieldStatus
            loading={pixels.loading && !fbTokenExpired}
            error={fbTokenExpired ? null : pixels.error}
            count={fbTokenExpired ? 0 : pixels.data.length}
          />
        </div>
      </Card>
    </div>
  );
}
