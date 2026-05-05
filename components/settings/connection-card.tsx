"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, Loader2, PlugZap, Unplug } from "lucide-react";

import { Button } from "@/components/ui/button";
import type {
  ConnectionBadgeStatus,
  PlatformConnectionStatus,
} from "@/lib/settings/connection-status";

function relativeTime(value: string | null): string {
  if (!value) return "Not available";
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms)) return "Not available";
  const diffSeconds = Math.round((ms - Date.now()) / 1000);
  const abs = Math.abs(diffSeconds);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < 60) return rtf.format(diffSeconds, "second");
  if (abs < 60 * 60) return rtf.format(Math.round(diffSeconds / 60), "minute");
  if (abs < 60 * 60 * 24) return rtf.format(Math.round(diffSeconds / 3600), "hour");
  if (abs < 60 * 60 * 24 * 30) {
    return rtf.format(Math.round(diffSeconds / 86400), "day");
  }
  return rtf.format(Math.round(diffSeconds / (86400 * 30)), "month");
}

function badgeCopy(status: ConnectionBadgeStatus): {
  label: string;
  className: string;
} {
  switch (status) {
    case "connected":
      return {
        label: "🟢 Connected",
        className: "border-emerald-500/50 bg-emerald-500/10 text-emerald-700",
      };
    case "expiring_soon":
      return {
        label: "🟡 Token expiring soon",
        className: "border-amber-500/50 bg-amber-500/10 text-amber-700",
      };
    case "disconnected":
      return {
        label: "🔴 Disconnected",
        className: "border-red-500/50 bg-red-500/10 text-red-700",
      };
  }
}

export function ConnectionCard({
  connection,
}: {
  connection: PlatformConnectionStatus;
}) {
  const [status, setStatus] = useState(connection.status);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const badge = badgeCopy(status);
  const connectedAt = useMemo(
    () => relativeTime(connection.connectedAt),
    [connection.connectedAt],
  );
  const tokenExpires = useMemo(
    () => relativeTime(connection.tokenExpiresAt),
    [connection.tokenExpiresAt],
  );

  async function handleFacebookReconnect() {
    if (!connection.reconnectHref) return;
    setBusy(true);
    setInlineError(null);
    const popup = window.open(
      connection.reconnectHref,
      "facebook_reconnect",
      "popup,width=760,height=760",
    );
    if (!popup) {
      setBusy(false);
      setInlineError("Popup blocked - allow popups and try again.");
      return;
    }

    const startedAt = Date.now();
    const timer = window.setInterval(async () => {
      if (Date.now() - startedAt > 30_000) {
        window.clearInterval(timer);
        setBusy(false);
        setInlineError("Token exchange failed - try again.");
        return;
      }
      try {
        const res = await fetch("/api/auth/facebook-token", {
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!res.ok) return;
        const json = (await res.json()) as { token?: string | null };
        if (json.token) {
          window.clearInterval(timer);
          setStatus("connected");
          setBusy(false);
          popup.close();
        }
      } catch {
        // Keep polling until the 30s budget expires.
      }
    }, 2000);
  }

  async function handleFacebookDisconnect() {
    setBusy(true);
    setInlineError(null);
    try {
      const res = await fetch("/api/auth/facebook-token", {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(json.error ?? "Disconnect failed.");
      }
      localStorage.removeItem("facebook_provider_token");
      setStatus("disconnected");
    } catch (err) {
      setInlineError(err instanceof Error ? err.message : "Disconnect failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="font-heading text-lg tracking-wide text-foreground">
            {connection.title}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {connection.description}
          </p>
        </div>
        <span
          className={`inline-flex w-fit items-center rounded-full border px-2.5 py-1 text-xs font-medium ${badge.className}`}
        >
          {badge.label}
        </span>
      </div>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Connected as
          </dt>
          <dd className="mt-1 text-foreground">
            {connection.connectedAs ?? "Not connected"}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Connected at
          </dt>
          <dd className="mt-1 text-foreground">{connectedAt}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Token expires
          </dt>
          <dd className="mt-1 text-foreground">{tokenExpires}</dd>
        </div>
      </dl>

      <details className="mt-4 rounded-md border border-border bg-background/60 p-3">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
          Granted scopes ({connection.scopes.length})
        </summary>
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {connection.scopes.map((scope) => (
            <li
              key={scope}
              className="rounded-full border border-border bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground"
            >
              {scope}
            </li>
          ))}
        </ul>
      </details>

      <div className="mt-4">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Connected accounts
        </p>
        {connection.accounts.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">
            No connected accounts found.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {connection.accounts.map((account) => (
              <li
                key={account.id}
                className="rounded-md border border-border bg-background/60 px-3 py-2 text-sm"
              >
                <div className="font-medium text-foreground">{account.name}</div>
                {account.meta ? (
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {account.meta}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {(connection.statusNote || inlineError) && (
        <p className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800">
          {inlineError ?? connection.statusNote}
        </p>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        {connection.id === "facebook" ? (
          <Button
            type="button"
            size="sm"
            variant="primary"
            disabled={busy}
            onClick={() => void handleFacebookReconnect()}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <PlugZap className="h-3.5 w-3.5" />
            )}
            Reconnect
          </Button>
        ) : connection.reconnectHref ? (
          <a href={connection.reconnectHref}>
            <Button type="button" size="sm" variant="primary">
              <PlugZap className="h-3.5 w-3.5" />
              Reconnect
            </Button>
          </a>
        ) : (
          <Button type="button" size="sm" variant="primary" disabled>
            <PlugZap className="h-3.5 w-3.5" />
            Reconnect
          </Button>
        )}

        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || !connection.disconnectEnabled}
          onClick={() => {
            if (connection.id === "facebook") void handleFacebookDisconnect();
          }}
        >
          <Unplug className="h-3.5 w-3.5" />
          Disconnect
        </Button>

        {connection.detailsHref ? (
          <Link href={connection.detailsHref}>
            <Button type="button" size="sm" variant="ghost">
              <ExternalLink className="h-3.5 w-3.5" />
              View details
            </Button>
          </Link>
        ) : (
          <Button type="button" size="sm" variant="ghost" disabled>
            <ExternalLink className="h-3.5 w-3.5" />
            View details
          </Button>
        )}
      </div>
    </article>
  );
}
