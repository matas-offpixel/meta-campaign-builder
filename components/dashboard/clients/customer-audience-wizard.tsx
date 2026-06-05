"use client";

/**
 * CustomerAudienceWizard
 *
 * Four-step browser-side wizard for uploading customer CSV lists into a
 * Meta Custom Audience bound to the client's ad account.
 *
 *   Step 0 — Mode: "Create new audience" vs "Add to existing audience"
 *   Step 1 — Upload CSV files (multi-file drag-drop)
 *   Step 2 — Column mapping (email / phone / skip per detected column)
 *   Step 3 — Review & upload (hash in browser → post chunks to API)
 *
 * PII Safety:
 *   - Raw PII never leaves the browser. Parsing, normalisation, SHA-256
 *     hashing all happen here via lib/customer-audience/hash-client.ts
 *     (Web Crypto API). The API route receives only hashed values.
 *   - No PII in localStorage, sessionStorage, or any persistence.
 *   - console.log shows counts only ("hashed 2,341 emails") — never values.
 *   - CSV files held in React state only; cleared on "Clear all" or unmount.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronRight,
  Upload,
  CheckCircle2,
  AlertCircle,
  Loader2,
  X,
  ShieldAlert,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  parseCsv,
  autoDetectColumns,
  validateFiles,
  type ParsedCsv,
  type ColumnRole,
  MAX_FILES,
  MAX_FILE_SIZE_BYTES,
} from "@/lib/customer-audience/csv-parse";
import {
  hashAudienceBatch,
  chunkData,
  type MatchSchema,
} from "@/lib/customer-audience/hash-client";
import type { ExistingAudience } from "@/app/api/meta/customer-audience-upload/list/route";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CustomerAudienceWizardProps {
  clientId: string;
  clientName: string;
  /** From client.meta_ad_account_id server-side. Empty string = unconfigured. */
  adAccountId: string;
}

type Step = 0 | 1 | 2 | 3;
type UploadMode = "create" | "append";

interface FileEntry {
  file: File;
  status: "pending" | "parsing" | "done" | "error";
  parsed?: ParsedCsv;
  error?: string;
}

interface UploadResult {
  audienceId: string;
  audienceName: string;
  totalUploaded: number;
  numInvalid: number;
  numChunks: number;
}

// ─── Step indicator ───────────────────────────────────────────────────────────

function StepIndicator({ step }: { step: Step }) {
  const labels = ["Mode", "Upload files", "Map columns", "Review & upload"];
  return (
    <ol className="flex flex-wrap items-center gap-0 text-xs">
      {labels.map((label, i) => {
        const active = step === i;
        const done = step > i;
        return (
          <li key={i} className="flex items-center gap-1">
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold
                ${done || active ? "bg-primary text-background" : "bg-muted text-muted-foreground"}`}
            >
              {done ? "✓" : i + 1}
            </span>
            <span
              className={
                active
                  ? "font-medium text-foreground"
                  : done
                    ? "text-foreground/70"
                    : "text-muted-foreground"
              }
            >
              {label}
            </span>
            {i < labels.length - 1 && (
              <ChevronRight className="mx-1 h-3 w-3 text-muted-foreground" />
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ─── PII Warning Banner ───────────────────────────────────────────────────────

function PiiBanner() {
  return (
    <div className="flex items-start gap-3 rounded-md border border-amber-500/30 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      <p>
        <span className="font-semibold">Customer data is hashed in your browser before upload.</span>{" "}
        Off/Pixel servers never see raw emails or phone numbers. Make sure you have
        consent under UK GDPR before uploading.
      </p>
    </div>
  );
}

// ─── Drag-drop zone ───────────────────────────────────────────────────────────

function DropZone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const files = Array.from(e.dataTransfer.files).filter((f) =>
        f.name.toLowerCase().endsWith(".csv"),
      );
      if (files.length) onFiles(files);
    },
    [onFiles],
  );

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 transition-colors
        ${dragging ? "border-primary bg-primary/5" : "border-border hover:border-border-strong hover:bg-muted/30"}`}
    >
      <Upload className="mb-3 h-8 w-8 text-muted-foreground" />
      <p className="text-sm font-medium">Drop CSV files here, or click to browse</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Up to {MAX_FILES} files · max {MAX_FILE_SIZE_BYTES / 1024 / 1024} MB each · .csv only
      </p>
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onFiles(files);
          e.target.value = "";
        }}
      />
    </div>
  );
}

// ─── Wizard ───────────────────────────────────────────────────────────────────

export function CustomerAudienceWizard({
  clientId,
  clientName,
  adAccountId,
}: CustomerAudienceWizardProps) {
  const backHref = `/clients/${clientId}`;

  const [step, setStep] = useState<Step>(0);
  const [instanceKey, setInstanceKey] = useState(0);

  // Step 0 — mode
  const [mode, setMode] = useState<UploadMode>("create");
  const [audienceName, setAudienceName] = useState("");
  const [audienceDescription, setAudienceDescription] = useState("");
  const [retentionDays, setRetentionDays] = useState(180);
  const [existingAudiences, setExistingAudiences] = useState<ExistingAudience[]>([]);
  const [existingLoading, setExistingLoading] = useState(false);
  const [existingError, setExistingError] = useState<string | null>(null);
  const [selectedAudienceId, setSelectedAudienceId] = useState("");
  const [selectedAudienceName, setSelectedAudienceName] = useState("");

  // Step 1 — files
  const [fileEntries, setFileEntries] = useState<FileEntry[]>([]);
  const [fileErrors, setFileErrors] = useState<string[]>([]);

  // Step 2 — columns
  const [columnMap, setColumnMap] = useState<Record<string, ColumnRole>>({});

  // Step 3 — upload
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    phase: "hashing" | "uploading";
    hashedCount: number;
    chunksDone: number;
    chunksTotal: number;
  } | null>(null);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const abortRef = useRef(false);

  // Fetch existing audiences when append mode selected
  useEffect(() => {
    if (mode !== "append" || !adAccountId) return;
    setExistingLoading(true);
    setExistingError(null);
    fetch(
      `/api/meta/customer-audience-upload/list?adAccountId=${encodeURIComponent(adAccountId)}`,
    )
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Failed to load audiences");
        setExistingAudiences(json.data ?? []);
      })
      .catch((err) => {
        setExistingError(err instanceof Error ? err.message : "Network error");
      })
      .finally(() => setExistingLoading(false));
  }, [mode, adAccountId]);

  useEffect(() => {
    const found = existingAudiences.find((a) => a.id === selectedAudienceId);
    setSelectedAudienceName(found?.name ?? "");
  }, [selectedAudienceId, existingAudiences]);

  const handleFiles = useCallback(
    async (incoming: File[]) => {
      const all = [...fileEntries.map((e) => e.file), ...incoming];
      const errors = validateFiles(all);
      if (errors.length) { setFileErrors(errors); return; }
      setFileErrors([]);

      const newEntries: FileEntry[] = incoming.map((f) => ({ file: f, status: "pending" }));
      setFileEntries((prev) => [...prev, ...newEntries]);

      for (const entry of newEntries) {
        setFileEntries((prev) =>
          prev.map((e) => (e.file === entry.file ? { ...e, status: "parsing" } : e)),
        );
        try {
          const parsed = await parseCsv(entry.file);
          console.info(
            `[CustomerAudienceWizard] Parsed "${entry.file.name}": ${parsed.rowCount} rows`,
          );
          setFileEntries((prev) =>
            prev.map((e) =>
              e.file === entry.file ? { ...e, status: "done", parsed } : e,
            ),
          );
        } catch (err) {
          const msg =
            typeof err === "object" && err !== null && "message" in err
              ? String((err as { message: string }).message)
              : "Parse error";
          setFileEntries((prev) =>
            prev.map((e) =>
              e.file === entry.file ? { ...e, status: "error", error: msg } : e,
            ),
          );
        }
      }
    },
    [fileEntries],
  );

  const removeFile = useCallback((file: File) => {
    setFileEntries((prev) => prev.filter((e) => e.file !== file));
  }, []);

  const parsedFiles = fileEntries.filter((e) => e.status === "done" && e.parsed);
  const allHeaders = Array.from(
    new Set(parsedFiles.flatMap((e) => e.parsed!.headers)),
  );

  useEffect(() => {
    if (step === 2 && allHeaders.length > 0) {
      setColumnMap((prev) => {
        const detected = autoDetectColumns(allHeaders);
        const merged: Record<string, ColumnRole> = {};
        for (const h of allHeaders) merged[h] = prev[h] ?? detected[h];
        return merged;
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const step0Valid =
    mode === "create" ? audienceName.trim().length > 0 : selectedAudienceId.length > 0;
  const totalRawRows = parsedFiles.reduce((s, e) => s + (e.parsed?.rowCount ?? 0), 0);
  const step1Valid = parsedFiles.length > 0;
  const emailCol = Object.entries(columnMap).find(([, r]) => r === "email")?.[0];
  const phoneCol = Object.entries(columnMap).find(([, r]) => r === "phone")?.[0];
  const step2Valid = !!(emailCol || phoneCol);
  const targetAudienceName = mode === "create" ? audienceName.trim() : selectedAudienceName;

  const handleUpload = async () => {
    if (uploading) return;
    abortRef.current = false;
    setUploading(true);
    setUploadError(null);
    setUploadProgress({ phase: "hashing", hashedCount: 0, chunksDone: 0, chunksTotal: 0 });

    try {
      const rawRows = parsedFiles.flatMap((e) =>
        (e.parsed?.rows ?? []).map((row) => ({
          email: emailCol ? row[emailCol] : undefined,
          phone: phoneCol ? row[phoneCol] : undefined,
        })),
      );

      const { schema, data, emailCount, phoneCount, skippedCount } =
        await hashAudienceBatch(rawRows, !!emailCol, !!phoneCol);

      console.info(
        `[CustomerAudienceWizard] Hashing done: emails=${emailCount} phones=${phoneCount} skipped=${skippedCount} total=${data.length}`,
      );

      if (data.length === 0) {
        setUploadError("No valid rows found after normalisation and deduplication.");
        return;
      }

      const chunks = chunkData(data);
      const sessionId = Math.floor(Math.random() * 2_147_483_647);

      setUploadProgress({ phase: "uploading", hashedCount: data.length, chunksDone: 0, chunksTotal: chunks.length });

      let resolvedAudienceId: string | undefined =
        mode === "append" ? selectedAudienceId : undefined;
      let totalReceived = 0;
      let totalInvalid = 0;

      for (let i = 0; i < chunks.length; i++) {
        if (abortRef.current) break;

        const isFirst = i === 0;
        const body: Record<string, unknown> = {
          adAccountId,
          mode: isFirst && mode === "create" ? "create" : "append",
          audienceId: resolvedAudienceId,
          audienceName: isFirst && mode === "create" ? audienceName.trim() : undefined,
          audienceDescription:
            isFirst && mode === "create" ? audienceDescription.trim() || undefined : undefined,
          retentionDays: isFirst && mode === "create" ? retentionDays : undefined,
          schema: schema as MatchSchema[],
          data: chunks[i],
          chunkIndex: i,
          totalChunks: chunks.length,
          sessionId,
          estimatedTotal: data.length,
        };

        const res = await fetch("/api/meta/customer-audience-upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = await res.json();

        if (!res.ok) { setUploadError(json.error ?? "Upload failed"); return; }

        if (isFirst && !resolvedAudienceId) resolvedAudienceId = json.audienceId;
        totalReceived += json.numReceived ?? chunks[i].length;
        totalInvalid += json.numInvalid ?? 0;

        setUploadProgress({ phase: "uploading", hashedCount: data.length, chunksDone: i + 1, chunksTotal: chunks.length });
      }

      setUploadResult({
        audienceId: resolvedAudienceId ?? "",
        audienceName: targetAudienceName,
        totalUploaded: totalReceived,
        numInvalid: totalInvalid,
        numChunks: chunks.length,
      });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Unexpected error during upload");
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  };

  const handleClear = () => {
    abortRef.current = true;
    setInstanceKey((k) => k + 1);
    setStep(0); setMode("create");
    setAudienceName(""); setAudienceDescription(""); setRetentionDays(180);
    setSelectedAudienceId(""); setSelectedAudienceName("");
    setFileEntries([]); setFileErrors([]); setColumnMap({});
    setUploading(false); setUploadProgress(null);
    setUploadResult(null); setUploadError(null);
  };

  return (
    <div key={instanceKey} className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href={backHref}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
          </Button>
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="font-heading text-lg tracking-wide">Upload customer audience</h1>
          <p className="text-xs text-muted-foreground">
            {clientName} · Hash &amp; upload email/phone lists to a Meta Custom Audience.
          </p>
        </div>
        {!uploadResult && (
          <Button variant="ghost" size="sm" onClick={handleClear} disabled={uploading}>
            Clear all
          </Button>
        )}
      </div>

      <PiiBanner />
      {!uploadResult && <StepIndicator step={step} />}

      {/* Results */}
      {uploadResult && (
        <div className="space-y-4">
          <div className="rounded-lg border border-success/30 bg-success/5 p-5">
            <div className="mb-3 flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-success" />
              <h2 className="font-medium text-sm">Upload complete</h2>
            </div>
            <dl className="space-y-2 text-sm">
              <div className="flex gap-2">
                <dt className="min-w-[140px] text-muted-foreground">Audience name</dt>
                <dd className="font-medium">{uploadResult.audienceName}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="min-w-[140px] text-muted-foreground">Audience ID</dt>
                <dd className="font-mono text-xs">{uploadResult.audienceId}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="min-w-[140px] text-muted-foreground">Records uploaded</dt>
                <dd className="font-semibold text-success">
                  {uploadResult.totalUploaded.toLocaleString()}
                </dd>
              </div>
              {uploadResult.numInvalid > 0 && (
                <div className="flex gap-2">
                  <dt className="min-w-[140px] text-muted-foreground">Invalid entries</dt>
                  <dd className="text-destructive">{uploadResult.numInvalid.toLocaleString()}</dd>
                </div>
              )}
              <div className="flex gap-2">
                <dt className="min-w-[140px] text-muted-foreground">Chunks sent</dt>
                <dd>{uploadResult.numChunks}</dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">
              Meta typically takes 30–60 minutes to process and activate the audience.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={handleClear}>
              Upload another list
            </Button>
            <Link href={backHref}>
              <Button size="sm">Back to {clientName}</Button>
            </Link>
          </div>
        </div>
      )}

      {/* Step 0 — Mode */}
      {!uploadResult && step === 0 && (
        <div className="space-y-4">
          <div className="space-y-4 rounded-lg border border-border bg-card p-5">
            <h2 className="font-medium text-sm">Choose upload mode</h2>
            <div className="space-y-3">
              <label className="flex cursor-pointer items-start gap-3">
                <input type="radio" name="mode" value="create" checked={mode === "create"} onChange={() => setMode("create")} className="mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Create new audience</p>
                  <p className="text-xs text-muted-foreground">
                    A brand-new Custom Audience will be created on {clientName}&apos;s ad account.
                  </p>
                </div>
              </label>
              <label className="flex cursor-pointer items-start gap-3">
                <input type="radio" name="mode" value="append" checked={mode === "append"} onChange={() => setMode("append")} className="mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Add to existing audience</p>
                  <p className="text-xs text-muted-foreground">
                    Append records to an audience already on the ad account.
                  </p>
                </div>
              </label>
            </div>

            {mode === "create" && (
              <div className="space-y-3 border-t border-border pt-3">
                <div>
                  <label className="text-xs font-medium text-foreground">
                    Audience name <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="text"
                    value={audienceName}
                    onChange={(e) => setAudienceName(e.target.value)}
                    placeholder={`e.g. ${clientName} — Customer upload`}
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-foreground">
                    Description <span className="text-muted-foreground">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={audienceDescription}
                    onChange={(e) => setAudienceDescription(e.target.value)}
                    placeholder="Customers who purchased tickets"
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-foreground">Retention period</label>
                  <select
                    value={retentionDays}
                    onChange={(e) => setRetentionDays(Number(e.target.value))}
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value={30}>30 days</option>
                    <option value={60}>60 days</option>
                    <option value={90}>90 days</option>
                    <option value={180}>180 days</option>
                    <option value={365}>365 days</option>
                  </select>
                </div>
              </div>
            )}

            {mode === "append" && (
              <div className="space-y-3 border-t border-border pt-3">
                {!adAccountId ? (
                  <p className="text-xs text-destructive">
                    {clientName} has no Meta ad account configured.{" "}
                    <Link href={`/clients/${clientId}/edit`} className="underline">Add one in Edit</Link> first.
                  </p>
                ) : existingLoading ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading audiences…
                  </div>
                ) : existingError ? (
                  <p className="text-xs text-destructive">{existingError}</p>
                ) : existingAudiences.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No custom audiences found on this ad account.</p>
                ) : (
                  <div>
                    <label className="text-xs font-medium text-foreground">
                      Select audience <span className="text-destructive">*</span>
                    </label>
                    <select
                      value={selectedAudienceId}
                      onChange={(e) => setSelectedAudienceId(e.target.value)}
                      className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="">— pick an audience —</option>
                      {existingAudiences.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                          {a.approximateSize != null ? ` (~${a.approximateSize.toLocaleString()})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <Button size="sm" onClick={() => setStep(1)} disabled={!step0Valid || !adAccountId}>
              Continue <ChevronRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </div>

          {!adAccountId && (
            <p className="text-center text-xs text-destructive">
              {clientName} has no Meta ad account configured.{" "}
              <Link href={`/clients/${clientId}/edit`} className="underline">Add one in Edit</Link>.
            </p>
          )}
        </div>
      )}

      {/* Step 1 — Upload files */}
      {!uploadResult && step === 1 && (
        <div className="space-y-4">
          <div className="space-y-4 rounded-lg border border-border bg-card p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-medium text-sm">Upload CSV files</h2>
              <Button variant="ghost" size="sm" onClick={() => setStep(0)}>
                <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
              </Button>
            </div>

            <DropZone onFiles={handleFiles} />

            {fileErrors.length > 0 && (
              <div className="space-y-1">
                {fileErrors.map((e, i) => (
                  <p key={i} className="text-xs text-destructive">{e}</p>
                ))}
              </div>
            )}

            {fileEntries.length > 0 && (
              <ul className="space-y-2">
                {fileEntries.map((entry) => (
                  <li key={entry.file.name} className="flex items-start gap-3 rounded-md border border-border px-3 py-2.5 text-xs">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{entry.file.name}</p>
                      {entry.status === "parsing" && <p className="text-muted-foreground">Parsing…</p>}
                      {entry.status === "done" && entry.parsed && (
                        <p className="text-muted-foreground">
                          {entry.parsed.rowCount.toLocaleString()} rows · {entry.parsed.headers.join(", ")}
                        </p>
                      )}
                      {entry.status === "error" && <p className="text-destructive">{entry.error}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      {entry.status === "parsing" && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                      {entry.status === "done" && <CheckCircle2 className="h-3.5 w-3.5 text-success" />}
                      {entry.status === "error" && <AlertCircle className="h-3.5 w-3.5 text-destructive" />}
                      <button onClick={() => removeFile(entry.file)} className="text-muted-foreground hover:text-foreground" aria-label="Remove file">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {step1Valid && (
              <p className="text-xs text-muted-foreground">
                Total: {totalRawRows.toLocaleString()} raw rows across {parsedFiles.length} file{parsedFiles.length !== 1 ? "s" : ""}
              </p>
            )}
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setStep(2)} disabled={!step1Valid}>
              Map columns <ChevronRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 2 — Column mapping */}
      {!uploadResult && step === 2 && (
        <div className="space-y-4">
          <div className="space-y-4 rounded-lg border border-border bg-card p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-medium text-sm">Map columns</h2>
              <Button variant="ghost" size="sm" onClick={() => setStep(1)}>
                <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Assign each detected column to <strong>email</strong>, <strong>phone</strong>, or <strong>skip</strong>.
              Only one column can be mapped to each match key.
            </p>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="pb-2 text-left font-medium text-muted-foreground">Column</th>
                  <th className="pb-2 text-left font-medium text-muted-foreground">Map to</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {allHeaders.map((h) => (
                  <tr key={h}>
                    <td className="py-2 pr-4 font-mono">{h}</td>
                    <td className="py-2">
                      <select
                        value={columnMap[h] ?? "skip"}
                        onChange={(e) => {
                          const newRole = e.target.value as ColumnRole;
                          setColumnMap((prev) => {
                            const next = { ...prev };
                            if (newRole !== "skip") {
                              for (const [key, role] of Object.entries(next)) {
                                if (role === newRole && key !== h) next[key] = "skip";
                              }
                            }
                            next[h] = newRole;
                            return next;
                          });
                        }}
                        className="rounded border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        <option value="skip">Skip</option>
                        <option value="email">Email</option>
                        <option value="phone">Phone</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!step2Valid && (
              <p className="text-xs text-destructive">Map at least one column to email or phone to continue.</p>
            )}
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setStep(3)} disabled={!step2Valid}>
              Review <ChevronRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 3 — Review & upload */}
      {!uploadResult && step === 3 && (
        <div className="space-y-4">
          <div className="space-y-4 rounded-lg border border-border bg-card p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-medium text-sm">Review &amp; upload</h2>
              <Button variant="ghost" size="sm" onClick={() => setStep(2)} disabled={uploading}>
                <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
              </Button>
            </div>
            <dl className="space-y-2 text-sm">
              <div className="flex gap-2">
                <dt className="min-w-[140px] text-muted-foreground">Client</dt>
                <dd className="font-medium">{clientName}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="min-w-[140px] text-muted-foreground">Ad account</dt>
                <dd className="font-mono text-xs">{adAccountId}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="min-w-[140px] text-muted-foreground">Target audience</dt>
                <dd className="font-medium">{targetAudienceName || "(new audience)"}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="min-w-[140px] text-muted-foreground">Source files</dt>
                <dd>{parsedFiles.length} file{parsedFiles.length !== 1 ? "s" : ""}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="min-w-[140px] text-muted-foreground">Raw rows</dt>
                <dd>{totalRawRows.toLocaleString()} (deduplicated after hashing)</dd>
              </div>
              <div className="flex gap-2">
                <dt className="min-w-[140px] text-muted-foreground">Match keys</dt>
                <dd>{[emailCol && "Email", phoneCol && "Phone"].filter(Boolean).join(" + ")}</dd>
              </div>
              {mode === "create" && (
                <div className="flex gap-2">
                  <dt className="min-w-[140px] text-muted-foreground">Retention</dt>
                  <dd>{retentionDays} days</dd>
                </div>
              )}
            </dl>

            {uploading && uploadProgress && (
              <div className="space-y-1 rounded-md border border-border bg-muted/30 px-3 py-2.5 text-xs">
                {uploadProgress.phase === "hashing" ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Hashing rows in browser… (counts only, no values)</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>
                      Uploading chunk {uploadProgress.chunksDone + 1} of {uploadProgress.chunksTotal} —{" "}
                      {uploadProgress.hashedCount.toLocaleString()} hashed rows total
                    </span>
                  </div>
                )}
              </div>
            )}

            {uploadError && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                {uploadError}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            {uploading && (
              <Button variant="outline" size="sm" onClick={() => { abortRef.current = true; }}>
                Cancel
              </Button>
            )}
            <Button onClick={handleUpload} disabled={uploading} size="sm">
              {uploading ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Uploading…</>
              ) : (
                "Upload to Meta"
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
