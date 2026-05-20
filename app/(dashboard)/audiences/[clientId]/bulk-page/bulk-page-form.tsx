"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { SourcePicker, type SourceSelection } from "@/components/audiences/source-picker";
import { Button } from "@/components/ui/button";
import {
  BULK_PAGE_SUBTYPES,
  BULK_PAGE_SUBTYPE_SHORT_LABELS,
  DEFAULT_PAGE_RETENTIONS,
  clampRetentionDays,
  isFollowersSubtype,
  isIgSubtype,
  type BulkPagePreview,
  type BulkPageSubtype,
} from "@/lib/audiences/bulk-page-types";

// ── Constants ─────────────────────────────────────────────────────────────────

const FB_SUBTYPES: readonly BulkPageSubtype[] = [
  "page_engagement_fb",
  "page_followers_fb",
];
const IG_SUBTYPES: readonly BulkPageSubtype[] = [
  "page_engagement_ig",
  "page_followers_ig",
];

const DEFAULT_SUBTYPES: ReadonlySet<BulkPageSubtype> = new Set([
  "page_engagement_fb",
  "page_engagement_ig",
  "page_followers_fb",
  "page_followers_ig",
]);

type Phase = "idle" | "previewing" | "previewed" | "creating" | "done";

interface CellResult {
  audienceId: string;
  metaAudienceId: string | null;
  name: string;
  subtype: BulkPageSubtype;
  retentionDays: number;
  willSplit: boolean;
  partCount: number;
}

interface CellFailure {
  audienceId: string;
  error: string;
  name: string;
  subtype: BulkPageSubtype;
  retentionDays: number;
  willSplit: boolean;
  partCount: number;
}

interface CreateResponse {
  ok: true;
  preview: BulkPagePreview;
  draftIds: string[];
  successes: CellResult[];
  failures: CellFailure[];
}

interface SourceSummary {
  id: string;
  name: string;
  slug?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function BulkPageAudiencesForm({
  clientId,
  clientName,
  clientSlug,
  writesEnabled,
}: {
  clientId: string;
  clientName: string;
  clientSlug: string | null;
  writesEnabled: boolean;
}) {
  // Step 1 — source selection (FB pages + IG accounts, picked independently).
  const [fbSource, setFbSource] = useState<SourceSelection>({});
  const [igSource, setIgSource] = useState<SourceSelection>({});

  // Step 2 — subtypes selected.
  const [selectedSubtypes, setSelectedSubtypes] =
    useState<Set<BulkPageSubtype>>(new Set(DEFAULT_SUBTYPES));

  // Step 3 — retention days selected (defaults + custom).
  const [selectedRetentions, setSelectedRetentions] = useState<Set<number>>(
    new Set<number>(DEFAULT_PAGE_RETENTIONS),
  );
  const [customRetentions, setCustomRetentions] = useState<number[]>([]);

  // Optional name-prefix override (free-form, defaults to client slug).
  const [labelOverride, setLabelOverride] = useState("");

  // Async state.
  const [phase, setPhase] = useState<Phase>("idle");
  const [preview, setPreview] = useState<BulkPagePreview | null>(null);
  const [createResult, setCreateResult] = useState<CreateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggleSubtype = useCallback((subtype: BulkPageSubtype) => {
    setSelectedSubtypes((prev) => {
      const next = new Set(prev);
      if (next.has(subtype)) next.delete(subtype);
      else next.add(subtype);
      return next;
    });
    resetPreviewIfNeeded(setPhase, setPreview);
  }, []);

  const toggleRetention = useCallback((days: number) => {
    setSelectedRetentions((prev) => {
      const next = new Set(prev);
      if (next.has(days)) next.delete(days);
      else next.add(days);
      return next;
    });
    resetPreviewIfNeeded(setPhase, setPreview);
  }, []);

  const addCustomRetention = useCallback(() => {
    setCustomRetentions((prev) => [...prev, 90]);
    resetPreviewIfNeeded(setPhase, setPreview);
  }, []);

  const updateCustomRetention = useCallback((idx: number, value: number) => {
    setCustomRetentions((prev) =>
      prev.map((v, i) => (i === idx ? clampRetentionDays(value) : v)),
    );
    resetPreviewIfNeeded(setPhase, setPreview);
  }, []);

  const removeCustomRetention = useCallback((idx: number) => {
    setCustomRetentions((prev) => prev.filter((_, i) => i !== idx));
    resetPreviewIfNeeded(setPhase, setPreview);
  }, []);

  const fbSummaries: SourceSummary[] = useMemo(
    () => summariesFromSource(fbSource),
    [fbSource],
  );
  const igSummaries: SourceSummary[] = useMemo(
    () => summariesFromSource(igSource),
    [igSource],
  );

  const fbPageIds = fbSource.pageIds ?? [];
  const igAccountIds = igSource.pageIds ?? [];

  const needsFb = anyFbSubtypeSelected(selectedSubtypes);
  const needsIg = anyIgSubtypeSelected(selectedSubtypes);

  const totalRetentions = useMemo(() => {
    const merged = new Set<number>(selectedRetentions);
    for (const r of customRetentions) merged.add(clampRetentionDays(r));
    return Array.from(merged).sort((a, b) => a - b);
  }, [selectedRetentions, customRetentions]);

  const allRetentions = totalRetentions;
  const subtypesArr = Array.from(selectedSubtypes);
  const validationError = validateForm({
    subtypes: subtypesArr,
    retentions: allRetentions,
    needsFb,
    needsIg,
    fbPageIds,
    igAccountIds,
  });

  async function handlePreview() {
    if (validationError) {
      setError(validationError);
      return;
    }
    setPhase("previewing");
    setError(null);
    setPreview(null);
    try {
      const res = await fetch("/api/audiences/bulk-page/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          labelOverride: labelOverride.trim() || null,
          subtypes: subtypesArr,
          retentions: allRetentions,
          fbPageIds,
          fbSummaries,
          igAccountIds,
          igSummaries,
        }),
      });
      const json = (await res.json()) as
        | { ok: true; preview: BulkPagePreview }
        | { ok: false; error: string };
      if (!json.ok) {
        setError(json.error);
        setPhase("idle");
        return;
      }
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
      const res = await fetch("/api/audiences/bulk-page/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          labelOverride: labelOverride.trim() || null,
          subtypes: subtypesArr,
          retentions: allRetentions,
          fbPageIds,
          fbSummaries,
          igAccountIds,
          igSummaries,
          createOnMeta: writesEnabled,
        }),
      });
      const json = (await res.json()) as CreateResponse | { ok: false; error: string };
      if (!json.ok) {
        setError(json.error);
        setPhase("previewed");
        return;
      }
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

  // ── Done screen ────────────────────────────────────────────────────────────

  if (phase === "done" && createResult) {
    const { successes, failures, draftIds, preview: donePreview } = createResult;
    const successCount = writesEnabled ? successes.length : draftIds.length;
    const failureCount = failures.length;

    return (
      <div className="space-y-6">
        <div className="rounded-md border border-border bg-card p-5">
          <p className="font-heading text-xl tracking-wide">
            {writesEnabled
              ? `${successCount} audience${successCount === 1 ? "" : "s"} created on Meta`
              : `${draftIds.length} draft${draftIds.length === 1 ? "" : "s"} saved`}
            {failureCount > 0 && `, ${failureCount} failed`}
          </p>
          {donePreview.anySplit && (
            <p className="mt-1 text-sm text-muted-foreground">
              {splitNote(donePreview)}
            </p>
          )}
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
                    ? `Meta ID: ${s.metaAudienceId}${s.willSplit ? ` · split into ${s.partCount} parts` : ""}`
                    : "Saved (no Meta ID returned)"
                }
              />
            ))}
            {failures.map((f) => (
              <CellResultRow
                key={f.audienceId}
                name={f.name}
                status="failed"
                detail={f.error}
              />
            ))}
          </div>
        )}

        {!writesEnabled && draftIds.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {draftIds.length} draft{draftIds.length === 1 ? "" : "s"} saved.
            Enable Meta writes to create them on Meta.
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
            Run another matrix
          </Button>
        </div>
      </div>
    );
  }

  // ── Creating screen ────────────────────────────────────────────────────────

  if (phase === "creating" && preview) {
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-border bg-card p-4">
          <p className="font-heading text-lg tracking-wide">
            Creating {preview.cells.length} audience
            {preview.cells.length === 1 ? "" : "s"}…
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {writesEnabled
              ? "Saving drafts and writing to Meta — sequential cell processing keeps fan-out safe."
              : "Saving drafts…"}
          </p>
        </div>
        <div className="space-y-1.5">
          {preview.cells.map((cell) => (
            <div
              key={`${cell.subtype}:${cell.retentionDays}`}
              className="flex items-center gap-3 rounded-md border border-border bg-card px-4 py-2.5 text-sm"
            >
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <span className="text-muted-foreground">{cell.name}</span>
              {cell.willSplit && (
                <span className="ml-auto rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-300">
                  split into {cell.partCount}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Idle / Previewed screen ────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <div className="rounded-md border border-border bg-card p-5 space-y-5">
        {/* Step 1 — source */}
        <div>
          <h2 className="font-heading text-lg tracking-wide">
            Step 1 — Pick the page / IG source set
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Tick the FB pages and IG accounts you want the matrix to share.
            FB and IG are picked independently — IG uses Instagram Business
            Account IDs and bypasses the FB-page access prefilter.
          </p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="rounded-md border border-border bg-background p-3">
              <SourcePicker
                clientId={clientId}
                subtype="page_engagement_fb"
                value={fbSource}
                onChange={(next) => {
                  setFbSource(next);
                  resetPreviewIfNeeded(setPhase, setPreview);
                }}
                sourcePickerInstanceId="bulk-page-fb"
              />
            </div>
            <div className="rounded-md border border-border bg-background p-3">
              <SourcePicker
                clientId={clientId}
                subtype="page_engagement_ig"
                value={igSource}
                onChange={(next) => {
                  setIgSource(next);
                  resetPreviewIfNeeded(setPhase, setPreview);
                }}
                sourcePickerInstanceId="bulk-page-ig"
              />
            </div>
          </div>
        </div>

        {/* Step 2 — subtypes */}
        <div>
          <h2 className="font-heading text-lg tracking-wide">
            Step 2 — Subtypes
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Each ticked subtype becomes one audience per ticked retention.
            Followers ignore retention on Meta — Meta forces always-live for
            those rules — but the cell name still reflects the requested days.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {BULK_PAGE_SUBTYPES.map((subtype) => {
              const checked = selectedSubtypes.has(subtype);
              const ig = isIgSubtype(subtype);
              const followers = isFollowersSubtype(subtype);
              const needsMissing =
                checked &&
                ((ig && igAccountIds.length === 0) ||
                  (!ig && fbPageIds.length === 0));
              return (
                <label
                  key={subtype}
                  className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm ${
                    checked
                      ? "border-primary bg-primary/10"
                      : "border-border bg-background"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleSubtype(subtype)}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="font-medium">
                      {BULK_PAGE_SUBTYPE_SHORT_LABELS[subtype]}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {ig ? "Instagram source" : "Facebook source"} ·{" "}
                      {followers ? "always-live" : "windowed"}
                    </p>
                    {needsMissing && (
                      <p className="mt-1 text-xs text-destructive">
                        Pick {ig ? "an IG account" : "a Facebook page"} in
                        Step&nbsp;1.
                      </p>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        {/* Step 3 — retentions */}
        <div>
          <h2 className="font-heading text-lg tracking-wide">
            Step 3 — Retention windows (days)
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Tick standard windows or add custom day counts (1–365).
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-4">
            {DEFAULT_PAGE_RETENTIONS.map((days) => {
              const checked = selectedRetentions.has(days);
              return (
                <label
                  key={days}
                  className={`flex cursor-pointer items-center gap-3 rounded-md border p-3 text-sm ${
                    checked
                      ? "border-primary bg-primary/10"
                      : "border-border bg-background"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleRetention(days)}
                  />
                  <span className="font-medium">{days}d</span>
                </label>
              );
            })}
          </div>

          <div className="mt-4 space-y-2">
            {customRetentions.map((days, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5 text-sm">
                  <label className="text-xs text-muted-foreground whitespace-nowrap">
                    Retention
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    className="w-16 bg-transparent text-sm outline-none"
                    value={days}
                    onChange={(e) =>
                      updateCustomRetention(idx, Number(e.target.value) || 1)
                    }
                  />
                  <span className="text-xs text-muted-foreground">d</span>
                </div>
                <button
                  type="button"
                  onClick={() => removeCustomRetention(idx)}
                  className="rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:text-destructive"
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addCustomRetention}
              className="text-xs text-primary hover:underline"
            >
              + Add custom retention
            </button>
          </div>
        </div>

        {/* Optional label override */}
        <div>
          <label
            htmlFor="bulk-page-label"
            className="flex flex-col gap-1.5 text-sm font-medium"
          >
            Name prefix (optional)
            <input
              id="bulk-page-label"
              type="text"
              value={labelOverride}
              placeholder={clientSlug || clientName}
              onChange={(e) => {
                setLabelOverride(e.target.value);
                resetPreviewIfNeeded(setPhase, setPreview);
              }}
              className="h-9 rounded-md border border-border-strong bg-background px-3 text-sm font-normal text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </label>
          <p className="mt-1 text-xs text-muted-foreground">
            Defaults to the client slug. Used as the bracketed prefix on every
            generated audience name, e.g. <code>[innervisions] FB page engagement 180d</code>.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            type="button"
            onClick={() => void handlePreview()}
            disabled={phase === "previewing" || validationError !== null}
          >
            {phase === "previewing" ? "Loading preview…" : "Preview matrix"}
          </Button>
          {phase === "previewed" && preview && (
            <span className="text-sm text-muted-foreground">
              {preview.cells.length} cell{preview.cells.length === 1 ? "" : "s"} ready
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
          fbPageIds={fbPageIds}
          igAccountIds={igAccountIds}
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
  fbPageIds,
  igAccountIds,
  writesEnabled,
  onCreate,
}: {
  preview: BulkPagePreview;
  fbPageIds: string[];
  igAccountIds: string[];
  writesEnabled: boolean;
  onCreate: () => void;
}) {
  const cellsBySubtype = useMemo(() => {
    const map = new Map<BulkPageSubtype, BulkPagePreview["cells"]>();
    for (const cell of preview.cells) {
      const list = map.get(cell.subtype) ?? [];
      list.push(cell);
      map.set(cell.subtype, list);
    }
    return map;
  }, [preview.cells]);

  return (
    <div className="space-y-4">
      <h2 className="font-heading text-lg tracking-wide">
        Preview — {preview.cells.length} cell{preview.cells.length === 1 ? "" : "s"}
      </h2>
      <div className="rounded-md border border-border bg-card p-4 text-sm">
        <p>
          <strong>FB pages:</strong> {fbPageIds.length} ·{" "}
          <strong>IG accounts:</strong> {igAccountIds.length} ·{" "}
          <strong>Prefix:</strong> <code>[{preview.labelPrefix}]</code>
        </p>
        {preview.anySplit && (
          <p className="mt-2 text-amber-700 dark:text-amber-300">
            {splitNote(preview)}
          </p>
        )}
      </div>

      <div className="space-y-3">
        {Array.from(cellsBySubtype.entries()).map(([subtype, cells]) => (
          <div
            key={subtype}
            className="rounded-md border border-border bg-card p-4"
          >
            <p className="font-medium">
              {BULK_PAGE_SUBTYPE_SHORT_LABELS[subtype]}
              {cells[0]?.willSplit && (
                <span className="ml-2 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-300">
                  splits into {cells[0]?.partCount} parts each
                </span>
              )}
            </p>
            <div className="mt-2 grid gap-1.5 sm:grid-cols-2 md:grid-cols-3">
              {cells.map((cell) => (
                <div
                  key={`${cell.subtype}:${cell.retentionDays}`}
                  className="rounded-md border border-border bg-background px-3 py-2 text-xs"
                >
                  <p className="font-medium truncate">{cell.name}</p>
                  <p className="mt-0.5 text-muted-foreground">
                    {cell.retentionDays}d · {cell.funnelStage.replace(/_/g, " ")}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-md border border-border bg-card p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium">
            Create {preview.cells.length} audience
            {preview.cells.length === 1 ? "" : "s"}
          </p>
          <p className="text-xs text-muted-foreground">
            {writesEnabled
              ? "Will save as drafts and immediately write to Meta (cell concurrency = 2)."
              : "Will save as drafts (Meta writes are disabled)."}
          </p>
        </div>
        <Button type="button" onClick={onCreate}>
          Create {preview.cells.length} audience{preview.cells.length === 1 ? "" : "s"}
        </Button>
      </div>
    </div>
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

function summariesFromSource(source: SourceSelection): SourceSummary[] {
  if (source.pageSummaries?.length) {
    return source.pageSummaries.map((s) => ({
      id: s.id,
      name: s.name,
      slug: s.slug,
    }));
  }
  if (source.sourceId) {
    return [
      {
        id: source.sourceId,
        name: source.sourceName ?? source.sourceId,
        slug: source.pageSlug,
      },
    ];
  }
  return [];
}

function anyFbSubtypeSelected(set: Set<BulkPageSubtype>): boolean {
  return FB_SUBTYPES.some((s) => set.has(s));
}

function anyIgSubtypeSelected(set: Set<BulkPageSubtype>): boolean {
  return IG_SUBTYPES.some((s) => set.has(s));
}

function validateForm(args: {
  subtypes: BulkPageSubtype[];
  retentions: number[];
  needsFb: boolean;
  needsIg: boolean;
  fbPageIds: string[];
  igAccountIds: string[];
}): string | null {
  if (args.subtypes.length === 0) return "Pick at least one subtype.";
  if (args.retentions.length === 0) {
    return "Pick at least one retention window.";
  }
  if (args.needsFb && args.fbPageIds.length === 0) {
    return "Pick at least one Facebook page for FB subtypes.";
  }
  if (args.needsIg && args.igAccountIds.length === 0) {
    return "Pick at least one Instagram account for IG subtypes.";
  }
  return null;
}

function splitNote(preview: BulkPagePreview): string {
  const parts = preview.cells.find((c) => c.willSplit)?.partCount ?? 1;
  return (
    `One or more subtypes exceed Meta's 5-source cap — each affected cell ` +
    `auto-splits into ${parts} sibling audiences (combined back with OR at ` +
    `ad-set targeting).`
  );
}

function resetPreviewIfNeeded(
  setPhase: (phase: Phase) => void,
  setPreview: (preview: BulkPagePreview | null) => void,
) {
  setPhase("idle");
  setPreview(null);
}
