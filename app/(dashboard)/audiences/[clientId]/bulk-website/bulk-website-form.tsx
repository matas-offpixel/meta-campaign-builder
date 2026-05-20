"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  BULK_WEBSITE_PIXEL_EVENTS,
  BULK_WEBSITE_EVENT_LABELS,
  DEFAULT_WEBSITE_RETENTIONS,
  META_MAX_WEBSITE_RETENTION_DAYS,
  clampWebsiteRetentionDays,
  type BulkWebsitePixelEvent,
  type BulkWebsitePreview,
  type BulkWebsiteUrlMode,
} from "@/lib/audiences/bulk-website-types";
import { normalizeWebsitePixelUrlContains } from "@/lib/audiences/pixel-url-contains";

// ── Types ─────────────────────────────────────────────────────────────────────

type Phase = "idle" | "previewing" | "previewed" | "creating" | "done";

interface CellSuccess {
  audienceId: string;
  metaAudienceId: string | null;
  name: string;
  pixelEvent: BulkWebsitePixelEvent;
  retentionDays: number;
}

interface CellFailure {
  audienceId: string;
  error: string;
  name: string;
  pixelEvent: BulkWebsitePixelEvent;
  retentionDays: number;
}

interface CreateResponse {
  ok: true;
  preview: BulkWebsitePreview;
  draftIds: string[];
  successes: CellSuccess[];
  failures: CellFailure[];
}

// ── Component ─────────────────────────────────────────────────────────────────

export function BulkWebsiteAudiencesForm({
  clientId,
  clientName,
  clientSlug,
  defaultPixelId,
  writesEnabled,
}: {
  clientId: string;
  clientName: string;
  clientSlug: string | null;
  defaultPixelId: string | null;
  writesEnabled: boolean;
}) {
  // Step 1 — pixel ID (auto-filled from client; user can override).
  const [pixelId, setPixelId] = useState(defaultPixelId ?? "");

  // Step 2 — URL scope.
  const [urlMode, setUrlMode] = useState<BulkWebsiteUrlMode>("whole_pixel");
  // Raw textarea text — one URL per line (or comma-separated).
  // Parsed on preview/create via normalizeWebsitePixelUrlContains.
  const [urlKeywordsText, setUrlKeywordsText] = useState("");

  // Step 3 — pixel events.
  const [selectedEvents, setSelectedEvents] = useState<Set<BulkWebsitePixelEvent>>(
    new Set(["PageView"]),
  );

  // Step 4 — retention days.
  const [selectedRetentions, setSelectedRetentions] = useState<Set<number>>(
    new Set<number>(DEFAULT_WEBSITE_RETENTIONS),
  );
  const [customRetentions, setCustomRetentions] = useState<number[]>([]);
  const [customRetentionErrors, setCustomRetentionErrors] = useState<Record<number, string>>({});

  // Optional name-prefix override.
  const [labelOverride, setLabelOverride] = useState("");

  // Async state.
  const [phase, setPhase] = useState<Phase>("idle");
  const [preview, setPreview] = useState<BulkWebsitePreview | null>(null);
  const [createResult, setCreateResult] = useState<CreateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggleEvent = useCallback((ev: BulkWebsitePixelEvent) => {
    setSelectedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(ev)) next.delete(ev);
      else next.add(ev);
      return next;
    });
    resetPreview(setPhase, setPreview);
  }, []);

  const toggleRetention = useCallback((days: number) => {
    setSelectedRetentions((prev) => {
      const next = new Set(prev);
      if (next.has(days)) next.delete(days);
      else next.add(days);
      return next;
    });
    resetPreview(setPhase, setPreview);
  }, []);

  const addCustomRetention = useCallback(() => {
    setCustomRetentions((prev) => [...prev, 90]);
    resetPreview(setPhase, setPreview);
  }, []);

  const updateCustomRetention = useCallback((idx: number, value: number) => {
    const clamped = clampWebsiteRetentionDays(value);
    setCustomRetentions((prev) => prev.map((v, i) => (i === idx ? clamped : v)));
    setCustomRetentionErrors((prev) => {
      const next = { ...prev };
      if (value > META_MAX_WEBSITE_RETENTION_DAYS) {
        next[idx] = `Website audiences cap at ${META_MAX_WEBSITE_RETENTION_DAYS} days — clamped to ${clamped}d.`;
      } else {
        delete next[idx];
      }
      return next;
    });
    resetPreview(setPhase, setPreview);
  }, []);

  const removeCustomRetention = useCallback((idx: number) => {
    setCustomRetentions((prev) => prev.filter((_, i) => i !== idx));
    setCustomRetentionErrors((prev) => {
      const next = { ...prev };
      delete next[idx];
      return next;
    });
    resetPreview(setPhase, setPreview);
  }, []);

  const allRetentions = useMemo(() => {
    const merged = new Set<number>(selectedRetentions);
    for (const r of customRetentions) merged.add(clampWebsiteRetentionDays(r));
    return Array.from(merged).sort((a, b) => a - b);
  }, [selectedRetentions, customRetentions]);

  const eventsArr = Array.from(selectedEvents).filter((e) =>
    BULK_WEBSITE_PIXEL_EVENTS.includes(e),
  );
  // Parsed, deduplicated URL list — empty when whole_pixel mode.
  const parsedUrlKeywords = useMemo(
    () =>
      urlMode === "url_keyword"
        ? normalizeWebsitePixelUrlContains(urlKeywordsText)
        : [],
    [urlMode, urlKeywordsText],
  );
  const validationError = validateForm({
    pixelId,
    events: eventsArr,
    retentions: allRetentions,
    urlMode,
    parsedUrlKeywords,
  });

  function buildRequestBody(withMeta: boolean) {
    return {
      clientId,
      pixelId: pixelId.trim(),
      labelOverride: labelOverride.trim() || null,
      pixelEvents: eventsArr,
      urlKeywords: parsedUrlKeywords,
      retentions: allRetentions,
      ...(withMeta ? { createOnMeta: writesEnabled } : {}),
    };
  }

  async function handlePreview() {
    if (validationError) { setError(validationError); return; }
    setPhase("previewing");
    setError(null);
    setPreview(null);
    try {
      const res = await fetch("/api/audiences/bulk-website/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildRequestBody(false)),
      });
      const json = (await res.json()) as
        | { ok: true; preview: BulkWebsitePreview }
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
      const res = await fetch("/api/audiences/bulk-website/create", {
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
              ? `${successCount} audience${successCount === 1 ? "" : "s"} created on Meta`
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
                detail={s.metaAudienceId ? `Meta ID: ${s.metaAudienceId}` : "Saved (no Meta ID returned)"}
              />
            ))}
            {failures.map((f) => (
              <CellResultRow key={f.audienceId} name={f.name} status="failed" detail={f.error} />
            ))}
          </div>
        )}

        {!writesEnabled && draftIds.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {draftIds.length} draft{draftIds.length === 1 ? "" : "s"} saved. Enable Meta writes to push to Meta.
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

  // ── Creating screen ──────────────────────────────────────────────────────────

  if (phase === "creating" && preview) {
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-border bg-card p-4">
          <p className="font-heading text-lg tracking-wide">
            Creating {preview.cells.length} audience{preview.cells.length === 1 ? "" : "s"}…
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {writesEnabled
              ? "Saving drafts and writing to Meta — sequential cell processing (concurrency = 2)."
              : "Saving drafts…"}
          </p>
        </div>
        <div className="space-y-1.5">
          {preview.cells.map((cell) => (
            <div
              key={`${cell.pixelEvent}:${cell.retentionDays}`}
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

        {/* Step 1 — Pixel */}
        <div>
          <h2 className="font-heading text-lg tracking-wide">Step 1 — Pixel</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The Meta pixel ID to build audiences from. Auto-filled from the client record.
          </p>
          <div className="mt-3 max-w-xs">
            <input
              type="text"
              value={pixelId}
              onChange={(e) => {
                setPixelId(e.target.value);
                resetPreview(setPhase, setPreview);
              }}
              placeholder="e.g. 123456789012345"
              className="h-9 w-full rounded-md border border-border-strong bg-background px-3 font-mono text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          {!defaultPixelId && (
            <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
              No pixel is configured on this client. Set one in Client Settings
              or enter the pixel ID above.
            </p>
          )}
        </div>

        {/* Step 2 — URL scope */}
        <div>
          <h2 className="font-heading text-lg tracking-wide">Step 2 — URL scope</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            &ldquo;Whole pixel&rdquo; targets all visitors. &ldquo;URL keyword&rdquo; adds a URL{" "}
            <code className="text-xs">i_contains</code> filter — include the{" "}
            <code className="text-xs">https://</code> scheme (Meta requires it).
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setUrlMode("whole_pixel");
                resetPreview(setPhase, setPreview);
              }}
              className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                urlMode === "whole_pixel"
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background text-muted-foreground hover:text-foreground"
              }`}
            >
              Whole pixel
            </button>
            <button
              type="button"
              onClick={() => {
                setUrlMode("url_keyword");
                resetPreview(setPhase, setPreview);
              }}
              className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                urlMode === "url_keyword"
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background text-muted-foreground hover:text-foreground"
              }`}
            >
              URL keyword
            </button>
          </div>
          {urlMode === "url_keyword" && (
            <div className="mt-3 max-w-lg">
              <textarea
                rows={4}
                value={urlKeywordsText}
                onChange={(e) => {
                  setUrlKeywordsText(e.target.value);
                  resetPreview(setPhase, setPreview);
                }}
                placeholder={"https://example.com/events/glasgow\nhttps://example.com/events/london"}
                className="w-full rounded-md border border-border-strong bg-background px-3 py-2 font-mono text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                One URL per line. All URLs become a single OR-group rule:{" "}
                <code className="text-xs">url contains &ldquo;A&rdquo; OR &ldquo;B&rdquo;</code>.
                Include the <code className="text-xs">https://</code> scheme (Meta requires it).
              </p>
              {parsedUrlKeywords.length > 0 && (
                <p className="mt-1 text-xs text-primary">
                  {parsedUrlKeywords.length} URL{parsedUrlKeywords.length === 1 ? "" : "s"} parsed
                </p>
              )}
            </div>
          )}
        </div>

        {/* Step 3 — Events */}
        <div>
          <h2 className="font-heading text-lg tracking-wide">Step 3 — Pixel events</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Each ticked event becomes a matrix row (one audience per retention).
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {BULK_WEBSITE_PIXEL_EVENTS.map((ev) => {
              const checked = selectedEvents.has(ev);
              return (
                <label
                  key={ev}
                  className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm ${
                    checked ? "border-primary bg-primary/10" : "border-border bg-background"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleEvent(ev)}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="font-medium">{ev}</p>
                    <p className="text-xs text-muted-foreground">
                      {BULK_WEBSITE_EVENT_LABELS[ev]}
                    </p>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        {/* Step 4 — Retention */}
        <div>
          <h2 className="font-heading text-lg tracking-wide">
            Step 4 — Retention windows (days)
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Tick standard windows or add custom day counts (1–{META_MAX_WEBSITE_RETENTION_DAYS}).
            Meta caps website-pixel retention at {META_MAX_WEBSITE_RETENTION_DAYS} days.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-4">
            {DEFAULT_WEBSITE_RETENTIONS.map((days) => {
              const checked = selectedRetentions.has(days);
              return (
                <label
                  key={days}
                  className={`flex cursor-pointer items-center gap-3 rounded-md border p-3 text-sm ${
                    checked ? "border-primary bg-primary/10" : "border-border bg-background"
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
              <div key={idx} className="space-y-1">
                <div className="flex items-center gap-2">
                  <div className={`flex items-center gap-1.5 rounded-md border bg-background px-2 py-1.5 text-sm ${customRetentionErrors[idx] ? "border-amber-400" : "border-border"}`}>
                    <label className="text-xs text-muted-foreground whitespace-nowrap">
                      Retention
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={META_MAX_WEBSITE_RETENTION_DAYS}
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
                {customRetentionErrors[idx] && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 pl-1">
                    {customRetentionErrors[idx]}
                  </p>
                )}
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
            htmlFor="bulk-website-label"
            className="flex flex-col gap-1.5 text-sm font-medium"
          >
            Name prefix (optional)
            <input
              id="bulk-website-label"
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
            <code>[junction2] PageView glasgow-o2 30d</code>.
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
  preview: BulkWebsitePreview;
  writesEnabled: boolean;
  onCreate: () => void;
}) {
  return (
    <div className="space-y-4">
      <h2 className="font-heading text-lg tracking-wide">
        Preview — {preview.cells.length} cell{preview.cells.length === 1 ? "" : "s"}
      </h2>
      <div className="rounded-md border border-border bg-card p-4 text-sm space-y-1">
        <p>
          <strong>Pixel:</strong>{" "}
          <code className="text-xs">{preview.pixelId}</code> ·{" "}
          <strong>Prefix:</strong> <code>[{preview.labelPrefix}]</code>
        </p>
        {preview.urlKeywords.length > 0 ? (
          <p>
            <strong>URL filter ({preview.urlKeywords.length}):</strong>{" "}
            {preview.urlKeywords.map((u, i) => (
              <span key={u}>
                {i > 0 && <span className="text-muted-foreground"> OR </span>}
                <code className="text-xs">&ldquo;{u}&rdquo;</code>
              </span>
            ))}
          </p>
        ) : (
          <p className="text-muted-foreground">URL scope: whole pixel (all visitors)</p>
        )}
      </div>

      <div className="grid gap-1.5 sm:grid-cols-2 md:grid-cols-3">
        {preview.cells.map((cell) => (
          <div
            key={`${cell.pixelEvent}:${cell.retentionDays}`}
            className="rounded-md border border-border bg-card px-3 py-2 text-xs"
          >
            <p className="font-medium truncate">{cell.name}</p>
            <p className="mt-0.5 text-muted-foreground">
              {cell.pixelEvent} · {cell.retentionDays}d ·{" "}
              {cell.funnelStage.replace(/_/g, " ")}
            </p>
          </div>
        ))}
      </div>

      <div className="rounded-md border border-border bg-card p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium">
            Create {preview.cells.length} audience{preview.cells.length === 1 ? "" : "s"}
          </p>
          <p className="text-xs text-muted-foreground">
            {writesEnabled
              ? "Will save as drafts and immediately write to Meta (concurrency = 2, no splitting)."
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

function validateForm(args: {
  pixelId: string;
  events: BulkWebsitePixelEvent[];
  retentions: number[];
  urlMode: BulkWebsiteUrlMode;
  parsedUrlKeywords: string[];
}): string | null {
  if (!args.pixelId.trim()) return "Enter the pixel ID.";
  if (args.events.length === 0) return "Pick at least one pixel event.";
  if (args.retentions.length === 0) return "Pick at least one retention window.";
  if (args.urlMode === "url_keyword" && args.parsedUrlKeywords.length === 0) {
    return 'Enter at least one URL or switch to "Whole pixel".';
  }
  return null;
}

function resetPreview(
  setPhase: (p: Phase) => void,
  setPreview: (p: BulkWebsitePreview | null) => void,
) {
  setPhase("idle");
  setPreview(null);
}
