"use client";

import { useState } from "react";

const DEFAULT_FIELDS = {
  city: "Manchester",
  venue: "Etihad",
  opponent_a: "Man City",
  opponent_b: "Liverpool",
  kick_off_at: "2026-10-15T19:30:00Z",
};

const TEMPLATE_ID = "4tf-city-static-v1";

const FIELD_ROWS: Array<{ key: keyof typeof DEFAULT_FIELDS; label: string }> = [
  { key: "city", label: "City" },
  { key: "venue", label: "Venue" },
  { key: "opponent_a", label: "Team A" },
  { key: "opponent_b", label: "Team B" },
  { key: "kick_off_at", label: "Kick-off (ISO)" },
];

export function RenderTestForm() {
  const [fields, setFields] = useState(DEFAULT_FIELDS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assetUrl, setAssetUrl] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setAssetUrl(null);
    setJobId(null);
    setCopied(false);

    try {
      const res = await fetch("/api/admin/remotion/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: TEMPLATE_ID, fields }),
      });

      const data = (await res.json()) as {
        assetUrl?: string;
        jobId?: string;
        error?: string;
      };

      if (!res.ok) {
        throw new Error(data.error ?? `Render failed (${res.status})`);
      }

      if (!data.assetUrl) {
        throw new Error("Render succeeded but no asset URL was returned.");
      }

      setAssetUrl(data.assetUrl);
      setJobId(data.jobId ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function copyUrl() {
    if (!assetUrl) return;
    await navigator.clipboard.writeText(assetUrl);
    setCopied(true);
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-border bg-card p-6">
        {FIELD_ROWS.map(({ key, label }) => (
          <label key={key} className="block space-y-1">
            <span className="text-sm font-medium">{label}</span>
            <input
              type="text"
              required
              value={fields[key]}
              onChange={(e) =>
                setFields((prev) => ({ ...prev, [key]: e.target.value }))
              }
              className="w-full rounded-md border border-border bg-background px-3 py-2"
            />
          </label>
        ))}

        <button
          type="submit"
          disabled={loading}
          className="inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {loading ? "Rendering…" : "Render PNG"}
        </button>
      </form>

      {error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {assetUrl ? (
        <div className="space-y-3 rounded-lg border border-border bg-card p-6">
          <p className="text-sm font-medium">Render complete</p>
          {jobId ? (
            <p className="break-all text-xs text-muted-foreground">
              Storage path: {jobId}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <a
              href={assetUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-primary underline"
            >
              Open signed URL
            </a>
            <button
              type="button"
              onClick={copyUrl}
              className="text-sm text-muted-foreground underline"
            >
              {copied ? "Copied" : "Copy URL"}
            </button>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={assetUrl}
            alt="Remotion render preview"
            className="mx-auto max-h-[480px] w-full max-w-[480px] rounded-md border border-border object-contain"
          />
        </div>
      ) : null}
    </div>
  );
}
