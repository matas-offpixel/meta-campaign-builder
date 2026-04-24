"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Loader2, RefreshCw, Link as LinkIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface ShareRow {
  token: string;
  // Nullable since migration 014 — scope='client' shares carry a
  // client_id instead. Always non-null in this component's data path
  // (rows here are looked up by event_id) but typed honestly to
  // match the regenerated Database row type.
  event_id: string | null;
  enabled: boolean;
  /** When false, public `/share/report/[token]` is view-only for spend + budget writes. */
  can_edit: boolean;
  expires_at: string | null;
  view_count: number;
  last_viewed_at: string | null;
  created_at: string;
}

type ShareSeed = Omit<ShareRow, "can_edit"> & { can_edit?: boolean };

interface Props {
  eventId: string;
  /** Pre-fetched share row (or null when none exists). Server-rendered so
   * the toggle has the correct initial state with no client round-trip. */
  initialShare: ShareSeed | null;
}

/**
 * Per-event share controls — toggle the public report link on/off, copy
 * the URL, set an expiry, regenerate the token.
 *
 * Lives under app/(dashboard)/events/[id]/ rather than under the shared
 * components/dashboard/* tree because it's exclusive to the event detail
 * Reporting tab.
 */
function toShareRow(seed: ShareSeed | null): ShareRow | null {
  if (seed == null) return null;
  return { ...seed, can_edit: seed.can_edit !== false };
}

export function ShareReportControls({ eventId, initialShare }: Props) {
  const [share, setShare] = useState<ShareRow | null>(() =>
    toShareRow(initialShare),
  );
  const [working, setWorking] = useState<
    null | "toggle" | "regen" | "expiry" | "can_edit"
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState<string>("");

  // window is unavailable during SSR — read on mount so the copy button
  // gets the right absolute URL. Render a relative path until then.
  useEffect(() => {
    if (typeof window !== "undefined") {
      setOrigin(window.location.origin);
    }
  }, []);

  useEffect(() => {
    const next = toShareRow(initialShare);
    setShare((prev) => {
      if (next == null) return null;
      if (
        prev &&
        prev.token === next.token &&
        prev.enabled === next.enabled &&
        prev.can_edit === next.can_edit &&
        prev.expires_at === next.expires_at &&
        prev.view_count === next.view_count &&
        prev.last_viewed_at === next.last_viewed_at
      ) {
        return prev;
      }
      return next;
    });
  }, [
    initialShare,
    initialShare?.token,
    initialShare?.enabled,
    initialShare?.can_edit,
    initialShare?.expires_at,
    initialShare?.view_count,
    initialShare?.last_viewed_at,
  ]);

  const enabled = share?.enabled ?? false;
  const url = share
    ? `${origin || ""}/share/report/${share.token}`
    : null;

  const handleToggle = async () => {
    setWorking("toggle");
    setError(null);
    try {
      if (!share) {
        const res = await fetch("/api/share/report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId }),
        });
        const json = (await res.json()) as
          | { share: ShareSeed }
          | { error: string };
        if (!res.ok || "error" in json) {
          throw new Error("error" in json ? json.error : "Failed");
        }
        setShare(toShareRow(json.share));
        return;
      }

      const next = !enabled;
      const res = await fetch("/api/share/report", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: share.token,
          action: next ? "enable" : "disable",
        }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? "Failed");
      }
      setShare({ ...share, enabled: next });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setWorking(null);
    }
  };

  const handleCopy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy to clipboard.");
    }
  };

  const handleRegenerate = async () => {
    if (!share) return;
    if (
      !confirm(
        "Regenerating the link will invalidate the current URL. Anyone with the old link will see a 404. Continue?",
      )
    ) {
      return;
    }
    setWorking("regen");
    setError(null);
    try {
      const res = await fetch("/api/share/report", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: share.token, action: "regenerate" }),
      });
      const json = (await res.json()) as
        | { share: ShareSeed }
        | { error: string };
      if (!res.ok || "error" in json) {
        throw new Error("error" in json ? json.error : "Failed");
      }
      setShare(toShareRow(json.share));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setWorking(null);
    }
  };

  const handleCanEditChange = async (next: boolean) => {
    if (!share) return;
    setWorking("can_edit");
    setError(null);
    try {
      const res = await fetch("/api/share/report", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: share.token,
          action: "set_can_edit",
          canEdit: next,
        }),
      });
      const json = (await res.json()) as
        | { share: ShareSeed }
        | { error: string };
      if (!res.ok || "error" in json) {
        throw new Error("error" in json ? json.error : "Failed");
      }
      setShare(toShareRow(json.share));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setWorking(null);
    }
  };

  const handleExpiry = async (raw: string) => {
    if (!share) return;
    setWorking("expiry");
    setError(null);
    const expiresAt = raw.trim() ? new Date(raw).toISOString() : null;
    try {
      const res = await fetch("/api/share/report", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: share.token,
          action: "set_expiry",
          expiresAt,
        }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? "Failed");
      }
      setShare({ ...share, expires_at: expiresAt });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setWorking(null);
    }
  };

  return (
    <section className="rounded-md border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-heading text-base tracking-wide text-foreground">
            <span className="inline-flex items-center gap-2">
              <LinkIcon className="h-4 w-4 text-muted-foreground" />
              Public share link
            </span>
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Generate a client-facing report URL. No login required to view;
            optional write access for additional spend is controlled below.
          </p>
        </div>
        <Toggle
          enabled={enabled}
          working={working === "toggle"}
          onChange={handleToggle}
        />
      </div>

      {error && (
        <p className="mt-3 rounded-md border border-destructive bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </p>
      )}

      {share && enabled && (
        <div className="mt-5 space-y-4">
          <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border bg-muted/20 px-3 py-2.5 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-border"
              checked={share.can_edit}
              disabled={working === "can_edit"}
              onChange={(e) => void handleCanEditChange(e.target.checked)}
            />
            <span className="min-w-0">
              <span className="font-medium text-foreground">
                Allow edits (spend + budget)
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                When on, visitors with the link can add or change additional
                spend on the public report. When off, the link is view-only for
                those actions.
              </span>
            </span>
          </label>

          <div className="flex items-center gap-2">
            <Input
              readOnly
              value={url ?? ""}
              onFocus={(e) => e.currentTarget.select()}
              className="font-mono text-xs"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopy}
              disabled={!url}
            >
              {copied ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Expires at
              </label>
              <input
                type="datetime-local"
                defaultValue={isoToInput(share.expires_at)}
                onBlur={(e) => void handleExpiry(e.target.value)}
                className="mt-1 h-9 w-full rounded-md border border-border-strong bg-background px-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                Leave blank for no expiry.
                {working === "expiry" && (
                  <span className="ml-1 inline-flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" /> saving…
                  </span>
                )}
              </p>
            </div>

            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Activity
              </p>
              <p className="mt-1 text-sm text-foreground">
                Viewed {share.view_count}{" "}
                {share.view_count === 1 ? "time" : "times"}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {share.last_viewed_at
                  ? `Last viewed ${fmtRelative(share.last_viewed_at)}`
                  : "No views yet"}
              </p>
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRegenerate}
              disabled={working === "regen"}
            >
              {working === "regen" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Regenerate link
            </Button>
          </div>
        </div>
      )}

      {share && !enabled && (
        <p className="mt-4 text-xs text-muted-foreground">
          The link is currently disabled — anyone visiting the URL sees a 404.
          Toggle back on to re-enable the same link.
        </p>
      )}

      {!share && (
        <p className="mt-4 text-xs text-muted-foreground">
          No link yet. Toggle the switch to mint one.
        </p>
      )}
    </section>
  );
}

// ─── Bits ──────────────────────────────────────────────────────────────────

function Toggle({
  enabled,
  working,
  onChange,
}: {
  enabled: boolean;
  working: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={onChange}
      disabled={working}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
        enabled ? "bg-primary" : "bg-muted"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-background shadow transition-transform ${
          enabled ? "translate-x-6" : "translate-x-1"
        }`}
      />
      {working && (
        <Loader2 className="absolute inset-0 m-auto h-3 w-3 animate-spin text-foreground" />
      )}
    </button>
  );
}

// `<input type="datetime-local">` wants `YYYY-MM-DDTHH:mm`, not full ISO.
function isoToInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

function fmtRelative(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} h ago`;
  return `${Math.round(diff / 86_400_000)} d ago`;
}
