"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";

type StructureMode = "single_campaign" | "campaign_per_theme";

interface PlanActionsProps {
  accounts: Array<{ id: string; account_name: string | null; google_customer_id: string | null }>;
  events: Array<{ id: string; name: string; event_code: string | null }>;
}

/**
 * Header CTA for the Google Search plan index. Two creation paths:
 *
 *  1. "New plan" → POST /api/google-search → redirect to wizard
 *  2. "Import xlsx" → POST /api/google-search/import (Phase 1 route)
 *     → redirect to wizard with imported tree
 *
 * Both are intentionally chrome-light — the wizard's Plan Setup step
 * collects the event link / ads account / name once you're inside.
 */
export function GoogleSearchPlanActions({ accounts, events }: PlanActionsProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eventId, setEventId] = useState<string>("");
  const [accountId, setAccountId] = useState<string>("");
  const [structureMode, setStructureMode] = useState<StructureMode>("single_campaign");

  async function handleNewPlan() {
    setError(null);
    setCreating(true);
    try {
      const res = await fetch("/api/google-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_id: eventId || null,
          google_ads_account_id: accountId || null,
          structure_mode: structureMode,
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: true; plan_id: string }
        | { ok: false; error: string }
        | null;
      if (!json || !json.ok) {
        setError((json && !json.ok && json.error) || "Failed to create plan.");
        return;
      }
      router.push(`/google-search/${json.plan_id}`);
    } finally {
      setCreating(false);
    }
  }

  async function handleImport(file: File) {
    setError(null);
    setImporting(true);
    try {
      const form = new FormData();
      form.set("file", file);
      if (eventId) form.set("event_id", eventId);
      if (accountId) form.set("google_ads_account_id", accountId);
      form.set("structure_mode", structureMode);
      const res = await fetch("/api/google-search/import", { method: "POST", body: form });
      const json = (await res.json().catch(() => null)) as
        | { ok: true; plan_id: string; summary?: { campaigns: number } }
        | { ok: false; error: string }
        | null;
      if (!json || !json.ok) {
        setError((json && !json.ok && json.error) || "Failed to import xlsx.");
        return;
      }
      router.push(`/google-search/${json.plan_id}`);
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1 text-xs">
          <span className="block font-medium text-muted-foreground">Linked event (optional)</span>
          <select
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
            className="h-8 rounded-md border border-border-strong bg-background px-2 text-xs"
          >
            <option value="">— none —</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.event_code ? `${e.name} (${e.event_code})` : e.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs">
          <span className="block font-medium text-muted-foreground">Ads account</span>
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="h-8 rounded-md border border-border-strong bg-background px-2 text-xs"
          >
            <option value="">— pick later —</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.account_name ?? "Account"} ({a.google_customer_id ?? "—"})
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs">
          <span className="block font-medium text-muted-foreground">Structure</span>
          <select
            value={structureMode}
            onChange={(e) => setStructureMode(e.target.value as StructureMode)}
            className="h-8 rounded-md border border-border-strong bg-background px-2 text-xs"
          >
            <option value="single_campaign">Single campaign ✓ (recommended)</option>
            <option value="campaign_per_theme">Campaign per theme (legacy)</option>
          </select>
        </label>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleNewPlan} disabled={creating || importing}>
            {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            New plan
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={creating || importing}
          >
            {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            Import xlsx
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImport(file);
            }}
          />
        </div>
      </div>
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
