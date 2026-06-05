"use client";

import { useState } from "react";

interface RenderResult {
  jobId: string;
  assetUrl: string;
  durationSec: number;
  sizeBytes: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ReelRenderForm() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RenderResult | null>(null);

  async function handleRender() {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/admin/remotion/render-reel", {
        method: "POST",
      });

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

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="rounded-lg border border-border bg-card p-6 space-y-4">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">
            Composition: <code>PhotoReelStatic</code> — 64 photos, 7 frames each,
            14.93s @ 30 fps, h264 MP4.
          </p>
          <p className="text-sm text-muted-foreground">
            Source: <code>scratch/j2-bridge-render-input.json</code> (must exist on
            server — run the upload script first).
          </p>
          <p className="text-sm text-muted-foreground">
            Requires <code>FEATURE_REMOTION=1</code>. Render time: ~5–10 min on
            Vercel cold start.
          </p>
        </div>

        <button
          type="button"
          onClick={handleRender}
          disabled={loading}
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
            "Render J2 Bridge reel"
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
              download="j2-bridge-reel.mp4"
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
