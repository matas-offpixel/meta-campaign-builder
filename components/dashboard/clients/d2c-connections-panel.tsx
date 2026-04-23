"use client";

import { useEffect, useState, type FormEvent } from "react";
import { AlertCircle, CheckCircle2, Loader2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type {
  D2CConnection,
  D2CConnectionStatus,
  D2CProviderName,
} from "@/lib/d2c/types";

/**
 * components/dashboard/clients/d2c-connections-panel.tsx
 *
 * Mirror of the ticketing connections panel for D2C providers
 * (Mailchimp, Klaviyo, Bird, Firetext). Until FEATURE_D2C_LIVE is set,
 * `validateCredentials` always returns ok:false with a "live mode
 * disabled" message — the UI surfaces that as a clear pending-state
 * banner rather than letting the user think their token is bad.
 *
 * Credentials never round-trip through the browser after submit; the
 * server always returns rows with credentials:null.
 */

interface ConnectionRow extends Omit<D2CConnection, "credentials"> {
  credentials: null;
}

async function patchLiveFlags(
  id: string,
  body: { live_enabled: boolean; approved_by_matas: boolean },
): Promise<{ ok: boolean; error?: string; connection?: ConnectionRow }> {
  const res = await fetch(`/api/d2c/connections/${id}/live`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as {
    ok: boolean;
    error?: string;
    connection?: ConnectionRow;
  };
}

interface Props {
  clientId: string;
  initial: ConnectionRow[];
}

interface ProviderOption {
  value: D2CProviderName;
  label: string;
  hint: string;
  fields: Array<{ key: string; label: string; placeholder?: string }>;
}

const PROVIDERS: ProviderOption[] = [
  {
    value: "mailchimp",
    label: "Mailchimp",
    hint: "API key + server prefix from your Mailchimp account",
    fields: [
      { key: "api_key", label: "API key", placeholder: "xxxx-us21" },
      { key: "server_prefix", label: "Server prefix", placeholder: "us21" },
    ],
  },
  {
    value: "klaviyo",
    label: "Klaviyo",
    hint: "Private API key (starts with pk_)",
    fields: [
      { key: "api_key", label: "Private API key", placeholder: "pk_..." },
    ],
  },
  {
    value: "bird",
    label: "Bird (SMS / WhatsApp)",
    hint: "Workspace API key + channel id",
    fields: [
      { key: "api_key", label: "API key" },
      { key: "channel_id", label: "Channel id" },
    ],
  },
  {
    value: "firetext",
    label: "Firetext (UK SMS)",
    hint: "API key + agreed sender id",
    fields: [
      { key: "api_key", label: "API key" },
      { key: "sender", label: "Sender id" },
    ],
  },
];

const STATUS_LABELS: Record<D2CConnectionStatus, string> = {
  active: "Active",
  paused: "Paused",
  error: "Error",
};

export function D2CConnectionsPanel({ clientId, initial }: Props) {
  const [connections, setConnections] = useState<ConnectionRow[]>(initial);
  const [provider, setProvider] = useState<D2CProviderName>("mailchimp");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMessage, setOkMessage] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [liveSavingId, setLiveSavingId] = useState<string | null>(null);

  useEffect(() => {
    setConnections(initial);
  }, [initial]);

  // Reset field state when provider changes so we don't leak partial
  // credentials across providers.
  useEffect(() => {
    setFields({});
    setError(null);
    setOkMessage(null);
  }, [provider]);

  const activeProvider = PROVIDERS.find((p) => p.value === provider)!;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setOkMessage(null);

    const credentials: Record<string, string> = {};
    for (const f of activeProvider.fields) {
      const v = fields[f.key]?.trim() ?? "";
      if (!v) {
        setError(`${f.label} is required.`);
        return;
      }
      credentials[f.key] = v;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/d2c/connections", {
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
              !(
                c.client_id === clientId &&
                c.provider === json.connection!.provider
              ),
          );
          return [json.connection!, ...filtered];
        });
      }
      setFields({});
      setOkMessage("Connection saved.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLivePatch(
    id: string,
    next: { live_enabled: boolean; approved_by_matas: boolean },
  ) {
    setError(null);
    setOkMessage(null);
    setLiveSavingId(id);
    try {
      const json = await patchLiveFlags(id, next);
      if (!json.ok || !json.connection) {
        setError(json.error ?? "Failed to update live flags.");
        return;
      }
      setConnections((prev) =>
        prev.map((c) => (c.id === id ? json.connection! : c)),
      );
      setOkMessage("Live flags updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLiveSavingId(null);
    }
  }

  async function handleRemove(id: string) {
    setError(null);
    setOkMessage(null);
    setRemovingId(id);
    try {
      const res = await fetch(`/api/d2c/connections/${id}?hard=1`, {
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
        <CardTitle>D2C comms</CardTitle>
        <CardDescription>
          Connect Mailchimp (API key + server prefix validated via ping).
          Credentials are encrypted at rest. Per-client{" "}
          <strong className="font-medium">live</strong> and{" "}
          <strong className="font-medium">Matas approved</strong> toggles,
          plus the global <code className="rounded bg-muted px-1">FEATURE_D2C_LIVE</code>{" "}
          env flag, must all be on before real sends leave the server.
        </CardDescription>
      </CardHeader>

      <div className="space-y-6">
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Connected providers
          </h4>
          {connections.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No D2C providers connected yet.
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
                      <StatusPill status={c.status} />
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {c.external_account_id
                        ? `Account ${c.external_account_id}`
                        : "Pending — live mode disabled"}
                    </p>
                    {c.last_error ? (
                      <p className="mt-1 inline-flex items-center gap-1 text-xs text-destructive">
                        <AlertCircle className="h-3 w-3" />
                        {c.last_error}
                      </p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                      <label className="inline-flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          className="rounded border-input"
                          checked={c.live_enabled}
                          disabled={liveSavingId === c.id}
                          onChange={(e) =>
                            void handleLivePatch(c.id, {
                              live_enabled: e.target.checked,
                              approved_by_matas: c.approved_by_matas,
                            })
                          }
                        />
                        Live enabled
                      </label>
                      <label className="inline-flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          className="rounded border-input"
                          checked={c.approved_by_matas}
                          disabled={liveSavingId === c.id}
                          onChange={(e) =>
                            void handleLivePatch(c.id, {
                              live_enabled: c.live_enabled,
                              approved_by_matas: e.target.checked,
                            })
                          }
                        />
                        Matas approved
                      </label>
                    </div>
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
                  setProvider(e.target.value as D2CProviderName)
                }
                options={PROVIDERS.map((p) => ({
                  value: p.value,
                  label: p.label,
                }))}
              />
              <span className="text-xs text-muted-foreground">
                {activeProvider.hint}
              </span>
            </label>
            <div className="space-y-2 sm:col-span-1">
              {activeProvider.fields.map((f) => (
                <label key={f.key} className="flex flex-col gap-1 text-sm">
                  <span className="text-xs text-muted-foreground">
                    {f.label}
                  </span>
                  <Input
                    type="password"
                    autoComplete="off"
                    placeholder={f.placeholder}
                    value={fields[f.key] ?? ""}
                    onChange={(e) =>
                      setFields((prev) => ({
                        ...prev,
                        [f.key]: e.target.value,
                      }))
                    }
                  />
                </label>
              ))}
            </div>
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
                  Saving…
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

function StatusPill({ status }: { status: D2CConnectionStatus }) {
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
