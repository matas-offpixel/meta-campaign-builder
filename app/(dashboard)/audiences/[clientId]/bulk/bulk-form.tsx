"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import {
  BULK_FUNNEL_CONFIG,
  VALID_VIDEO_THRESHOLDS,
  type BulkCustomStage,
  type BulkFunnelStage,
  type BulkPreviewRow,
} from "@/lib/audiences/bulk-types";
import type { EventCodePrefixOption } from "@/lib/audiences/event-code-prefix-scanner";

// ── Constants ─────────────────────────────────────────────────────────────────

const ALL_STAGES: BulkFunnelStage[] = [
  "mid_top",
  "mid",
  "mid_bottom",
  "bottom",
];

// ── Types ─────────────────────────────────────────────────────────────────────

type Phase = "idle" | "previewing" | "previewed" | "creating" | "done";

interface WriteResult {
  successes: Array<{ audienceId: string; metaAudienceId: string; name: string }>;
  failures: Array<{ audienceId: string; error: string; name: string }>;
}

interface CreateResult {
  draftIds: string[];
  skippedEvents: Array<{ eventCode: string; reason: string }>;
  writeResult: WriteResult | null;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function BulkVideoForm({
  clientId,
  clientName,
  prefixOptions,
  writesEnabled,
}: {
  clientId: string;
  clientName: string;
  prefixOptions: EventCodePrefixOption[];
  writesEnabled: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [selectedPrefix, setSelectedPrefix] = useState(
    prefixOptions[0]?.prefix ?? "",
  );
  const [selectedStages, setSelectedStages] = useState<Set<BulkFunnelStage>>(
    new Set(ALL_STAGES),
  );
  const [customStages, setCustomStages] = useState<BulkCustomStage[]>([]);
  const [previewRows, setPreviewRows] = useState<BulkPreviewRow[]>([]);
  const [createResult, setCreateResult] = useState<CreateResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggleStage = useCallback((stage: BulkFunnelStage) => {
    setSelectedStages((prev) => {
      const next = new Set(prev);
      if (next.has(stage)) {
        next.delete(stage);
      } else {
        next.add(stage);
      }
      return next;
    });
  }, []);

  const addCustomStage = useCallback(() => {
    setCustomStages((prev) => [...prev, { threshold: 95, retentionDays: 60 }]);
  }, []);

  const removeCustomStage = useCallback((idx: number) => {
    setCustomStages((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const updateCustomStage = useCallback(
    (idx: number, patch: Partial<BulkCustomStage>) => {
      setCustomStages((prev) =>
        prev.map((cs, i) => (i === idx ? { ...cs, ...patch } : cs)),
      );
    },
    [],
  );

  const hasAnyStage = selectedStages.size > 0 || customStages.length > 0;

  const totalAudiences = previewRows.reduce(
    (sum, r) => sum + (r.skipped ? 0 : r.audiences.length),
    0,
  );

  async function handlePreview() {
    if (!selectedPrefix || !hasAnyStage) return;
    setPhase("previewing");
    setError(null);
    setPreviewRows([]);

    try {
      const res = await fetch("/api/audiences/bulk/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          eventCodePrefix: selectedPrefix,
          funnelStages: Array.from(selectedStages),
          customStages,
        }),
      });
      const json = (await res.json()) as
        | { ok: true; rows: BulkPreviewRow[]; totalAudiences: number }
        | { ok: false; error: string };
      if (!json.ok) {
        setError(json.error);
        setPhase("idle");
        return;
      }
      setPreviewRows(json.rows);
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
      const res = await fetch("/api/audiences/bulk/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          eventCodePrefix: selectedPrefix,
          funnelStages: Array.from(selectedStages),
          customStages,
          createOnMeta: writesEnabled,
        }),
      });
      const json = (await res.json()) as
        | { ok: true } & CreateResult
        | { ok: false; error: string };
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
    setPreviewRows([]);
    setCreateResult(null);
    setError(null);
    setCustomStages([]);
  }

  if (prefixOptions.length === 0) {
    return (
      <div className="rounded-md border border-border bg-card p-8 text-center">
        <p className="font-heading text-xl tracking-wide">No event codes found</p>
        <p className="mt-2 text-sm text-muted-foreground">
          {clientName} has no events with structured event codes (e.g. [WC26-MANCHESTER]).
          Add events with event codes first.
        </p>
        <div className="mt-4">
          <Link
            href={`/audiences/${clientId}`}
            className="text-sm text-primary hover:underline"
          >
            Back to audiences
          </Link>
        </div>
      </div>
    );
  }

  // ── Done screen ────────────────────────────────────────────────────────────

  if (phase === "done" && createResult) {
    const { draftIds, skippedEvents, writeResult } = createResult;
    const successCount = writeResult?.successes.length ?? draftIds.length;
    const failureCount = writeResult?.failures.length ?? 0;

    return (
      <div className="space-y-6">
        <div className="rounded-md border border-border bg-card p-5">
          <p className="font-heading text-xl tracking-wide">
            {writesEnabled
              ? `${successCount} audience${successCount === 1 ? "" : "s"} created on Meta`
              : `${draftIds.length} draft${draftIds.length === 1 ? "" : "s"} saved`}
            {failureCount > 0 && `, ${failureCount} failed`}
          </p>
          {skippedEvents.length > 0 && (
            <p className="mt-1 text-sm text-muted-foreground">
              {skippedEvents.length} event{skippedEvents.length === 1 ? "" : "s"} skipped
            </p>
          )}
        </div>

        {writeResult && (
          <div className="space-y-2">
            {writeResult.successes.map((s) => (
              <AudienceResultRow
                key={s.audienceId}
                name={s.name}
                status="success"
                detail={`Meta ID: ${s.metaAudienceId}`}
              />
            ))}
            {writeResult.failures.map((f) => (
              <AudienceResultRow
                key={f.audienceId}
                name={f.name}
                status="failed"
                detail={f.error}
              />
            ))}
          </div>
        )}

        {!writeResult && draftIds.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {draftIds.length} draft{draftIds.length === 1 ? "" : "s"} saved. Enable Meta writes to create them on Meta.
          </p>
        )}

        {skippedEvents.length > 0 && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-4 space-y-1">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
              Skipped events
            </p>
            {skippedEvents.map((e) => (
              <p key={e.eventCode} className="text-xs text-amber-700 dark:text-amber-300">
                <span className="font-mono">{e.eventCode}</span> — {e.reason}
              </p>
            ))}
          </div>
        )}

        <div className="flex gap-3">
          <Link
            href={`/audiences/${clientId}`}
            className="inline-flex h-9 items-center justify-center rounded-md border border-border-strong px-4 text-sm font-medium hover:bg-card"
          >
            View in Audience Builder →
          </Link>
          <Button type="button" variant="outline" onClick={handleReset}>
            Run another batch
          </Button>
        </div>
      </div>
    );
  }

  // ── Creating screen ────────────────────────────────────────────────────────

  if (phase === "creating") {
    const allAudiences = previewRows
      .filter((r) => !r.skipped)
      .flatMap((r) => r.audiences);

    return (
      <div className="space-y-4">
        <div className="rounded-md border border-border bg-card p-4">
          <p className="font-heading text-lg tracking-wide">
            Creating {allAudiences.length} audience{allAudiences.length === 1 ? "" : "s"}…
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {writesEnabled ? "Saving drafts and writing to Meta…" : "Saving drafts…"}
          </p>
        </div>
        <div className="space-y-1.5">
          {allAudiences.map((a) => (
            <div
              key={a.name}
              className="flex items-center gap-3 rounded-md border border-border bg-card px-4 py-2.5 text-sm"
            >
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <span className="text-muted-foreground">{a.name}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Preview results ────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Step 1 + 2 */}
      <div className="rounded-md border border-border bg-card p-5 space-y-5">
        <div>
          <h2 className="font-heading text-lg tracking-wide">
            Step 1 — Pick event-code prefix
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Select the campaign group you want to build audiences for.
          </p>
          <div className="mt-3 max-w-xs">
            <Select
              id="bulk-prefix"
              label=""
              value={selectedPrefix}
              onChange={(e) => {
                setSelectedPrefix(e.target.value);
                if (phase === "previewed") {
                  setPhase("idle");
                  setPreviewRows([]);
                }
              }}
              options={prefixOptions.map((opt) => ({
                value: opt.prefix,
                label: `${opt.prefix} — ${opt.eventCount} event${opt.eventCount === 1 ? "" : "s"}`,
              }))}
            />
          </div>
        </div>

        <div>
          <h2 className="font-heading text-lg tracking-wide">
            Step 2 — Funnel stages
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Select preset funnel stages and/or add custom (threshold, retention) pairs.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-4">
            {ALL_STAGES.map((stage) => {
              const cfg = BULK_FUNNEL_CONFIG[stage];
              const checked = selectedStages.has(stage);
              return (
                <label
                  key={stage}
                  className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm ${
                    checked
                      ? "border-primary bg-primary/10"
                      : "border-border bg-background"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleStage(stage)}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="font-medium">{cfg.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {cfg.threshold}% VV · {cfg.retentionDays}d
                    </p>
                  </div>
                </label>
              );
            })}
          </div>

          {/* Custom stages */}
          <div className="mt-4 space-y-2">
            {customStages.map((cs, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5 text-sm">
                  <label className="text-xs text-muted-foreground whitespace-nowrap">Threshold</label>
                  <select
                    className="bg-transparent text-sm outline-none"
                    value={cs.threshold}
                    onChange={(e) =>
                      updateCustomStage(idx, {
                        threshold: Number(e.target.value) as BulkCustomStage["threshold"],
                      })
                    }
                  >
                    {VALID_VIDEO_THRESHOLDS.map((t) => (
                      <option key={t} value={t}>{t}%</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5 text-sm">
                  <label className="text-xs text-muted-foreground whitespace-nowrap">Retention</label>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    className="w-16 bg-transparent text-sm outline-none"
                    value={cs.retentionDays}
                    onChange={(e) =>
                      updateCustomStage(idx, {
                        retentionDays: Math.max(1, Math.min(365, Number(e.target.value) || 1)),
                      })
                    }
                  />
                  <span className="text-xs text-muted-foreground">d</span>
                </div>
                <button
                  type="button"
                  onClick={() => removeCustomStage(idx)}
                  className="rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:text-destructive"
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addCustomStage}
              className="text-xs text-primary hover:underline"
            >
              + Add custom stage
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button
            type="button"
            onClick={() => void handlePreview()}
            disabled={phase === "previewing" || !hasAnyStage || !selectedPrefix}
          >
            {phase === "previewing" ? "Loading preview…" : "Step 3 — Preview"}
          </Button>
          {phase === "previewed" && (
            <span className="text-sm text-muted-foreground">
              {totalAudiences} audience{totalAudiences === 1 ? "" : "s"} ready
            </span>
          )}
        </div>

        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </p>
        )}
      </div>

      {/* Preview table */}
      {phase === "previewed" && previewRows.length > 0 && (
        <div className="space-y-4">
          <h2 className="font-heading text-lg tracking-wide">
            Preview — {selectedPrefix}
          </h2>

          {previewRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No events match prefix {selectedPrefix}.
            </p>
          ) : (
            <div className="space-y-3">
              {previewRows.map((row) => (
                <PreviewEventCard key={row.eventId} row={row} />
              ))}
            </div>
          )}

          {totalAudiences > 0 && (
            <div className="rounded-md border border-border bg-card p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium">
                  Step 4 — Create {totalAudiences} audience{totalAudiences === 1 ? "" : "s"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {writesEnabled
                    ? "Will save as drafts and immediately write to Meta."
                    : "Will save as drafts (Meta writes are disabled)."}
                </p>
              </div>
              <Button
                type="button"
                onClick={() => void handleCreate()}
              >
                Create {totalAudiences} audience{totalAudiences === 1 ? "" : "s"}
              </Button>
            </div>
          )}
        </div>
      )}

      {phase === "previewed" && previewRows.length === 0 && (
        <p className="rounded-md border border-border bg-card p-5 text-sm text-muted-foreground">
          No events match prefix <span className="font-mono">{selectedPrefix}</span>.
        </p>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PreviewEventCard({ row }: { row: BulkPreviewRow }) {
  return (
    <div
      className={`rounded-md border p-4 ${
        row.skipped ? "border-amber-400/30 bg-amber-50/50 dark:bg-amber-950/20" : "border-border bg-card"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">
            <span className="font-mono text-xs text-muted-foreground mr-1">
              [{row.eventCode}]
            </span>
            {row.eventName}
          </p>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
            <span>
              {row.matchedCampaigns.length} campaign
              {row.matchedCampaigns.length === 1 ? "" : "s"}
            </span>
            {!row.skipped && (
              <>
                <span>{row.pagePublishedVideos} page-published video{row.pagePublishedVideos === 1 ? "" : "s"}</span>
                {row.orphanVideos > 0 && (
                  <span className="text-amber-600 dark:text-amber-400">
                    {row.orphanVideos} orphan skipped
                  </span>
                )}
              </>
            )}
          </div>
          {row.matchedCampaigns.length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground truncate max-w-lg">
              {row.matchedCampaigns
                .slice(0, 3)
                .map((c) => c.name)
                .join(", ")}
              {row.matchedCampaigns.length > 3 && ` +${row.matchedCampaigns.length - 3} more`}
            </p>
          )}
        </div>
        {row.skipped ? (
          <span className="rounded-full border border-amber-400/50 bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
            Skipped
          </span>
        ) : (
          <span className="rounded-full border border-green-400/50 bg-green-100 dark:bg-green-900/40 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-300">
            {row.audiences.length} audience{row.audiences.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {row.skipped && row.skipReason && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
          {row.skipReason}
        </p>
      )}

      {!row.skipped && row.audiences.length > 0 && (
        <div className="mt-3 grid gap-1.5 sm:grid-cols-3">
          {row.audiences.map((a) => (
            <div
              key={a.name}
              className="rounded-md border border-border bg-background px-3 py-2 text-xs"
            >
              <p className="font-medium truncate">{a.name}</p>
              <p className="mt-0.5 text-muted-foreground">
                {a.threshold}% · {a.retentionDays}d · {a.videoIds.length} video
                {a.videoIds.length === 1 ? "" : "s"}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AudienceResultRow({
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
        {status === "success" ? "✅" : "❌"}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium truncate">{name}</p>
        <p className="text-xs text-muted-foreground truncate">{detail}</p>
      </div>
    </div>
  );
}
