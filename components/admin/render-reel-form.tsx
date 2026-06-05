"use client";

import { useState } from "react";

interface RenderResult {
  jobId: string;
  assetUrl: string;
  durationSec: number;
  sizeBytes: number;
  reel?: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface ReelRenderFormProps {
  reel: string;
  zoom: boolean;
  renderInputReady: boolean;
}

export function ReelRenderForm({ reel, zoom, renderInputReady }: ReelRenderFormProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RenderResult | null>(null);

  async function handleRender() {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch(
        `/api/admin/remotion/render-reel?reel=${encodeURIComponent(reel)}`,
        { method: "POST" },
      );

      const data = (await res.json()) as RenderResult & { error?: string };

      if (!res.ok) {
        throw new Error(data.error ?? `Render failed (${res.status})`);
      }

      if (!data.assetUrl) {
        throw new Error("Render succeeded but no asset URL was returned.");
      }

      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const renderInputPath = `scratch/j2-${reel}-render-input.json`;
  const downloadFilename = `j2-${reel}-reel.mp4`;
  const disabled = loading || !renderInputReady;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="rounded-lg border border-border bg-card p-6 space-y-4">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">
            Composition: <code>PhotoReelStatic</code> · h264 MP4 · 1080×1920 @ 30 fps.
          </p>
          <p className="text-sm text-muted-foreground">
            Ken-Burns zoom:{" "}
            <span className={zoom ? "font-medium text-amber-700" : "font-medium text-zinc-500"}>
              {zoom ? "ON (1.00→1.04 per photo)" : "OFF (static photos)"}
            </span>
            {" "}— toggle via <code>zoom</code> field in{" "}
            <code>{renderInputPath}</code>.
          </p>
          <p className="text-sm text-muted-foreground">
            Requires <code>FEATURE_REMOTION=1</code>. Render time: ~5–10 min on Vercel cold start.
          </p>
          {!renderInputReady ? (
            <p className="text-sm text-amber-700">
              ⚠ Render input missing — run{" "}
              <code>REEL_TARGET={reel} npx tsx scripts/upload-reel-photos.ts</code>{" "}
              locally and commit <code>{renderInputPath}</code>.
            </p>
          ) : null}
        </div>

        <button
          type="button"
          onClick={handleRender}
          disabled={disabled}
          className="inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <span
                className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
                aria-hidden
              />
              Rendering… (this takes several minutes)
            </span>
          ) : (
            `Render ${reel} reel`
          )}
        </button>
      </div>

      {error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="space-y-4 rounded-lg border border-border bg-card p-6">
          <p className="text-sm font-medium text-green-600">Render complete</p>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Reel</dt>
            <dd>{result.reel ?? reel}</dd>
            <dt className="text-muted-foreground">Duration</dt>
            <dd>{result.durationSec.toFixed(2)}s</dd>
            <dt className="text-muted-foreground">File size</dt>
            <dd>{formatBytes(result.sizeBytes)}</dd>
            <dt className="text-muted-foreground">Storage path</dt>
            <dd className="break-all text-xs">{result.jobId}</dd>
          </dl>

          <div className="flex flex-wrap gap-3">
            <a
              href={result.assetUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-primary underline"
            >
              Open signed URL
            </a>
            <a
              href={result.assetUrl}
              download={downloadFilename}
              className="text-sm text-muted-foreground underline"
            >
              Download MP4
            </a>
          </div>

          <video
            src={result.assetUrl}
            controls
            playsInline
            className="mx-auto w-full max-w-sm rounded-md border border-border"
            style={{ aspectRatio: "9/16" }}
          />
        </div>
      ) : null}
    </div>
  );
}
