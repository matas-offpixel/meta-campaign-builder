"use client";

import { useState } from "react";
import { Save, CheckCircle2, AlertCircle, ExternalLink } from "lucide-react";
import type { AssetSheetConfigRow } from "@/lib/db/asset-sheet-config";

interface Props {
  clientId: string;
  initialConfig: AssetSheetConfigRow | null;
}

const DEFAULT_CTA = JSON.stringify({ TOFU: "WATCH_MORE", MOFU: "LEARN_MORE", BOFU: "GET_TICKETS" }, null, 2);
const DEFAULT_URL_PATTERN = JSON.stringify({ TOFU: "", MOFU: "", BOFU: "" }, null, 2);
const DEFAULT_COPY_TEMPLATES = JSON.stringify({ TOFU: "", MOFU: "", BOFU: "" }, null, 2);

function jsonOrDefault(val: unknown, fallback: string): string {
  if (!val || (typeof val === "object" && Object.keys(val as object).length === 0)) return fallback;
  return JSON.stringify(val, null, 2);
}

export function AssetQueueConfigForm({ clientId, initialConfig }: Props) {
  const [sheetId, setSheetId] = useState(initialConfig?.google_sheet_id ?? "");
  const [range, setRange] = useState(initialConfig?.sheet_range ?? "Assets!A:G");
  const [ctaDefaults, setCtaDefaults] = useState(jsonOrDefault(initialConfig?.cta_defaults, DEFAULT_CTA));
  const [urlPattern, setUrlPattern] = useState(jsonOrDefault(initialConfig?.destination_url_pattern, DEFAULT_URL_PATTERN));
  const [copyTemplates, setCopyTemplates] = useState(jsonOrDefault(initialConfig?.copy_templates, DEFAULT_COPY_TEMPLATES));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    setSaving(true);

    let parsedCta: unknown, parsedUrl: unknown, parsedTemplates: unknown;
    try {
      parsedCta = JSON.parse(ctaDefaults);
      parsedUrl = JSON.parse(urlPattern);
      parsedTemplates = JSON.parse(copyTemplates);
    } catch {
      setError("CTA defaults, URL patterns, and copy templates must be valid JSON.");
      setSaving(false);
      return;
    }

    try {
      const res = await fetch(`/api/clients/${clientId}/asset-sheet-config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          google_sheet_id: sheetId.trim(),
          sheet_range: range.trim() || "Assets!A:G",
          cta_defaults: parsedCta,
          destination_url_pattern: parsedUrl,
          copy_templates: parsedTemplates,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Save failed");
        return;
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-6 space-y-6">
      {/* ── Sheet visibility callout ─────────────────────────────────────────── */}
      <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
        <span className="mt-0.5 text-lg leading-none" aria-hidden>⚠️</span>
        <div className="text-sm">
          <p className="font-medium text-amber-900 dark:text-amber-200">
            Your sheet must be set to &ldquo;Anyone with link can view&rdquo;
          </p>
          <p className="mt-1 text-amber-800 dark:text-amber-300">
            Open your Google Sheet → Share → change access to <strong>Anyone with the link</strong> → set role to <strong>Viewer</strong>.
            The sheet must contain a tab named exactly <strong>Assets</strong>.
          </p>
          <a
            href="https://support.google.com/docs/answer/2494822"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-amber-700 underline underline-offset-2 hover:text-amber-900 dark:text-amber-400 dark:hover:text-amber-200"
          >
            How to share a Google Sheet
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>

      {/* ── Sheet connection ─────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-3 font-heading text-sm tracking-wide">Sheet connection</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Google Sheet ID
              <span className="ml-1 text-muted-foreground/60">(from the URL: /spreadsheets/d/<strong>THIS_PART</strong>/edit)</span>
            </label>
            <input
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
              value={sheetId}
              onChange={(e) => setSheetId(e.target.value)}
              placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Sheet range <span className="text-muted-foreground/60">(e.g. Assets!A:G — the tab name must match)</span>
            </label>
            <input
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
              value={range}
              onChange={(e) => setRange(e.target.value)}
            />
          </div>
        </div>
      </section>

      {/* ── Ad copy defaults ─────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-1 font-heading text-sm tracking-wide">Ad copy defaults</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Used as fallback when AI copy generation fails. JSON object keyed by funnel stage.
        </p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">CTA defaults</label>
            <textarea
              className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              rows={5}
              value={ctaDefaults}
              onChange={(e) => setCtaDefaults(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Destination URL patterns</label>
            <textarea
              className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              rows={5}
              value={urlPattern}
              onChange={(e) => setUrlPattern(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Fallback copy templates</label>
            <textarea
              className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              rows={5}
              value={copyTemplates}
              onChange={(e) => setCopyTemplates(e.target.value)}
            />
          </div>
        </div>
      </section>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={saving || !sheetId}
        className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {saved ? <CheckCircle2 className="h-4 w-4" /> : <Save className="h-4 w-4" />}
        {saved ? "Saved" : saving ? "Saving…" : "Save config"}
      </button>
    </div>
  );
}
