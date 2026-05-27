"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import type { MetaAdAccount } from "@/lib/types";

interface SavedAudience {
  id: string;
  name: string;
  description: string | null;
  updatedAt: string | null;
  hasTargeting: boolean;
}

interface CellSuccess {
  sourceId: string;
  name: string;
  destMetaAudienceId: string;
}

interface CellFailure {
  sourceId: string;
  name: string;
  reason:
    | "duplicate_name"
    | "rate_limit"
    | "permission"
    | "missing_targeting"
    | "auth"
    | "unknown";
  message: string;
  code: number | null;
}

interface CloneResult {
  ok: true;
  successes: CellSuccess[];
  failures: CellFailure[];
}

type Phase = "idle" | "cloning" | "done";

export function CloneSavedAudienceForm({
  clientId,
  clientPreferredAdAccountId,
}: {
  clientId: string;
  clientPreferredAdAccountId: string | null;
}) {
  // Ad-account picker state — single shared list (Meta returns the union of
  // BM-accessible accounts via /me/adaccounts).
  const [accounts, setAccounts] = useState<MetaAdAccount[] | null>(null);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [accountsLoading, setAccountsLoading] = useState(false);

  const [sourceAccountId, setSourceAccountId] = useState<string>(
    clientPreferredAdAccountId
      ? withActPrefix(clientPreferredAdAccountId)
      : "",
  );
  const [destAccountId, setDestAccountId] = useState<string>("");

  // Source Saved Audiences.
  const [savedAudiences, setSavedAudiences] = useState<SavedAudience[] | null>(
    null,
  );
  const [savedAudiencesError, setSavedAudiencesError] = useState<string | null>(
    null,
  );
  const [savedAudiencesLoading, setSavedAudiencesLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

  // Async state for the clone action.
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<CloneResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Load ad accounts on mount. ────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setAccountsLoading(true);
    fetch("/api/meta/ad-accounts")
      .then(async (res) => {
        const json = (await res.json()) as
          | { data: MetaAdAccount[] }
          | { error: string };
        if (cancelled) return;
        if ("error" in json) {
          setAccountsError(json.error);
          setAccounts([]);
        } else {
          // Sort by name for predictable picker UX.
          const sorted = [...json.data].sort((a, b) =>
            a.name.localeCompare(b.name),
          );
          setAccounts(sorted);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAccountsError("Network error loading ad accounts.");
          setAccounts([]);
        }
      })
      .finally(() => {
        if (!cancelled) setAccountsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Reload Saved Audiences when source account changes. ───────────────────
  const fetchSavedAudiences = useCallback(async (adAccountId: string) => {
    setSavedAudiencesLoading(true);
    setSavedAudiencesError(null);
    setSavedAudiences(null);
    setSelectedIds(new Set());
    try {
      const res = await fetch(
        `/api/audiences/saved-audience/list?adAccountId=${encodeURIComponent(adAccountId)}`,
      );
      const json = (await res.json()) as
        | { ok: true; data: SavedAudience[] }
        | { ok: false; error: string };
      if (!json.ok) {
        setSavedAudiencesError(json.error);
        setSavedAudiences([]);
      } else {
        setSavedAudiences(json.data);
      }
    } catch {
      setSavedAudiencesError("Network error loading Saved Audiences.");
      setSavedAudiences([]);
    } finally {
      setSavedAudiencesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!sourceAccountId) return;
    void fetchSavedAudiences(sourceAccountId);
  }, [sourceAccountId, fetchSavedAudiences]);

  // ── Derived UI state. ─────────────────────────────────────────────────────
  const destAccountOptions = useMemo(
    () => (accounts ?? []).filter((a) => a.id !== sourceAccountId),
    [accounts, sourceAccountId],
  );

  const filteredAudiences = useMemo(() => {
    if (!savedAudiences) return [];
    const q = query.trim().toLowerCase();
    if (!q) return savedAudiences;
    return savedAudiences.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        (a.description ?? "").toLowerCase().includes(q) ||
        a.id.includes(q),
    );
  }, [savedAudiences, query]);

  const sourceAccountName =
    accounts?.find((a) => a.id === sourceAccountId)?.name ?? sourceAccountId;
  const destAccountName =
    accounts?.find((a) => a.id === destAccountId)?.name ?? destAccountId;

  const canClone =
    !!sourceAccountId &&
    !!destAccountId &&
    sourceAccountId !== destAccountId &&
    selectedIds.size > 0 &&
    phase !== "cloning";

  function toggleAudience(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setResult(null);
  }

  function selectAllFiltered() {
    setSelectedIds(new Set(filteredAudiences.map((a) => a.id)));
    setResult(null);
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setResult(null);
  }

  async function handleClone() {
    if (!canClone) return;
    setPhase("cloning");
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/audiences/saved-audience/clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceAdAccountId: sourceAccountId,
          destAdAccountId: destAccountId,
          savedAudienceIds: Array.from(selectedIds),
        }),
      });
      const json = (await res.json()) as
        | CloneResult
        | { ok: false; error: string };
      if (!("ok" in json) || json.ok !== true) {
        setError(
          "error" in json ? json.error : "Clone request failed unexpectedly.",
        );
        setPhase("idle");
        return;
      }
      setResult(json);
      setPhase("done");
    } catch {
      setError("Network error during clone. Try again.");
      setPhase("idle");
    }
  }

  function handleReset() {
    setResult(null);
    setError(null);
    setPhase("idle");
    setSelectedIds(new Set());
    // Refresh source list so cloned items don't reappear as candidates.
    if (sourceAccountId) void fetchSavedAudiences(sourceAccountId);
  }

  // ── Done screen ───────────────────────────────────────────────────────────
  if (phase === "done" && result) {
    return (
      <DoneScreen
        result={result}
        sourceAccountName={sourceAccountName}
        destAccountName={destAccountName}
        clientId={clientId}
        onReset={handleReset}
      />
    );
  }

  // ── Idle screen ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div className="rounded-md border border-border bg-card p-5 space-y-5">
        {/* Step 1 — Source account */}
        <AccountPickerSection
          step={1}
          title="Source ad account"
          description="The ad account you're copying Saved Audiences FROM."
          options={accounts ?? []}
          loading={accountsLoading}
          loadError={accountsError}
          value={sourceAccountId}
          onChange={(id) => {
            setSourceAccountId(id);
            setDestAccountId((prev) => (prev === id ? "" : prev));
          }}
        />

        {/* Step 2 — Destination account */}
        <AccountPickerSection
          step={2}
          title="Destination ad account"
          description="The ad account you're copying TO. Must be in the same Business Manager so Custom Audience references resolve."
          options={destAccountOptions}
          loading={accountsLoading}
          loadError={accountsError}
          value={destAccountId}
          onChange={setDestAccountId}
          disabled={!sourceAccountId}
          disabledHint={!sourceAccountId ? "Pick a source first." : null}
        />

        {/* Step 3 — Saved Audiences */}
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-heading text-lg tracking-wide">
              Step 3 — Saved Audiences
            </h2>
            <span className="text-xs text-muted-foreground">
              {selectedIds.size} selected
              {savedAudiences && ` · ${savedAudiences.length} total`}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Each ticked audience is POSTed once to the destination. Names are
            preserved verbatim; a collision on the destination is reported
            cleanly without aborting the batch.
          </p>

          {sourceAccountId ? (
            <>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by name, description, or ID…"
                  className="h-9 flex-1 min-w-[200px] rounded-md border border-border-strong bg-background px-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={selectAllFiltered}
                  disabled={filteredAudiences.length === 0}
                >
                  Select all{query.trim() ? " (filtered)" : ""}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={clearSelection}
                  disabled={selectedIds.size === 0}
                >
                  Clear
                </Button>
              </div>

              {savedAudiencesError && (
                <p className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                  {savedAudiencesError}
                </p>
              )}

              <div className="mt-3 max-h-[28rem] overflow-y-auto rounded-md border border-border bg-background">
                {savedAudiencesLoading && (
                  <p className="px-4 py-6 text-sm text-muted-foreground text-center">
                    Loading Saved Audiences…
                  </p>
                )}
                {!savedAudiencesLoading &&
                  (filteredAudiences.length === 0 ? (
                    <p className="px-4 py-6 text-sm text-muted-foreground text-center">
                      {savedAudiences && savedAudiences.length === 0
                        ? "No Saved Audiences on this ad account."
                        : "No matches for your search."}
                    </p>
                  ) : (
                    <ul className="divide-y divide-border text-sm">
                      {filteredAudiences.map((a) => {
                        const checked = selectedIds.has(a.id);
                        const disabled = !a.hasTargeting;
                        return (
                          <li key={a.id}>
                            <label
                              className={`flex cursor-pointer items-start gap-3 p-3 ${
                                checked ? "bg-primary/5" : "hover:bg-card"
                              } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={disabled}
                                onChange={() => toggleAudience(a.id)}
                                className="mt-0.5"
                              />
                              <div className="min-w-0 flex-1">
                                <p className="font-medium truncate">{a.name}</p>
                                <p className="mt-0.5 text-xs text-muted-foreground truncate">
                                  <code className="text-[11px]">{a.id}</code>
                                  {a.updatedAt && (
                                    <> · updated {formatDate(a.updatedAt)}</>
                                  )}
                                  {!a.hasTargeting && (
                                    <>
                                      {" · "}
                                      <span className="text-destructive">
                                        missing targeting — cannot clone
                                      </span>
                                    </>
                                  )}
                                </p>
                                {a.description && (
                                  <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                                    {a.description}
                                  </p>
                                )}
                              </div>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  ))}
              </div>
            </>
          ) : (
            <p className="mt-3 rounded-md border border-dashed border-border bg-background px-4 py-6 text-sm text-muted-foreground text-center">
              Pick a source ad account to load its Saved Audiences.
            </p>
          )}
        </div>

        {/* Preview + Clone */}
        <div className="rounded-md border border-border bg-background p-4 space-y-3">
          <p className="text-sm">
            {selectedIds.size > 0 && sourceAccountId && destAccountId ? (
              <>
                Cloning <strong>{selectedIds.size}</strong> audience
                {selectedIds.size === 1 ? "" : "s"} from{" "}
                <strong>{sourceAccountName}</strong> →{" "}
                <strong>{destAccountName}</strong>.
              </>
            ) : (
              <span className="text-muted-foreground">
                Pick source, destination, and at least one audience to enable
                the clone.
              </span>
            )}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={() => void handleClone()} disabled={!canClone}>
              {phase === "cloning"
                ? "Cloning…"
                : `Clone ${selectedIds.size} audience${
                    selectedIds.size === 1 ? "" : "s"
                  }`}
            </Button>
            {error && (
              <span className="text-sm text-destructive">{error}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function AccountPickerSection({
  step,
  title,
  description,
  options,
  loading,
  loadError,
  value,
  onChange,
  disabled,
  disabledHint,
}: {
  step: number;
  title: string;
  description: string;
  options: MetaAdAccount[];
  loading: boolean;
  loadError: string | null;
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  disabledHint?: string | null;
}) {
  return (
    <div>
      <h2 className="font-heading text-lg tracking-wide">
        Step {step} — {title}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      {loadError && (
        <p className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          {loadError}
        </p>
      )}
      <div className="mt-3">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled || loading || options.length === 0}
          className="h-9 w-full max-w-lg rounded-md border border-border-strong bg-background px-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
        >
          <option value="">
            {loading
              ? "Loading ad accounts…"
              : options.length === 0
                ? "No ad accounts available"
                : "— Pick an ad account —"}
          </option>
          {options.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} · {a.id}
            </option>
          ))}
        </select>
        {disabled && disabledHint && (
          <p className="mt-1 text-xs text-muted-foreground">{disabledHint}</p>
        )}
      </div>
    </div>
  );
}

function DoneScreen({
  result,
  sourceAccountName,
  destAccountName,
  clientId,
  onReset,
}: {
  result: CloneResult;
  sourceAccountName: string;
  destAccountName: string;
  clientId: string;
  onReset: () => void;
}) {
  const { successes, failures } = result;
  return (
    <div className="space-y-6">
      <div className="rounded-md border border-border bg-card p-5">
        <p className="font-heading text-xl tracking-wide">
          {successes.length} cloned · {failures.length} failed
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {sourceAccountName} → {destAccountName}
        </p>
      </div>

      {successes.length > 0 && (
        <div className="space-y-1.5">
          <h3 className="text-xs uppercase tracking-wide text-muted-foreground">
            Cloned
          </h3>
          {successes.map((s) => (
            <ResultRow
              key={s.sourceId}
              status="success"
              name={s.name}
              detail={`Created on destination: ${s.destMetaAudienceId}`}
            />
          ))}
        </div>
      )}

      {failures.length > 0 && (
        <div className="space-y-1.5">
          <h3 className="text-xs uppercase tracking-wide text-muted-foreground">
            Failed
          </h3>
          {failures.map((f) => (
            <ResultRow
              key={f.sourceId}
              status="failed"
              name={f.name}
              detail={`${failureLabel(f.reason)}${f.code ? ` (code ${f.code})` : ""}: ${f.message}`}
            />
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="outline" onClick={onReset}>
          Run another clone
        </Button>
        <a
          href={`/audiences/${clientId}`}
          className="inline-flex h-9 items-center justify-center rounded-md border border-border-strong px-4 text-sm font-medium hover:bg-card"
        >
          Back to audiences
        </a>
      </div>
    </div>
  );
}

function ResultRow({
  status,
  name,
  detail,
}: {
  status: "success" | "failed";
  name: string;
  detail: string;
}) {
  return (
    <div
      className={`flex items-start gap-3 rounded-md border px-4 py-2.5 text-sm ${
        status === "success"
          ? "border-green-400/30 bg-green-50 dark:bg-green-950/20"
          : "border-destructive/30 bg-destructive/5"
      }`}
    >
      <span className="mt-0.5 text-base leading-none">
        {status === "success" ? "✓" : "×"}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium truncate">{name}</p>
        <p className="text-xs text-muted-foreground break-words">{detail}</p>
      </div>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function failureLabel(reason: CellFailure["reason"]): string {
  switch (reason) {
    case "duplicate_name":
      return "Already exists on destination";
    case "rate_limit":
      return "Ad-account rate limit";
    case "permission":
      return "Permission denied";
    case "missing_targeting":
      return "Source has no targeting spec";
    case "auth":
      return "Facebook session expired";
    default:
      return "Failed";
  }
}

function formatDate(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function withActPrefix(id: string): string {
  return id.startsWith("act_") ? id : `act_${id}`;
}
