"use client";

import { useEffect, useState, type FormEvent } from "react";
import { AlertCircle, CheckCircle2, Loader2, Trash2 } from "lucide-react";

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
}

const PROVIDERS: Array<{ value: TicketingProviderName; label: string }> = [
  { value: "eventbrite", label: "Eventbrite (paste personal token)" },
  { value: "fourthefans", label: "4TheFans (pending — flag-gated)" },
];

const STATUS_LABELS: Record<TicketingConnectionStatus, string> = {
  active: "Active",
  paused: "Paused",
  error: "Error",
};

export function TicketingConnectionsPanel({ clientId, initial }: Props) {
  const [connections, setConnections] = useState<ConnectionRow[]>(initial);
  const [provider, setProvider] = useState<TicketingProviderName>("eventbrite");
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMessage, setOkMessage] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  // Re-hydrate from server props if the parent rerenders with a fresh
  // server fetch (e.g. after `router.refresh()`). Without this, manual
  // changes from another tab wouldn't show until a hard reload.
  useEffect(() => {
    setConnections(initial);
  }, [initial]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setOkMessage(null);

    if (provider === "eventbrite" && !token.trim()) {
      setError("Paste your Eventbrite personal token to continue.");
      return;
    }

    setSubmitting(true);
    try {
      const credentials =
        provider === "eventbrite"
          ? { personal_token: token.trim() }
          : { /* placeholder; 4TheFans path returns 400 anyway */ };

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
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Connected providers
          </h4>
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
                  </div>
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
            {provider === "eventbrite" ? (
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-xs text-muted-foreground">
                  Personal OAuth token
                </span>
                <Input
                  type="password"
                  autoComplete="off"
                  placeholder="paste from eventbrite.com → account → developer"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
              </label>
            ) : (
              <p className="text-xs text-muted-foreground sm:col-span-1">
                The 4TheFans native API is pending. Save will be enabled once
                <code className="ml-1 rounded bg-muted px-1">
                  FEATURE_FOURTHEFANS_API
                </code>{" "}
                is set.
              </p>
            )}
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
