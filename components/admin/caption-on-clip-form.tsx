"use client";

import { useState } from "react";

type RenderResult = {
  renderId: string;
  renderMs: number;
  creativeAssetId: string;
  aspect: string;
  width: number;
  height: number;
  storagePath: string;
  durationSeconds: number;
};

/**
 * One creative_lab_renders row per submit, the same shape as the reel
 * form: the route renders, the page shows the result.
 */
export function CaptionOnClipForm() {
  const [renderId, setRenderId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RenderResult | null>(null);

  async function handleRender() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/remotion/render-caption", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ renderId: renderId.trim() }),
      });
      const data = (await res.json()) as RenderResult & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Render failed (${res.status})`);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-4 rounded-lg border border-border bg-card p-6">
        <div className="space-y-1">
          <p className="text-sm font-medium">Caption on clip</p>
          <p className="text-sm text-muted-foreground">
            Composition: <code>CaptionOnClip</code> · h264 · the source&apos;s own size, never upscaled. One render row, one aspect.
          </p>
          <p className="text-sm text-muted-foreground">
            Requires <code>FEATURE_REMOTION=1</code>. The row names the clip, the caption and the aspect.
          </p>
        </div>
        <label className="block space-y-1 text-sm">
          <span className="text-muted-foreground">Render id</span>
          <input
            value={renderId}
            onChange={(event) => setRenderId(event.target.value)}
            placeholder="creative_lab_renders.id"
            className="w-full rounded-md border border-border bg-background px-3 py-2"
          />
        </label>
        <button
          type="button"
          onClick={handleRender}
          disabled={loading || !renderId.trim()}
          className="inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {loading ? "Rendering… (this takes several minutes)" : "Render caption"}
        </button>
      </div>
      {error ? <p className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p> : null}
      {result ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-border bg-card p-6 text-sm">
          <dt className="text-muted-foreground">Aspect</dt>
          <dd>
            {result.aspect} · {result.width}×{result.height}
          </dd>
          <dt className="text-muted-foreground">Duration</dt>
          <dd>{result.durationSeconds.toFixed(2)}s</dd>
          <dt className="text-muted-foreground">Render</dt>
          <dd>{(result.renderMs / 1000).toFixed(1)}s</dd>
          <dt className="text-muted-foreground">creative_assets</dt>
          <dd className="break-all text-xs">{result.creativeAssetId}</dd>
          <dt className="text-muted-foreground">Storage path</dt>
          <dd className="break-all text-xs">{result.storagePath}</dd>
        </dl>
      ) : null}
    </div>
  );
}
