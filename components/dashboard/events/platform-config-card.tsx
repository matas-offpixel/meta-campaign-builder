"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ExternalLink,
  FolderOpen,
  Loader2,
  Music2,
  Search,
} from "lucide-react";

import { Select } from "@/components/ui/select";
import type { TikTokAccount } from "@/lib/types/tiktok";
import type { GoogleAdsAccount } from "@/lib/types/google-ads";

interface Props {
  /** Event UUID — required to PATCH /api/events/[id]. */
  eventId: string;
  /**
   * Event-level override (events.tiktok_account_id). Null = no
   * override, fall back to client default.
   */
  initialEventTikTokAccountId: string | null;
  /** Client-level default (clients.tiktok_account_id). */
  clientTikTokAccountId: string | null;
  /** Event-level override (events.google_ads_account_id). */
  initialEventGoogleAdsAccountId: string | null;
  /** Client-level default (clients.google_ads_account_id). */
  clientGoogleAdsAccountId: string | null;
  /**
   * Read-only Meta ad-account row. Events don't carry their own
   * meta_ad_account_id override yet; once they do this turns into a
   * dropdown like the other two.
   */
  metaAdAccount: { value: string | null; inherited: boolean };
  /** Drive folder URL stored on events.google_drive_folder_url. */
  driveFolderUrl: string | null;
}

type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  | { kind: "error"; message: string };

/**
 * Per-event platform config. TikTok + Google Ads rows are now
 * editable — picking from the dropdown PATCHes
 * /api/events/[id] with the override (or clears it back to the
 * client default by selecting the placeholder option).
 *
 * Meta + Drive folder stay read-only here. Meta lacks an event-level
 * override column; Drive folder is handled by the dedicated
 * GoogleDriveCard above.
 */
export function PlatformConfigCard({
  eventId,
  initialEventTikTokAccountId,
  clientTikTokAccountId,
  initialEventGoogleAdsAccountId,
  clientGoogleAdsAccountId,
  metaAdAccount,
  driveFolderUrl,
}: Props) {
  const [tiktokAccounts, setTiktokAccounts] = useState<TikTokAccount[]>([]);
  const [googleAdsAccounts, setGoogleAdsAccounts] = useState<
    GoogleAdsAccount[]
  >([]);
  const [eventTiktokId, setEventTiktokId] = useState<string | null>(
    initialEventTikTokAccountId,
  );
  const [eventGoogleAdsId, setEventGoogleAdsId] = useState<string | null>(
    initialEventGoogleAdsAccountId,
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

  const patchEvent = async (
    field: "tiktok_account_id" | "google_ads_account_id",
    nextValue: string | null,
    setLocal: (v: string | null) => void,
    prev: string | null,
    setSave: (s: SaveStatus) => void,
  ) => {
    setLocal(nextValue);
    setSave({ kind: "saving" });
    try {
      const res = await fetch(`/api/events/${eventId}`, {
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

  // ── Resolve display state for each row ─────────────────────────
  // Resolved id = event override ?? client default.
  // "Inherited" flag is true when there's no event-level value but a
  // client-level one is filling the gap.
  const tiktokResolvedId = eventTiktokId ?? clientTikTokAccountId;
  const tiktokInherited =
    !eventTiktokId && Boolean(clientTikTokAccountId);
  const tiktokAccountName = useMemo(() => {
    if (!tiktokResolvedId) return null;
    return (
      tiktokAccounts.find((a) => a.id === tiktokResolvedId)?.account_name ??
      null
    );
  }, [tiktokAccounts, tiktokResolvedId]);

  const googleAdsResolvedId = eventGoogleAdsId ?? clientGoogleAdsAccountId;
  const googleAdsInherited =
    !eventGoogleAdsId && Boolean(clientGoogleAdsAccountId);
  const googleAdsAccountName = useMemo(() => {
    if (!googleAdsResolvedId) return null;
    return (
      googleAdsAccounts.find((a) => a.id === googleAdsResolvedId)
        ?.account_name ?? null
    );
  }, [googleAdsAccounts, googleAdsResolvedId]);

  return (
    <section className="rounded-md border border-border bg-card p-5 space-y-3">
      <div>
        <h2 className="font-heading text-base tracking-wide">
          Platform config
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Accounts driving paid spend + asset storage for this event.
          TikTok + Google Ads can be overridden per-event; selecting
          &ldquo;Use client default&rdquo; clears the override and
          falls back to the parent client&apos;s account.
        </p>
      </div>

      <ul className="divide-y divide-border">
        <ReadOnlyRow
          icon={
            <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-[#1877F2] text-[10px] font-bold text-white">
              f
            </span>
          }
          label="Meta ad account"
          value={metaAdAccount.value}
          inherited={metaAdAccount.inherited}
        />

        <EditableRow
          icon={<Music2 className="h-4 w-4" style={{ color: "#FF0050" }} />}
          label="TikTok account"
          resolvedDisplay={tiktokAccountName ?? tiktokResolvedId}
          inherited={tiktokInherited}
          options={tiktokAccounts.map((a) => ({
            value: a.id,
            label: a.account_name,
          }))}
          selectedValue={eventTiktokId ?? ""}
          placeholder={
            clientTikTokAccountId
              ? "Use client default"
              : "Not linked"
          }
          emptyHint={
            tiktokAccounts.length === 0
              ? "No TikTok accounts seeded yet — run scripts/seed-tiktok-accounts.mjs."
              : null
          }
          onChange={(value) => {
            const next = value || null;
            void patchEvent(
              "tiktok_account_id",
              next,
              setEventTiktokId,
              eventTiktokId,
              setTiktokSave,
            );
          }}
          saveStatus={tiktokSave}
          selectId={`event-${eventId}-tiktok-account-id`}
        />

        <EditableRow
          icon={<Search className="h-4 w-4" style={{ color: "#4285F4" }} />}
          label="Google Ads account"
          resolvedDisplay={googleAdsAccountName ?? googleAdsResolvedId}
          inherited={googleAdsInherited}
          options={googleAdsAccounts.map((a) => ({
            value: a.id,
            label: a.account_name,
          }))}
          selectedValue={eventGoogleAdsId ?? ""}
          placeholder={
            clientGoogleAdsAccountId
              ? "Use client default"
              : "Not linked"
          }
          emptyHint={
            googleAdsAccounts.length === 0
              ? "No Google Ads accounts linked yet."
              : null
          }
          onChange={(value) => {
            const next = value || null;
            void patchEvent(
              "google_ads_account_id",
              next,
              setEventGoogleAdsId,
              eventGoogleAdsId,
              setGoogleAdsSave,
            );
          }}
          saveStatus={googleAdsSave}
          selectId={`event-${eventId}-google-ads-account-id`}
        />

        <ReadOnlyRow
          icon={<FolderOpen className="h-4 w-4 text-muted-foreground" />}
          label="Drive folder"
          value={driveFolderUrl}
          inherited={false}
          href={driveFolderUrl}
        />
      </ul>
    </section>
  );
}

// ─── Row variants ─────────────────────────────────────────────────

function ReadOnlyRow({
  icon,
  label,
  value,
  inherited,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  inherited: boolean;
  href?: string | null;
}) {
  return (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <div className="flex items-center gap-2 min-w-0">
        {icon}
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="flex items-center gap-2 min-w-0">
        {value ? (
          <>
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm underline-offset-2 hover:underline truncate max-w-xs"
              >
                {value}
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
            ) : (
              <span className="text-sm truncate max-w-xs">{value}</span>
            )}
            {inherited && <InheritedBadge />}
          </>
        ) : (
          <NotConfiguredBadge />
        )}
      </div>
    </li>
  );
}

function EditableRow({
  icon,
  label,
  resolvedDisplay,
  inherited,
  options,
  selectedValue,
  placeholder,
  emptyHint,
  onChange,
  saveStatus,
  selectId,
}: {
  icon: React.ReactNode;
  label: string;
  resolvedDisplay: string | null;
  inherited: boolean;
  options: { value: string; label: string }[];
  selectedValue: string;
  placeholder: string;
  emptyHint: string | null;
  onChange: (value: string) => void;
  saveStatus: SaveStatus;
  selectId: string;
}) {
  return (
    <li className="py-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {icon}
          <span className="text-sm font-medium">{label}</span>
        </div>
        <div className="flex items-center gap-2 min-w-0">
          {resolvedDisplay ? (
            <>
              <span className="text-sm truncate max-w-xs">
                {resolvedDisplay}
              </span>
              {inherited && <InheritedBadge />}
            </>
          ) : (
            <NotConfiguredBadge />
          )}
        </div>
      </div>
      {emptyHint ? (
        <p className="text-[11px] text-muted-foreground">{emptyHint}</p>
      ) : (
        <Select
          id={selectId}
          value={selectedValue}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          options={options}
          disabled={saveStatus.kind === "saving"}
        />
      )}
      <SaveIndicator status={saveStatus} />
    </li>
  );
}

function InheritedBadge() {
  return (
    <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
      inherited
    </span>
  );
}

function NotConfiguredBadge() {
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
    return <p className="text-[11px] text-emerald-600">Saved</p>;
  }
  return (
    <p className="text-[11px] text-destructive">
      Save failed: {status.message}
    </p>
  );
}
