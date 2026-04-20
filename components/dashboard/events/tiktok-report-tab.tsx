"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  Music2,
  UploadCloud,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  TikTokReportBlock,
  type TikTokReportBlockData,
} from "@/components/report/tiktok-report-block";
import type {
  TikTokAccount,
  TikTokImportResult,
} from "@/lib/types/tiktok";

const TIKTOK_PINK = "#FF0050";

interface Props {
  eventId: string;
  /** UUID of the client owning the event — required by the import POST. */
  clientId: string;
  /**
   * Server-resolved current TikTok account FK on the event row. Null
   * when the event is not yet linked. Account linkage is now purely
   * metadata — the report itself keys off `event_id`, so an unlinked
   * event still renders the import dropzone and any existing snapshot.
   */
  initialTikTokAccountId: string | null;
}

type LatestReport = TikTokReportBlockData;

// ─────────────────────────────────────────────────────────────────────────────
// Top-level component
// ─────────────────────────────────────────────────────────────────────────────

export function TikTokReportTab({
  eventId,
  clientId,
  initialTikTokAccountId,
}: Props) {
  const [accountId, setAccountId] = useState<string | null>(
    initialTikTokAccountId,
  );
  const [accounts, setAccounts] = useState<TikTokAccount[] | null>(null);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [linkingPending, setLinkingPending] = useState(false);

  const [report, setReport] = useState<LatestReport | null>(null);
  const [reportLoading, setReportLoading] = useState(true);

  const fetchReport = useCallback(async () => {
    setReportLoading(true);
    try {
      const r = await fetch(
        `/api/tiktok/reports/latest?event_id=${encodeURIComponent(eventId)}`,
      );
      const json = await r.json();
      if (json?.ok) setReport((json.report as LatestReport | null) ?? null);
      else setReport(null);
    } catch {
      setReport(null);
    } finally {
      setReportLoading(false);
    }
  }, [eventId]);

  // Always fetch the latest snapshot — the report keys off event_id, not
  // account_id, so account-linkage state is irrelevant here.
  useEffect(() => {
    void fetchReport();
  }, [fetchReport]);

  // Account list is needed for the metadata linker section. Fetch once on
  // mount; the linker stays mounted regardless of account state.
  useEffect(() => {
    let cancelled = false;
    setAccountsLoading(true);
    fetch("/api/tiktok/accounts")
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json?.ok) setAccounts(json.accounts as TikTokAccount[]);
        else setAccounts([]);
      })
      .catch(() => {
        if (!cancelled) setAccounts([]);
      })
      .finally(() => {
        if (!cancelled) setAccountsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLink = async (newAccountId: string) => {
    if (!newAccountId) return;
    setLinkingPending(true);
    setAccountId(newAccountId);
    setLinkingPending(false);
  };

  const linkedAccount = accountId
    ? (accounts?.find((a) => a.id === accountId) ?? null)
    : null;

  return (
    <div className="space-y-6">
      <section className="rounded-md border border-border bg-card p-5">
        <div className="flex items-start gap-3">
          <Music2
            className="mt-0.5 h-4 w-4"
            style={{ color: TIKTOK_PINK }}
          />
          <div className="min-w-0">
            <h2 className="font-heading text-base tracking-wide">TikTok</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Drop your weekly TikTok Ads Manager exports below — the
              parser auto-detects each sheet&apos;s shape and keys the
              snapshot off this event.
            </p>
          </div>
        </div>
      </section>

      <ImportDropzone
        eventId={eventId}
        clientId={clientId}
        defaultCampaignName={report?.campaign_name ?? ""}
        defaultStart={report?.date_range_start ?? ""}
        defaultEnd={report?.date_range_end ?? ""}
        onImported={() => void fetchReport()}
      />

      <AccountLinkerCard
        eventId={eventId}
        accounts={accounts}
        accountsLoading={accountsLoading}
        linkedAccount={linkedAccount}
        linkingPending={linkingPending}
        onLink={handleLink}
        onUnlink={() => setAccountId(null)}
      />

      {reportLoading ? (
        <section className="flex items-center gap-2 rounded-md border border-border bg-card p-5 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading latest report…
        </section>
      ) : report ? (
        <ReportView report={report} />
      ) : (
        <EmptyReportState />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Account linker — metadata only, never blocks render.
// ─────────────────────────────────────────────────────────────────────────────

interface AccountLinkerProps {
  eventId: string;
  accounts: TikTokAccount[] | null;
  accountsLoading: boolean;
  linkedAccount: TikTokAccount | null;
  linkingPending: boolean;
  onLink: (id: string) => void;
  onUnlink: () => void;
}

function AccountLinkerCard({
  eventId,
  accounts,
  accountsLoading,
  linkedAccount,
  linkingPending,
  onLink,
  onUnlink,
}: AccountLinkerProps) {
  return (
    <section className="rounded-md border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-heading text-xs uppercase tracking-wider text-muted-foreground">
            TikTok account
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {linkedAccount ? (
              <>
                Linked to{" "}
                <span className="font-medium text-foreground">
                  {linkedAccount.account_name}
                </span>
                . Reports import either way — this is metadata for future
                API integration.
              </>
            ) : (
              "Optional. The manual report import works regardless; linking helps once OAuth lands."
            )}
          </p>
        </div>
        {linkedAccount ? (
          <Button size="sm" variant="ghost" onClick={onUnlink}>
            Unlink
          </Button>
        ) : accountsLoading ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading…
          </span>
        ) : accounts && accounts.length > 0 ? (
          <div className="min-w-56">
            <Select
              id={`tiktok-link-${eventId}`}
              label=""
              placeholder="Link an account…"
              options={accounts.map((a) => ({
                value: a.id,
                label: a.account_name,
              }))}
              onChange={(e) => onLink(e.target.value)}
              disabled={linkingPending}
              defaultValue=""
            />
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">
            No TikTok accounts configured yet.
          </span>
        )}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Import dropzone
// ─────────────────────────────────────────────────────────────────────────────

interface DropzoneProps {
  eventId: string;
  clientId: string;
  defaultCampaignName: string;
  defaultStart: string;
  defaultEnd: string;
  onImported: () => void;
}

function ImportDropzone({
  eventId,
  clientId,
  defaultCampaignName,
  defaultStart,
  defaultEnd,
  onImported,
}: DropzoneProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [campaignName, setCampaignName] = useState(defaultCampaignName);
  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(defaultEnd);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<TikTokImportResult | null>(null);

  useEffect(() => {
    if (defaultCampaignName && !campaignName) setCampaignName(defaultCampaignName);
    if (defaultStart && !start) setStart(defaultStart);
    if (defaultEnd && !end) setEnd(defaultEnd);
    // Hydrate from latest report only on first mount-with-data; we don't
    // want to clobber what the user has already typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultCampaignName, defaultStart, defaultEnd]);

  const handleFiles = (next: FileList | null) => {
    if (!next) return;
    const arr = Array.from(next).filter((f) =>
      f.name.toLowerCase().endsWith(".xlsx"),
    );
    setFiles(arr.slice(0, 7));
    setResult(null);
  };

  const canSubmit =
    !submitting &&
    files.length > 0 &&
    campaignName.trim().length > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(start) &&
    /^\d{4}-\d{2}-\d{2}$/.test(end);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("event_id", eventId);
      fd.append("client_id", clientId);
      fd.append("campaign_name", campaignName.trim());
      fd.append("date_range_start", start);
      fd.append("date_range_end", end);
      for (const f of files) fd.append("files", f);

      const r = await fetch("/api/tiktok/import", {
        method: "POST",
        body: fd,
      });
      const json = (await r.json()) as TikTokImportResult;
      setResult(json);
      if (json.ok) {
        setFiles([]);
        onImported();
      }
    } catch (err) {
      setResult({
        ok: false,
        error: {
          reason: "persist_failed",
          message:
            err instanceof Error ? err.message : "Network error during import.",
        },
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="rounded-md border border-border bg-card p-5">
      <div className="mb-4 flex items-start gap-3">
        <UploadCloud
          className="mt-0.5 h-4 w-4"
          style={{ color: TIKTOK_PINK }}
        />
        <div className="min-w-0">
          <h3 className="font-heading text-sm tracking-wide">
            Import TikTok report
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Drop up to 7 .xlsx files (campaign, ad, geo, demographic,
            interest, search-term). Re-importing the same campaign +
            window replaces the snapshot in place.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Input
          id="tiktok-import-campaign"
          label="Campaign name"
          placeholder="[BB26-RIANBRAZIL]"
          value={campaignName}
          onChange={(e) => setCampaignName(e.target.value)}
        />
        <Input
          id="tiktok-import-start"
          label="From"
          type="date"
          value={start}
          onChange={(e) => setStart(e.target.value)}
        />
        <Input
          id="tiktok-import-end"
          label="To"
          type="date"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
        />
      </div>

      <label
        className="mt-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border-strong bg-background px-4 py-6 text-xs text-muted-foreground hover:bg-muted/50"
        htmlFor="tiktok-import-files"
      >
        <FileSpreadsheet className="h-5 w-5" style={{ color: TIKTOK_PINK }} />
        <span>
          {files.length > 0
            ? `${files.length} file${files.length > 1 ? "s" : ""} selected`
            : "Click or drop .xlsx files here (max 7)"}
        </span>
        <input
          id="tiktok-import-files"
          type="file"
          multiple
          accept=".xlsx"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </label>

      {files.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
          {files.map((f) => (
            <li key={f.name} className="flex items-center gap-2">
              <FileSpreadsheet className="h-3.5 w-3.5" />
              <span className="truncate">{f.name}</span>
              <span className="text-[10px] tabular-nums">
                {Math.round(f.size / 1024)} KB
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex items-center justify-end gap-2">
        <Button
          size="sm"
          variant="primary"
          onClick={handleSubmit}
          disabled={!canSubmit}
        >
          {submitting ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Importing…
            </>
          ) : (
            "Import"
          )}
        </Button>
      </div>

      {result && <ImportResultBanner result={result} />}
    </section>
  );
}

function ImportResultBanner({ result }: { result: TikTokImportResult }) {
  if (result.ok) {
    return (
      <div className="mt-4 space-y-2 rounded-md border border-border bg-background p-3 text-xs">
        <div className="flex items-center gap-2 text-emerald-600">
          <CheckCircle2 className="h-3.5 w-3.5" />
          <span className="font-medium">
            Imported — {result.detected_files.length} file
            {result.detected_files.length === 1 ? "" : "s"} parsed.
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {result.detected_files.map((f) => (
            <span
              key={f.name}
              className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700"
            >
              {f.shape} ✓
            </span>
          ))}
          {result.skipped.map((s) => (
            <span
              key={s.name}
              className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700"
              title={s.reason}
            >
              {s.name} skipped
            </span>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="mt-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
      <XCircle className="mt-0.5 h-3.5 w-3.5" />
      <div className="min-w-0">
        <p className="font-medium">Import failed ({result.error.reason})</p>
        <p className="mt-0.5 text-destructive/80">{result.error.message}</p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Report view — thin wrapper around the shared TikTokReportBlock so internal
// dashboard + public share render identical JSX.
// ─────────────────────────────────────────────────────────────────────────────

function ReportView({ report }: { report: LatestReport }) {
  return <TikTokReportBlock data={report} />;
}

function EmptyReportState() {
  return (
    <section className="rounded-md border border-dashed border-border-strong bg-card p-8 text-center">
      <Music2
        className="mx-auto mb-2 h-6 w-6"
        style={{ color: TIKTOK_PINK }}
      />
      <p className="font-heading text-sm tracking-wide">
        No TikTok report imported yet
      </p>
      <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
        Drop your latest TikTok Ads Manager XLSX exports into the
        dropzone above to populate this view.
      </p>
    </section>
  );
}
