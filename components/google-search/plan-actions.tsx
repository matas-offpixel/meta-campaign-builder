"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import {
  googleAdsAccountPickerOptions,
  googleSearchEventPickerOptions,
} from "@/lib/google-ads/account-picker-options";
import { WORKBOOK_KIND_LABELS, type GoogleWorkbookKind } from "@/lib/google-search/workbook-kind-labels";

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
 *     → the Search wizard, or /google-video/[id] for a YouTube video
 *     build sheet. The detected plan type shows under the controls.
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
  const [duplicate, setDuplicate] = useState<{ message: string; href: string; name: string } | null>(null);
  const pendingFile = useRef<File | null>(null);
  const [detected, setDetected] = useState<GoogleWorkbookKind | null>(null);
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

  async function handleImport(file: File, importAsNew = false) {
    setError(null);
    setDuplicate(null);
    setDetected(null);
    setImporting(true);
    try {
      const form = new FormData();
      form.set("file", file);
      if (eventId) form.set("event_id", eventId);
      if (accountId) form.set("google_ads_account_id", accountId);
      form.set("structure_mode", structureMode);
      if (importAsNew) form.set("import_as_new", "1");
      const res = await fetch("/api/google-search/import", { method: "POST", body: form });
      const json = (await res.json().catch(() => null)) as
        | { ok: true; kind?: GoogleWorkbookKind; plan_id: string }
        | {
            ok: false;
            kind?: GoogleWorkbookKind;
            error: string;
            code?: string;
            existing_plan_href?: string;
            existing_plan_name?: string;
          }
        | null;
      setDetected(json?.kind ?? null);
      if (
        res.status === 409 &&
        json &&
        !json.ok &&
        json.code === "duplicate_import" &&
        json.existing_plan_href
      ) {
        pendingFile.current = file;
        setDuplicate({
          message: json.error,
          href: json.existing_plan_href,
          name: json.existing_plan_name || "Open the existing plan",
        });
        return;
      }
      pendingFile.current = null;
      if (!json || !json.ok) {
        setError((json && !json.ok && json.error) || "Failed to import xlsx.");
        return;
      }
      router.push(json.kind === "video" ? `/google-video/${json.plan_id}` : `/google-search/${json.plan_id}`);
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-64 space-y-1 text-xs">
          <span className="block font-medium text-muted-foreground">Linked event (optional)</span>
          <Combobox
            value={eventId}
            onChange={setEventId}
            emptyText="No events match"
            options={[{ value: "", label: "— none —" }, ...googleSearchEventPickerOptions(events)]}
          />
        </div>
        <div className="w-64 space-y-1 text-xs">
          <span className="block font-medium text-muted-foreground">Ads account</span>
          <Combobox
            value={accountId}
            onChange={setAccountId}
            emptyText="No accounts match"
            options={[{ value: "", label: "— pick later —" }, ...googleAdsAccountPickerOptions(accounts)]}
          />
        </div>
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
      {detected && (
        <p className="text-xs text-muted-foreground">Detected: {WORKBOOK_KIND_LABELS[detected]}</p>
      )}
      {duplicate && (
        <p className="text-xs text-destructive" role="alert">
          {duplicate.message}{" "}
          <Link href={duplicate.href} className="underline">
            {duplicate.name}
          </Link>
          .{" "}
          <button
            type="button"
            className="underline"
            disabled={importing || !pendingFile.current}
            onClick={() => {
              const file = pendingFile.current;
              if (file) void handleImport(file, true);
            }}
          >
            Import as new anyway
          </button>
        </p>
      )}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
