"use client";

import { useState } from "react";
import { Save, Copy, CheckCircle2, AlertCircle } from "lucide-react";
import type { AssetSheetConfigRow } from "@/lib/db/asset-sheet-config";

interface Props {
  clientId: string;
  initialConfig: AssetSheetConfigRow | null;
  serviceAccountEmail: string | null;
}

const DEFAULT_CTA = JSON.stringify({ TOFU: "WATCH_MORE", MOFU: "LEARN_MORE", BOFU: "GET_TICKETS" }, null, 2);
const DEFAULT_URL_PATTERN = JSON.stringify({ TOFU: "", MOFU: "", BOFU: "" }, null, 2);
const DEFAULT_COPY_TEMPLATES = JSON.stringify({ TOFU: "", MOFU: "", BOFU: "" }, null, 2);

function jsonOrDefault(val: unknown, fallback: string): string {
  if (!val || (typeof val === "object" && Object.keys(val as object).length === 0)) return fallback;
  return JSON.stringify(val, null, 2);
}

export function AssetQueueConfigForm({ clientId, initialConfig, serviceAccountEmail }: Props) {
  const [sheetId, setSheetId] = useState(initialConfig?.google_sheet_id ?? "");
  const [range, setRange] = useState(initialConfig?.sheet_range ?? "Assets!A:G");
  const [ctaDefaults, setCtaDefaults] = useState(jsonOrDefault(initialConfig?.cta_defaults, DEFAULT_CTA));
  const [urlPattern, setUrlPattern] = useState(jsonOrDefault(initialConfig?.destination_url_pattern, DEFAULT_URL_PATTERN));
  const [copyTemplates, setCopyTemplates] = useState(jsonOrDefault(initialConfig?.copy_templates, DEFAULT_COPY_TEMPLATES));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

  async function copyEmail() {
    if (!serviceAccountEmail) return;
    await navigator.clipboard.writeText(serviceAccountEmail);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="mt-6 space-y-6">
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-1 font-heading text-sm tracking-wide">Google service account</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Share your Google Sheet with this email address (Viewer access is enough).
        </p>
        {serviceAccountEmail ? (
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 font-mono text-sm">
            <span className="flex-1 truncate">{serviceAccountEmail}</span>
            <button onClick={copyEmail} title="Copy" className="shrink-0 text-muted-foreground hover:text-foreground">
              {copied ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
        ) : (
          <p className="text-xs text-destructive">
            GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL env var not set — contact your developer.
          </p>
        )}
      </section>

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
              Sheet range <span className="text-muted-foreground/60">(e.g. Assets!A:G)</span>
            </label>
            <input
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
              value={range}
              onChange={(e) => setRange(e.target.value)}
            />
          </div>
        </div>
      </section>

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
