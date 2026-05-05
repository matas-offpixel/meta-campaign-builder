"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type {
  TicketingConnection,
  TicketingConnectionStatus,
  TicketingProviderName,
} from "@/lib/ticketing/types";

/**
 * components/dashboard/clients/ticketing-connections-panel.tsx
 *
 * Lists existing ticketing connections for a client and lets the user
 * add a new one or remove an existing one. Validation is server-side:
 * POST /api/ticketing/connections rejects bad credentials before
 * persisting, so a 4xx response here means the user pasted a bad token.
 *
 * Provider list is hard-coded to match the DB check constraint and the
 * registry. Adding a new provider takes two edits: this list + the
 * registry. (We could derive this from a shared constant — leave that
 * for the next pass once a third provider lands.)
 */

interface ConnectionRow extends Omit<TicketingConnection, "credentials"> {
  /** Server strips credentials before returning. Always null in the panel. */
  credentials: null;
}

interface Props {
  clientId: string;
  initial: ConnectionRow[];
  linkDiscoveryStats: {
    totalEvents: number;
    linkedEvents: number;
    unlinkedEvents: number;
  };
}

const PROVIDERS: Array<{ value: TicketingProviderName; label: string }> = [
  { value: "eventbrite", label: "Eventbrite (paste personal token)" },
  { value: "fourthefans", label: "4thefans (paste API key)" },
  { value: "manual", label: "Manual entry (no upstream API)" },
];

const STATUS_LABELS: Record<TicketingConnectionStatus, string> = {
  active: "Active",
  paused: "Paused",
  error: "Error",
};

export function TicketingConnectionsPanel({
  clientId,
  initial,
  linkDiscoveryStats,
}: Props) {
  const [connections, setConnections] = useState<ConnectionRow[]>(initial);
  const [provider, setProvider] = useState<TicketingProviderName>("eventbrite");
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMessage, setOkMessage] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [autoRetriedKeys, setAutoRetriedKeys] = useState<Set<string>>(
    () => new Set(),
  );

  // Re-hydrate from server props if the parent rerenders with a fresh
  // server fetch (e.g. after `router.refresh()`). Without this, manual
  // changes from another tab wouldn't show until a hard reload.
  useEffect(() => {
    setConnections(initial);
  }, [initial]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    for (const connection of connections) {
      const rateLimit = getRateLimitState(connection, nowMs);
      if (!rateLimit || rateLimit.remainingMs > 0 || retryingId) continue;
      const key = `${connection.id}:${connection.last_error ?? ""}:${connection.last_synced_at ?? connection.updated_at}`;
      if (autoRetriedKeys.has(key)) continue;
      setAutoRetriedKeys((prev) => new Set(prev).add(key));
      void handleRetryConnection(connection.id);
      break;
    }
  }, [autoRetriedKeys, connections, nowMs, retryingId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setOkMessage(null);

    if (
      (provider === "eventbrite" || provider === "fourthefans") &&
      !token.trim()
    ) {
      setError(
        provider === "eventbrite"
          ? "Paste your Eventbrite personal token to continue."
          : "Paste your 4thefans API key to continue.",
      );
      return;
    }

    setSubmitting(true);
    try {
      // Manual is a "null provider" — no upstream to authenticate
      // against. Ship an empty credentials blob; the server-side
      // `validateCredentials` for the manual provider always returns
      // ok.
      const credentials =
        provider === "eventbrite"
          ? { personal_token: token.trim() }
          : provider === "fourthefans"
            ? { access_token: token.trim() }
          : {};

      const res = await fetch("/api/ticketing/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, provider, credentials }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        connection?: ConnectionRow;
      };
      if (!res.ok || !json.ok) {
        setError(json.error ?? "Failed to save the connection.");
        return;
      }

      if (json.connection) {
        setConnections((prev) => {
          const filtered = prev.filter(
            (c) =>
              !(c.client_id === clientId && c.provider === json.connection!.provider),
          );
          return [json.connection!, ...filtered];
        });
      }
      setToken("");
      setOkMessage("Connection saved.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove(id: string) {
    setError(null);
    setOkMessage(null);
    setRemovingId(id);
    try {
      const res = await fetch(`/api/ticketing/connections/${id}?hard=1`, {
        method: "DELETE",
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setError(json.error ?? "Failed to remove the connection.");
        return;
      }
      setConnections((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
    } finally {
      setRemovingId(null);
    }
  }

  async function handleRetryConnection(id: string) {
    setError(null);
    setOkMessage(null);
    setRetryingId(id);
    try {
      const res = await fetch(`/api/ticketing/connections/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retry: true }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        connection?: ConnectionRow | null;
      };
      if (!res.ok || !json.ok) {
        const message = json.error ?? "Retry failed.";
        setConnections((prev) =>
          prev.map((c) =>
            c.id === id
              ? {
                  ...c,
                  status: "error",
                  last_error: message,
                  last_synced_at: new Date().toISOString(),
                }
              : c,
          ),
        );
        return;
      }
      if (json.connection) {
        setConnections((prev) =>
          prev.map((c) => (c.id === id ? json.connection! : c)),
        );
      }
      setOkMessage("Connection retry succeeded.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Retry failed.";
      setError(message);
    } finally {
      setRetryingId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ticketing</CardTitle>
        <CardDescription>
          Connect a ticketing provider so the dashboard can pull live
          sales into reporting + pacing charts. Credentials are stored
          server-side; we never echo the token back to the browser.
        </CardDescription>
      </CardHeader>

      <div className="space-y-6">
        {/* Existing connections */}
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Connected providers
            </h4>
            <Link
              href={`/clients/${clientId}/ticketing-link-discovery`}
              className="inline-flex h-8 items-center gap-2 rounded-md border border-border-strong px-3 text-xs font-medium text-foreground transition-colors hover:bg-card"
              title="Open unified auto-match discovery for unlinked ticketing events across all connected providers"
            >
              Discover matches ·{" "}
              {linkDiscoveryStats.unlinkedEvents} event
              {linkDiscoveryStats.unlinkedEvents === 1 ? "" : "s"} to match
              across all providers
            </Link>
          </div>
          {connections.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No providers connected yet.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {connections.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-4 px-3 py-2 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 font-medium text-foreground">
                      <span className="capitalize">{c.provider}</span>
                      <StatusPill status={c.status as TicketingConnectionStatus} />
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {c.external_account_id
                        ? `Account ${c.external_account_id}`
                        : "No external account id"}
                      {c.last_synced_at
                        ? ` · last synced ${formatTimestamp(c.last_synced_at)}`
                        : " · not yet synced"}
                    </p>
                    {c.last_error ? (
                      <p className="mt-1 inline-flex items-center gap-1 text-xs text-destructive">
                        <AlertCircle className="h-3 w-3" />
                        {c.last_error}
                      </p>
                    ) : null}
                    <RateLimitNotice
                      connection={c}
                      nowMs={nowMs}
                      retrying={retryingId === c.id}
                      onRetry={() => void handleRetryConnection(c.id)}
                    />
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <Button
                      variant="ghost"
                      type="button"
                      onClick={() => handleRemove(c.id)}
                      disabled={removingId === c.id}
                      aria-label={`Remove ${c.provider} connection`}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      {removingId === c.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Add new connection */}
        <form className="space-y-3" onSubmit={handleSubmit}>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Add a connection
          </h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs text-muted-foreground">Provider</span>
              <Select
                value={provider}
                onChange={(e) =>
                  setProvider(e.target.value as TicketingProviderName)
                }
                options={PROVIDERS.map((p) => ({
                  value: p.value,
                  label: p.label,
                }))}
              />
            </label>
            {provider === "eventbrite" || provider === "fourthefans" ? (
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-xs text-muted-foreground">
                  {provider === "eventbrite"
                    ? "Personal OAuth token"
                    : "4thefans API key"}
                </span>
                <Input
                  type="password"
                  autoComplete="off"
                  placeholder={
                    provider === "eventbrite"
                      ? "paste from eventbrite.com -> account -> developer"
                      : "paste agency API key"
                  }
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
              </label>
            ) : provider === "manual" ? (
              <p className="text-xs text-muted-foreground sm:col-span-1">
                No credentials needed. Ticket counts are entered by hand
                on each event&rsquo;s manual-tickets page.
              </p>
            ) : null}
          </div>

          {error ? (
            <p className="inline-flex items-center gap-1 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              {error}
            </p>
          ) : null}
          {okMessage ? (
            <p className="inline-flex items-center gap-1 text-sm text-emerald-600">
              <CheckCircle2 className="h-4 w-4" />
              {okMessage}
            </p>
          ) : null}

          <div>
            <Button type="submit" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Validating…
                </>
              ) : (
                "Save connection"
              )}
            </Button>
          </div>
        </form>
      </div>
    </Card>
  );
}

function RateLimitNotice({
  connection,
  nowMs,
  retrying,
  onRetry,
}: {
  connection: ConnectionRow;
  nowMs: number;
  retrying: boolean;
  onRetry: () => void;
}) {
  const rateLimit = getRateLimitState(connection, nowMs);
  if (!rateLimit) return null;
  const seconds = Math.max(0, Math.ceil(rateLimit.remainingMs / 1000));
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-yellow-700">
      <span>
        Rate limit hit.{" "}
        {seconds > 0 ? `Retry in ${seconds}s` : "Retrying now..."}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onRetry}
        disabled={retrying}
      >
        {retrying ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5" />
        )}
        Retry now
      </Button>
    </div>
  );
}

function getRateLimitState(
  connection: ConnectionRow,
  nowMs: number,
): { remainingMs: number } | null {
  const error = connection.last_error ?? "";
  if (!/rate limit/i.test(error)) return null;
  const retrySecondsMatch = error.match(/retry in\s+(\d+)s/i);
  const retrySeconds = retrySecondsMatch
    ? Number(retrySecondsMatch[1])
    : 60;
  const anchor = Date.parse(connection.last_synced_at ?? connection.updated_at);
  const hitAt = Number.isFinite(anchor) ? anchor : nowMs;
  return {
    remainingMs: hitAt + retrySeconds * 1000 - nowMs,
  };
}

function StatusPill({ status }: { status: TicketingConnectionStatus }) {
  const tone =
    status === "active"
      ? "bg-emerald-100 text-emerald-800"
      : status === "paused"
        ? "bg-muted text-muted-foreground"
        : "bg-destructive/10 text-destructive";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
