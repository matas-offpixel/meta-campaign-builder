"use client";

import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  ShieldCheck,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Per-client Meta Business Manager System User token UI (Phase 1
 * canary — see `docs/META_TOKEN_ARCHITECTURE_2026-05-11.md` §5).
 *
 * Lives on the client detail Overview tab, immediately under the
 * existing "Meta Business assets" card. Hidden entirely unless the
 * server reports `featureEnabled = true`
 * (`OFFPIXEL_META_SYSTEM_USER_ENABLED`). When enabled, renders a
 * collapsed advanced section so the regular ad-account / pixel
 * picker continues to dominate the visual hierarchy — System User
 * provisioning is a one-off retainer-tier ceremony that operators
 * touch once, not a daily action.
 *
 * Save flow: POST raw token to `/api/clients/[id]/meta-system-user-token`.
 * The server validates via Meta's `/debug_token` (must come back
 * `is_valid:true` with `ads_management` granted) before persisting,
 * so we never store a token that won't actually authorise the
 * downstream calls.
 *
 * Remove flow: DELETE clears the encrypted blob + both timestamps in a
 * single RPC. The "Remove" button is gated behind a confirm because a
 * mis-click on a live retainer would silently route every audience
 * write back to the personal-OAuth path until someone re-pasted.
 */

interface InitialState {
  present: boolean;
  setAt: string | null;
  lastUsedAt: string | null;
}

interface Props {
  clientId: string;
  initial: InitialState;
}

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; masked: string | null }
  | { kind: "error"; message: string };

export function MetaSystemUserTokenCard({ clientId, initial }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [present, setPresent] = useState(initial.present);
  const [setAt, setSetAt] = useState(initial.setAt);
  const [lastUsedAt, setLastUsedAt] = useState(initial.lastUsedAt);
  const [masked, setMasked] = useState<string | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [confirmRemove, setConfirmRemove] = useState(false);

  const handleSave = async () => {
    const trimmed = tokenInput.trim();
    if (trimmed.length === 0) {
      setSave({ kind: "error", message: "Paste the System User token first." });
      return;
    }
    setSave({ kind: "saving" });
    try {
      const res = await fetch(
        `/api/clients/${clientId}/meta-system-user-token`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: trimmed }),
        },
      );
      const json = (await res.json().catch(() => null)) as
        | {
            ok?: boolean;
            error?: string;
            present?: boolean;
            masked?: string;
            setAt?: string | null;
            lastUsedAt?: string | null;
          }
        | null;
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      setPresent(Boolean(json.present));
      setSetAt(json.setAt ?? null);
      setLastUsedAt(json.lastUsedAt ?? null);
      setMasked(json.masked ?? null);
      setTokenInput("");
      setSave({ kind: "saved", masked: json.masked ?? null });
    } catch (err) {
      setSave({
        kind: "error",
        message: err instanceof Error ? err.message : "Save failed",
      });
    }
  };

  const handleRemove = async () => {
    setSave({ kind: "saving" });
    try {
      const res = await fetch(
        `/api/clients/${clientId}/meta-system-user-token`,
        { method: "DELETE" },
      );
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      setPresent(false);
      setSetAt(null);
      setLastUsedAt(null);
      setMasked(null);
      setConfirmRemove(false);
      setSave({ kind: "idle" });
    } catch (err) {
      setSave({
        kind: "error",
        message: err instanceof Error ? err.message : "Remove failed",
      });
    }
  };

  return (
    <section className="rounded-md border border-border bg-card">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <div className="flex items-start gap-3">
          {expanded ? (
            <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <div>
            <h2 className="font-heading text-base tracking-wide flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-muted-foreground" />
              Advanced: Meta System User token
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Per-client non-expiring token. Routes the rollup-sync cron
              and audience bulk writes to a separate Business Use Case
              rate-limit bucket so they stop competing with everything
              else for #17 budget.
            </p>
          </div>
        </div>
        <div className="shrink-0">
          {present ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
              <CheckCircle2 className="h-3 w-3" />
              Saved
            </span>
          ) : (
            <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              Not set
            </span>
          )}
        </div>
      </button>

      {expanded && (
        <div className="space-y-4 border-t border-border px-5 py-4 text-sm">
          {present && (
            <div className="space-y-2 rounded-md border border-border bg-background p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  Token saved
                </p>
                {masked && (
                  <span className="rounded bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                    {masked}
                  </span>
                )}
              </div>
              <dl className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <div>
                  <dt className="text-[10px] uppercase tracking-wider">
                    Set
                  </dt>
                  <dd>{formatTimestamp(setAt)}</dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wider">
                    Last used
                  </dt>
                  <dd>{formatTimestamp(lastUsedAt)}</dd>
                </div>
              </dl>
              <div className="pt-2">
                {confirmRemove ? (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={handleRemove}
                      disabled={save.kind === "saving"}
                    >
                      {save.kind === "saving" ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Trash2 className="h-3 w-3" />
                      )}
                      Confirm remove
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmRemove(false)}
                      disabled={save.kind === "saving"}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmRemove(true)}
                  >
                    <Trash2 className="h-3 w-3" />
                    Remove
                  </Button>
                )}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <label
              htmlFor={`meta-system-user-token-${clientId}`}
              className="block text-xs font-medium text-foreground"
            >
              {present ? "Replace token" : "Paste System User token"}
            </label>
            <textarea
              id={`meta-system-user-token-${clientId}`}
              className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
              rows={3}
              placeholder="EAAB… (paste a Meta Business Manager System User token with ads_management scope)"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-muted-foreground">
                Validated against Meta&apos;s /debug_token before saving.
                Must include the <code>ads_management</code> scope.
              </p>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={save.kind === "saving" || tokenInput.trim().length === 0}
              >
                {save.kind === "saving" && (
                  <Loader2 className="h-3 w-3 animate-spin" />
                )}
                {present ? "Replace token" : "Save token"}
              </Button>
            </div>
            {save.kind === "saved" && (
              <p className="flex items-center gap-1 text-[11px] text-emerald-600">
                <CheckCircle2 className="h-3 w-3" />
                Saved {save.masked ? `(${save.masked})` : ""}
              </p>
            )}
            {save.kind === "error" && (
              <p className="flex items-start gap-1 text-[11px] text-destructive">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>{save.message}</span>
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function formatTimestamp(value: string | null): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}
