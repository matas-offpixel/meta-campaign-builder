"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Music2, Search } from "lucide-react";

import { Select } from "@/components/ui/select";
import type { TikTokAccount } from "@/lib/types/tiktok";
import type { GoogleAdsAccount } from "@/lib/types/google-ads";

interface Props {
  /** Client UUID — required to PATCH /api/clients/[id]. */
  clientId: string;
  /**
   * Initial selected accounts as resolved on the client row. Set by
   * the parent server-fetched `ClientRow` so reads are correct on
   * first paint and we only refetch the picker lists.
   */
  initialTikTokAccountId: string | null;
  initialGoogleAdsAccountId: string | null;
  /** Existing flat-text channel IDs already present on the client row. */
  metaBusinessId: string | null;
  metaAdAccountId: string | null;
  metaPixelId: string | null;
}

type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  | { kind: "error"; message: string };

export function PlatformAccountsCard({
  clientId,
  initialTikTokAccountId,
  initialGoogleAdsAccountId,
  metaBusinessId,
  metaAdAccountId,
  metaPixelId,
}: Props) {
  const [tiktokAccounts, setTiktokAccounts] = useState<TikTokAccount[]>([]);
  const [googleAdsAccounts, setGoogleAdsAccounts] = useState<
    GoogleAdsAccount[]
  >([]);
  const [tiktokId, setTiktokId] = useState<string | null>(
    initialTikTokAccountId,
  );
  const [googleAdsId, setGoogleAdsId] = useState<string | null>(
    initialGoogleAdsAccountId,
  );
  const [tiktokSave, setTiktokSave] = useState<SaveStatus>({ kind: "idle" });
  const [googleAdsSave, setGoogleAdsSave] = useState<SaveStatus>({
    kind: "idle",
  });

  useEffect(() => {
    fetch("/api/tiktok/accounts")
      .then((r) => r.json())
      .then((j) => {
        if (j?.ok) setTiktokAccounts(j.accounts as TikTokAccount[]);
      })
      .catch(() => undefined);
    fetch("/api/google-ads/accounts")
      .then((r) => r.json())
      .then((j) => {
        if (j?.ok) setGoogleAdsAccounts(j.accounts as GoogleAdsAccount[]);
      })
      .catch(() => undefined);
  }, []);

  // Optimistic patch helper — flips the field locally first, then
  // PATCHes; reverts on failure with the previous value.
  const patchClient = async (
    field: "tiktok_account_id" | "google_ads_account_id",
    nextValue: string | null,
    setLocal: (v: string | null) => void,
    prev: string | null,
    setSave: (s: SaveStatus) => void,
  ) => {
    setLocal(nextValue);
    setSave({ kind: "saving" });
    try {
      const res = await fetch(`/api/clients/${clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: nextValue }),
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      setSave({ kind: "saved", at: Date.now() });
    } catch (err) {
      setLocal(prev);
      const message = err instanceof Error ? err.message : "Save failed";
      setSave({ kind: "error", message });
    }
  };

  const metaConnected = Boolean(
    metaBusinessId && metaAdAccountId && metaPixelId,
  );

  return (
    <section className="rounded-md border border-border bg-card p-5 space-y-4">
      <div>
        <h2 className="font-heading text-base tracking-wide">
          Platform accounts
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Default platform accounts for every event under this client.
          Events can override on a case-by-case basis from the event
          detail page. Changes save automatically.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <PlatformRow
          icon={
            <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-[#1877F2] text-[10px] font-bold text-white">
              f
            </span>
          }
          label="Meta"
          status={metaConnected ? "connected" : "missing"}
          details={
            metaConnected
              ? `Ad account ${metaAdAccountId}`
              : "Add BM, ad account & pixel in the edit form."
          }
        />
        <PlatformRow
          icon={<Music2 className="h-4 w-4" style={{ color: "#FF0050" }} />}
          label="TikTok"
          status={tiktokId ? "connected" : "missing"}
          details={
            tiktokId
              ? tiktokAccounts.find((a) => a.id === tiktokId)?.account_name ??
                "Linked"
              : tiktokAccounts.length === 0
                ? "No TikTok accounts seeded yet."
                : "Pick an account below."
          }
          picker={
            tiktokAccounts.length > 0 ? (
              <Select
                id="client-tiktok-account-id"
                value={tiktokId ?? ""}
                onChange={(e) => {
                  const next = e.target.value || null;
                  void patchClient(
                    "tiktok_account_id",
                    next,
                    setTiktokId,
                    tiktokId,
                    setTiktokSave,
                  );
                }}
                placeholder="Not linked"
                options={tiktokAccounts.map((a) => ({
                  value: a.id,
                  label: a.account_name,
                }))}
                disabled={tiktokSave.kind === "saving"}
              />
            ) : null
          }
          saveStatus={tiktokSave}
        />
        <PlatformRow
          icon={<Search className="h-4 w-4" style={{ color: "#4285F4" }} />}
          label="Google Ads"
          status={googleAdsId ? "connected" : "missing"}
          details={
            googleAdsId
              ? googleAdsAccounts.find((a) => a.id === googleAdsId)
                  ?.account_name ?? "Linked"
              : googleAdsAccounts.length === 0
                ? "No Google Ads accounts seeded yet."
                : "Pick an account below."
          }
          picker={
            googleAdsAccounts.length > 0 ? (
              <Select
                id="client-google-ads-account-id"
                value={googleAdsId ?? ""}
                onChange={(e) => {
                  const next = e.target.value || null;
                  void patchClient(
                    "google_ads_account_id",
                    next,
                    setGoogleAdsId,
                    googleAdsId,
                    setGoogleAdsSave,
                  );
                }}
                placeholder="Not linked"
                options={googleAdsAccounts.map((a) => ({
                  value: a.id,
                  label: a.account_name,
                }))}
                disabled={googleAdsSave.kind === "saving"}
              />
            ) : null
          }
          saveStatus={googleAdsSave}
        />
      </div>
    </section>
  );
}

function PlatformRow({
  icon,
  label,
  status,
  details,
  picker,
  saveStatus,
}: {
  icon: React.ReactNode;
  label: string;
  status: "connected" | "missing";
  details: string;
  picker?: React.ReactNode;
  saveStatus?: SaveStatus;
}) {
  return (
    <div className="rounded-md border border-border bg-background p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {icon}
          <p className="text-sm font-medium">{label}</p>
        </div>
        <StatusBadge status={status} />
      </div>
      <p className="text-xs text-muted-foreground">{details}</p>
      {picker}
      {saveStatus && <SaveIndicator status={saveStatus} />}
    </div>
  );
}

function StatusBadge({ status }: { status: "connected" | "missing" }) {
  if (status === "connected") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
        <CheckCircle2 className="h-3 w-3" />
        Connected
      </span>
    );
  }
  return (
    <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
      Not configured
    </span>
  );
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  if (status.kind === "idle") return null;
  if (status.kind === "saving") {
    return (
      <p className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Saving…
      </p>
    );
  }
  if (status.kind === "saved") {
    return (
      <p className="text-[11px] text-emerald-600">Saved</p>
    );
  }
  return (
    <p className="text-[11px] text-destructive">Save failed: {status.message}</p>
  );
}
