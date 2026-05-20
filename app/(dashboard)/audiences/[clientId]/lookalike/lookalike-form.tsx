"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DEFAULT_LOOKALIKE_COUNTRY,
  LOOKALIKE_COUNTRY_OPTIONS,
  LOOKALIKE_TIERS,
  type LookalikePreview,
  type LookalikeSeedCandidate,
  type LookalikeTier,
} from "@/lib/audiences/lookalike-types";

// ── Types ─────────────────────────────────────────────────────────────────────

type Phase = "idle" | "previewing" | "previewed" | "creating" | "done";
type SeedSource = "db" | "meta";

interface CellSuccess {
  audienceId: string;
  metaAudienceId: string | null;
  name: string;
  seedMetaAudienceId: string;
  seedName: string;
}

interface CellFailure {
  audienceId: string;
  error: string;
  name: string;
  seedMetaAudienceId: string;
  seedName: string;
}

interface CreateResponse {
  ok: true;
  preview: LookalikePreview;
  draftIds: string[];
  successes: CellSuccess[];
  failures: CellFailure[];
}

// ── Component ─────────────────────────────────────────────────────────────────

export function BulkLookalikeForm({
  clientId,
  clientName,
  clientSlug,
  initialDbSeeds,
  writesEnabled,
}: {
  clientId: string;
  clientName: string;
  clientSlug: string | null;
  initialDbSeeds: LookalikeSeedCandidate[];
  writesEnabled: boolean;
}) {
  // Merged seed pool (DB + Meta, deduped by metaAudienceId).
  // Initialised from server-supplied DB seeds; Meta seeds are merged in on demand.
  const [seedPool, setSeedPool] = useState<LookalikeSeedCandidate[]>(initialDbSeeds);
  const [metaLoadState, setMetaLoadState] = useState<
    "idle" | "loading" | "loaded" | "error"
  >("idle");
  const [metaLoadError, setMetaLoadError] = useState<string | null>(null);

  // Selected seed Meta-audience IDs (keyed by metaAudienceId).
  const [selectedSeedIds, setSelectedSeedIds] = useState<Set<string>>(new Set());

  // Filter input + source-tab filter for the seed list.
  const [seedQuery, setSeedQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"all" | SeedSource>("all");

  // Step 2 — tier (single-select per Matas's spec).
  const [tier, setTier] = useState<LookalikeTier>(1);

  // Step 3 — country.
  const [country, setCountry] = useState<string>(DEFAULT_LOOKALIKE_COUNTRY);

  // Optional label override.
  const [labelOverride, setLabelOverride] = useState("");

  // Async state.
  const [phase, setPhase] = useState<Phase>("idle");
  const [preview, setPreview] = useState<LookalikePreview | null>(null);
  const [createResult, setCreateResult] = useState<CreateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedSeeds = useMemo(
    () => seedPool.filter((s) => selectedSeedIds.has(s.metaAudienceId)),
    [seedPool, selectedSeedIds],
  );

  const visibleSeeds = useMemo(() => {
    const q = seedQuery.trim().toLowerCase();
    return seedPool.filter((s) => {
      if (sourceFilter !== "all" && s.source !== sourceFilter) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.metaAudienceId.toLowerCase().includes(q)
      );
    });
  }, [seedPool, seedQuery, sourceFilter]);

  const toggleSeed = useCallback((metaAudienceId: string) => {
    setSelectedSeedIds((prev) => {
      const next = new Set(prev);
      if (next.has(metaAudienceId)) next.delete(metaAudienceId);
      else next.add(metaAudienceId);
      return next;
    });
    resetPreview(setPhase, setPreview);
  }, []);

  const handleLoadFromMeta = useCallback(async () => {
    setMetaLoadState("loading");
    setMetaLoadError(null);
    try {
      const res = await fetch(
        `/api/audiences/lookalike/meta-seeds?clientId=${encodeURIComponent(clientId)}`,
      );
      const json = (await res.json()) as
        | { ok: true; seeds: Array<{
            metaAudienceId: string;
            name: string;
            metaSubtype: string;
            approximateCount: number | null;
          }> }
        | { ok: false; error: string };
      if (!json.ok) {
        setMetaLoadError(json.error);
        setMetaLoadState("error");
        return;
      }
      setSeedPool((prev) => mergeSeedPools(prev, json.seeds));
      setMetaLoadState("loaded");
    } catch {
      setMetaLoadError("Network error fetching audiences from Meta.");
      setMetaLoadState("error");
    }
  }, [clientId]);

  const validationError = validateForm({ selectedSeeds, country });

  function buildRequestBody(withMeta: boolean) {
    return {
      clientId,
      labelOverride: labelOverride.trim() || null,
      seeds: selectedSeeds.map((s) => ({
        metaAudienceId: s.metaAudienceId,
        name: s.name,
        source: s.source,
        localAudienceId: s.localAudienceId ?? null,
        metaSubtype: s.metaSubtype ?? null,
        audienceSubtype: s.audienceSubtype ?? null,
        funnelStage: s.funnelStage ?? null,
        approximateCount: s.approximateCount ?? null,
      })),
      tier,
      country,
      ...(withMeta ? { createOnMeta: writesEnabled } : {}),
    };
  }

  async function handlePreview() {
    if (validationError) { setError(validationError); return; }
    setPhase("previewing");
    setError(null);
    setPreview(null);
    try {
      const res = await fetch("/api/audiences/lookalike/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildRequestBody(false)),
      });
      const json = (await res.json()) as
        | { ok: true; preview: LookalikePreview }
        | { ok: false; error: string };
      if (!json.ok) { setError(json.error); setPhase("idle"); return; }
      setPreview(json.preview);
      setPhase("previewed");
    } catch {
      setError("Preview request failed — check your connection and try again.");
      setPhase("idle");
    }
  }

  async function handleCreate() {
    setPhase("creating");
    setError(null);
    try {
      const res = await fetch("/api/audiences/lookalike/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildRequestBody(true)),
      });
      const json = (await res.json()) as CreateResponse | { ok: false; error: string };
      if (!json.ok) { setError(json.error); setPhase("previewed"); return; }
      setCreateResult(json);
      setPhase("done");
    } catch {
      setError("Create request failed — check your connection and try again.");
      setPhase("previewed");
    }
  }

  function handleReset() {
    setPhase("idle");
    setPreview(null);
    setCreateResult(null);
    setError(null);
  }

  // ── Done screen ──────────────────────────────────────────────────────────────

  if (phase === "done" && createResult) {
    const { successes, failures, draftIds } = createResult;
    const successCount = writesEnabled ? successes.length : draftIds.length;
    const failureCount = failures.length;

    return (
      <div className="space-y-6">
        <div className="rounded-md border border-border bg-card p-5">
          <p className="font-heading text-xl tracking-wide">
            {writesEnabled
              ? `${successCount} lookalike${successCount === 1 ? "" : "s"} created on Meta`
              : `${draftIds.length} draft${draftIds.length === 1 ? "" : "s"} saved`}
            {failureCount > 0 && `, ${failureCount} failed`}
          </p>
        </div>

        {writesEnabled && (
          <div className="space-y-2">
            {successes.map((s) => (
              <CellResultRow
                key={s.audienceId}
                name={s.name}
                status="success"
                detail={
                  s.metaAudienceId
                    ? `Meta ID: ${s.metaAudienceId} · seed: ${s.seedName}`
                    : "Saved (no Meta ID returned)"
                }
              />
            ))}
            {failures.map((f) => (
              <CellResultRow
                key={f.audienceId}
                name={f.name}
                status="failed"
                detail={`${f.seedName}: ${f.error}`}
              />
            ))}
          </div>
        )}

        {!writesEnabled && draftIds.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {draftIds.length} draft{draftIds.length === 1 ? "" : "s"} saved.
            Enable Meta writes to push them to Meta.
          </p>
        )}

        <div className="flex gap-3">
          <Link
            href={`/audiences/${clientId}`}
            className="inline-flex h-9 items-center justify-center rounded-md border border-border-strong px-4 text-sm font-medium hover:bg-card"
          >
            View in Audience Builder →
          </Link>
          <Button type="button" variant="outline" onClick={handleReset}>
            Run another lookalike batch
          </Button>
        </div>
      </div>
    );
  }

  // ── Creating screen ──────────────────────────────────────────────────────────

  if (phase === "creating" && preview) {
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-border bg-card p-4">
          <p className="font-heading text-lg tracking-wide">
            Creating {preview.cells.length} lookalike
            {preview.cells.length === 1 ? "" : "s"}…
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {writesEnabled
              ? "Saving drafts and writing to Meta — concurrency = 2."
              : "Saving drafts…"}
          </p>
        </div>
        <div className="space-y-1.5">
          {preview.cells.map((cell) => (
            <div
              key={cell.seedMetaAudienceId}
              className="flex items-center gap-3 rounded-md border border-border bg-card px-4 py-2.5 text-sm"
            >
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <span className="text-muted-foreground">{cell.name}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Idle / Previewed screen ──────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <div className="rounded-md border border-border bg-card p-5 space-y-5">
        {/* Step 1 — Seed audiences */}
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-heading text-lg tracking-wide">
              Step 1 — Seed audiences
            </h2>
            <span className="text-xs text-muted-foreground">
              {selectedSeeds.length} selected · {seedPool.length} total
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Each ticked seed becomes one lookalike. Local seeds (created by this
            tool) show below by default; click <strong>Load more from Meta</strong>
            {" "}to fetch manually-uploaded audiences (customer files, partner-shared lists).
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={seedQuery}
              onChange={(e) => setSeedQuery(e.target.value)}
              placeholder="Search by name or audience ID…"
              className="h-9 flex-1 min-w-[200px] rounded-md border border-border-strong bg-background px-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="flex rounded-md border border-border bg-background text-xs">
              {(["all", "db", "meta"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setSourceFilter(mode)}
                  className={`px-2.5 py-1.5 ${
                    sourceFilter === mode
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {mode === "all" ? "All" : mode === "db" ? "Local" : "Meta"}
                </button>
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleLoadFromMeta()}
              disabled={metaLoadState === "loading"}
            >
              {metaLoadState === "loading"
                ? "Loading…"
                : metaLoadState === "loaded"
                  ? "Reload from Meta"
                  : "Load more from Meta"}
            </Button>
          </div>

          {metaLoadError && (
            <p className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
              {metaLoadError}
            </p>
          )}

          <div className="mt-3 max-h-96 overflow-y-auto rounded-md border border-border bg-background">
            {visibleSeeds.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground text-center">
                {seedPool.length === 0
                  ? "No ready audiences for this client yet. Create one first, or load from Meta to use manually-uploaded seeds."
                  : "No matches for your filter."}
              </p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {visibleSeeds.map((seed) => {
                  const checked = selectedSeedIds.has(seed.metaAudienceId);
                  return (
                    <li key={seed.metaAudienceId}>
                      <label
                        className={`flex cursor-pointer items-start gap-3 p-3 ${
                          checked ? "bg-primary/5" : "hover:bg-card"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSeed(seed.metaAudienceId)}
                          className="mt-0.5"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium truncate">{seed.name}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground truncate">
                            <code className="text-[11px]">{seed.metaAudienceId}</code>
                            {" · "}
                            <SeedSourceBadge source={seed.source} />
                            {seed.audienceSubtype && (
                              <> · {seed.audienceSubtype.replace(/_/g, " ")}</>
                            )}
                            {seed.metaSubtype && !seed.audienceSubtype && (
                              <> · {seed.metaSubtype}</>
                            )}
                            {typeof seed.approximateCount === "number" && (
                              <> · ~{formatCount(seed.approximateCount)}</>
                            )}
                          </p>
                        </div>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* Step 2 — Tier */}
        <div>
          <h2 className="font-heading text-lg tracking-wide">Step 2 — Tier</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Single tier per run. 1% is most similar to the seed (narrower
            audience); 3% is broader.
          </p>
          <div className="mt-3 flex gap-2">
            {LOOKALIKE_TIERS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setTier(t);
                  resetPreview(setPhase, setPreview);
                }}
                className={`rounded-md border px-4 py-2 text-sm font-medium transition-colors ${
                  tier === t
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background text-muted-foreground hover:text-foreground"
                }`}
              >
                {t}%
              </button>
            ))}
          </div>
        </div>

        {/* Step 3 — Country */}
        <div>
          <h2 className="font-heading text-lg tracking-wide">Step 3 — Country</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Country where Meta will find the lookalike segment. Defaults to GB.
          </p>
          <div className="mt-3 max-w-xs">
            <select
              value={country}
              onChange={(e) => {
                setCountry(e.target.value);
                resetPreview(setPhase, setPreview);
              }}
              className="h-9 w-full rounded-md border border-border-strong bg-background px-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {LOOKALIKE_COUNTRY_OPTIONS.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} ({c.code})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Optional label override */}
        <div>
          <label
            htmlFor="lookalike-label"
            className="flex flex-col gap-1.5 text-sm font-medium"
          >
            Name prefix (optional)
            <input
              id="lookalike-label"
              type="text"
              value={labelOverride}
              placeholder={clientSlug || clientName}
              onChange={(e) => {
                setLabelOverride(e.target.value);
                resetPreview(setPhase, setPreview);
              }}
              className="h-9 rounded-md border border-border-strong bg-background px-3 text-sm font-normal text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </label>
          <p className="mt-1 text-xs text-muted-foreground">
            Defaults to the client slug. Used as the bracketed prefix, e.g.{" "}
            <code>[innervisions] {`<seed>`} LAL {tier}% {country}</code>.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            type="button"
            onClick={() => void handlePreview()}
            disabled={phase === "previewing" || validationError !== null}
          >
            {phase === "previewing" ? "Loading preview…" : "Preview lookalikes"}
          </Button>
          {phase === "previewed" && preview && (
            <span className="text-sm text-muted-foreground">
              {preview.cells.length} lookalike{preview.cells.length === 1 ? "" : "s"} ready
            </span>
          )}
        </div>

        {(error || validationError) && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error ?? validationError}
          </p>
        )}
      </div>

      {phase === "previewed" && preview && (
        <PreviewPanel
          preview={preview}
          writesEnabled={writesEnabled}
          onCreate={() => void handleCreate()}
        />
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PreviewPanel({
  preview,
  writesEnabled,
  onCreate,
}: {
  preview: LookalikePreview;
  writesEnabled: boolean;
  onCreate: () => void;
}) {
  return (
    <div className="space-y-4">
      <h2 className="font-heading text-lg tracking-wide">
        Preview — {preview.cells.length} lookalike
        {preview.cells.length === 1 ? "" : "s"}
      </h2>
      <div className="rounded-md border border-border bg-card p-4 text-sm space-y-1">
        <p>
          <strong>Tier:</strong> {preview.tier}% (ratio {preview.ratio}) ·{" "}
          <strong>Country:</strong> {preview.country} ·{" "}
          <strong>Prefix:</strong> <code>[{preview.labelPrefix}]</code>
        </p>
        <p className="text-xs text-muted-foreground">
          Each row = one lookalike audience created on Meta. Seeds with fewer
          than 100 members will fail individually with a clear error message.
        </p>
      </div>

      <div className="space-y-1.5">
        {preview.cells.map((cell) => (
          <div
            key={cell.seedMetaAudienceId}
            className="rounded-md border border-border bg-card px-3 py-2 text-xs"
          >
            <p className="font-medium truncate">{cell.name}</p>
            <p className="mt-0.5 text-muted-foreground truncate">
              seed: {cell.seedName} ·{" "}
              <code className="text-[11px]">{cell.seedMetaAudienceId}</code>
            </p>
          </div>
        ))}
      </div>

      <div className="rounded-md border border-border bg-card p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium">
            Create {preview.cells.length} lookalike
            {preview.cells.length === 1 ? "" : "s"}
          </p>
          <p className="text-xs text-muted-foreground">
            {writesEnabled
              ? "Will save as drafts and immediately write to Meta (concurrency = 2)."
              : "Will save as drafts (Meta writes are disabled)."}
          </p>
        </div>
        <Button type="button" onClick={onCreate}>
          Create {preview.cells.length} lookalike{preview.cells.length === 1 ? "" : "s"}
        </Button>
      </div>
    </div>
  );
}

function SeedSourceBadge({ source }: { source: SeedSource }) {
  if (source === "db") {
    return (
      <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
        local
      </span>
    );
  }
  return (
    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
      meta
    </span>
  );
}

function CellResultRow({
  name,
  status,
  detail,
}: {
  name: string;
  status: "success" | "failed";
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
        <p className="text-xs text-muted-foreground truncate">{detail}</p>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Merge a freshly-fetched Meta seed list into the existing pool. Dedup by
 * `metaAudienceId` — DB rows win because they carry richer metadata (local
 * audience id, our funnel stage, our internal subtype label). Meta rows
 * augment the pool with audiences the DB doesn't know about.
 */
function mergeSeedPools(
  existing: LookalikeSeedCandidate[],
  metaSeeds: Array<{
    metaAudienceId: string;
    name: string;
    metaSubtype: string;
    approximateCount: number | null;
  }>,
): LookalikeSeedCandidate[] {
  const out = [...existing];
  const have = new Set(out.map((s) => s.metaAudienceId));
  for (const m of metaSeeds) {
    if (have.has(m.metaAudienceId)) continue;
    have.add(m.metaAudienceId);
    out.push({
      metaAudienceId: m.metaAudienceId,
      name: m.name,
      source: "meta",
      metaSubtype: m.metaSubtype,
      approximateCount: m.approximateCount,
      localAudienceId: null,
      audienceSubtype: null,
      funnelStage: null,
    });
  }
  return out;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function validateForm(args: {
  selectedSeeds: LookalikeSeedCandidate[];
  country: string;
}): string | null {
  if (args.selectedSeeds.length === 0) return "Pick at least one seed audience.";
  if (!/^[A-Z]{2}$/.test(args.country)) {
    return "Pick a valid country code (ISO-2, e.g. GB).";
  }
  return null;
}

/**
 * Reset the preview pane back to its idle state. Called from each input's
 * onChange so a stale preview never lingers when the user changes seeds /
 * tier / country / prefix. Same pattern as bulk-website-form.
 */
function resetPreview(
  setPhase: (p: Phase) => void,
  setPreview: (p: LookalikePreview | null) => void,
) {
  setPhase("idle");
  setPreview(null);
}
