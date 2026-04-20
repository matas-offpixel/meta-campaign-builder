"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  Loader2,
  Music2,
  UploadCloud,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type {
  TikTokAccount,
  TikTokDemographicRow,
  TikTokGeoRow,
  TikTokImportResult,
  TikTokInterestRow,
  TikTokManualReportSnapshot,
  TikTokSearchTermRow,
  TikTokVertical,
} from "@/lib/types/tiktok";

const TIKTOK_PINK = "#FF0050";

interface Props {
  eventId: string;
  /** UUID of the client owning the event — required by the import POST. */
  clientId: string;
  /**
   * Server-resolved current TikTok account FK on the event row. Null
   * when the event is not yet linked. Once Slice 5 lands, the linker
   * dropdown also accepts the inherited client-level account as a
   * fallback — for now we link directly per-event.
   */
  initialTikTokAccountId: string | null;
}

interface LatestReport {
  id: string;
  campaign_name: string;
  date_range_start: string;
  date_range_end: string;
  imported_at: string;
  snapshot: TikTokManualReportSnapshot;
}

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
  const [error, setError] = useState<string | null>(null);

  // Latest manual report — fetched once we're in the linked state.
  const [report, setReport] = useState<LatestReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);

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

  useEffect(() => {
    let cancelled = false;
    if (accountId !== null) return;
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
  }, [accountId]);

  useEffect(() => {
    if (accountId === null) return;
    void fetchReport();
  }, [accountId, fetchReport]);

  const handleLink = async (newAccountId: string) => {
    if (!newAccountId) return;
    setLinkingPending(true);
    setError(null);
    setAccountId(newAccountId);
    setLinkingPending(false);
  };

  const linkedAccount = accountId
    ? (accounts?.find((a) => a.id === accountId) ?? null)
    : null;

  // ── Unlinked state — same picker as the placeholder ────────────────
  if (!accountId) {
    return (
      <section className="rounded-md border border-border bg-card p-5">
        <div className="mb-3 flex items-start gap-3">
          <Music2 className="mt-0.5 h-4 w-4" style={{ color: TIKTOK_PINK }} />
          <div className="min-w-0">
            <h2 className="font-heading text-base tracking-wide">TikTok</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Link this event to a TikTok account to surface paid spend
              and creative performance alongside Meta.
            </p>
          </div>
        </div>

        {accountsLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading TikTok accounts…
          </div>
        ) : accounts && accounts.length > 0 ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-56 flex-1">
              <Select
                id={`tiktok-link-${eventId}`}
                label="Link TikTok account"
                placeholder="Select an account…"
                options={accounts.map((a) => ({
                  value: a.id,
                  label: a.account_name,
                }))}
                onChange={(e) => handleLink(e.target.value)}
                disabled={linkingPending}
                defaultValue=""
              />
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No TikTok account linked. Add one in Settings → TikTok once
            the platform OAuth flow is connected.
          </p>
        )}

        {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
      </section>
    );
  }

  // ── Linked state ───────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <section className="rounded-md border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Music2
              className="mt-0.5 h-4 w-4"
              style={{ color: TIKTOK_PINK }}
            />
            <div className="min-w-0">
              <h2 className="font-heading text-base tracking-wide">TikTok</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Linked to{" "}
                <span className="font-medium text-foreground">
                  {linkedAccount?.account_name ?? "a TikTok account"}
                </span>
                . Drop your weekly TikTok Ads Manager exports below — the
                parser auto-detects each sheet&apos;s shape.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setAccountId(null)}
          >
            Unlink
          </Button>
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
// Report view — stat cards + breakdown sections
// ─────────────────────────────────────────────────────────────────────────────

function ReportView({ report }: { report: LatestReport }) {
  const { snapshot } = report;
  const c = snapshot.campaign;
  const currency = c?.currency ?? "GBP";

  const cards = [
    {
      label: "Impressions",
      value: fmtInt(c?.impressions ?? null, c?.impressions_raw ?? null),
    },
    { label: "Reach", value: fmtInt(c?.reach ?? null) },
    { label: "Spend", value: fmtMoney(c?.cost ?? null, currency) },
    {
      label: "Video views (2s)",
      value: fmtInt(c?.video_views_2s ?? null),
    },
    {
      label: "Clicks (dest)",
      value: fmtInt(c?.clicks_destination ?? null),
    },
    { label: "CPM", value: fmtMoney(c?.cpm ?? null, currency) },
    {
      label: "CPC (dest)",
      value: fmtMoney(c?.cpc_destination ?? null, currency),
    },
    {
      label: "CTR (dest)",
      value: fmtPct(c?.ctr_destination ?? null),
    },
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-md border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="font-heading text-sm tracking-wide">
              {report.campaign_name}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {fmtDate(report.date_range_start)} —{" "}
              {fmtDate(report.date_range_end)} · imported{" "}
              {fmtRelative(report.imported_at)}
            </p>
          </div>
          {c?.primary_status && (
            <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
              {c.primary_status}
            </span>
          )}
        </div>
      </section>

      <section
        className="grid grid-cols-2 gap-3 md:grid-cols-4"
        aria-label="TikTok campaign stats"
      >
        {cards.map((card) => (
          <StatCard key={card.label} label={card.label} value={card.value} />
        ))}
      </section>

      <BreakdownSection title="Top regions" defaultOpen>
        <GeoTable rows={snapshot.geo} currency={currency} />
      </BreakdownSection>

      <BreakdownSection title="Demographics">
        <DemographicTable rows={snapshot.demographics} currency={currency} />
      </BreakdownSection>

      <BreakdownSection title="Top interests">
        <InterestGroupedTable rows={snapshot.interests} currency={currency} />
      </BreakdownSection>

      <BreakdownSection title="Top search terms">
        <SearchTermGroupedTable
          rows={snapshot.searchTerms}
          currency={currency}
        />
      </BreakdownSection>
    </div>
  );
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold text-foreground tabular-nums">
        {value}
      </p>
    </div>
  );
}

function BreakdownSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-md border border-border bg-card">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-5 py-3 text-left"
        onClick={() => setOpen((s) => !s)}
      >
        <h3 className="font-heading text-sm tracking-wide">{title}</h3>
        {open ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      {open && <div className="border-t border-border px-5 py-4">{children}</div>}
    </section>
  );
}

function GeoTable({
  rows,
  currency,
}: {
  rows: TikTokGeoRow[];
  currency: string;
}) {
  if (rows.length === 0) return <EmptyBreakdown label="No geo rows in snapshot." />;
  const top = [...rows]
    .sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0))
    .slice(0, 10);
  return (
    <BreakdownTable
      headers={["Region", "Type", "Spend", "Impr.", "Clicks", "CTR"]}
      rows={top.map((r) => [
        r.region_name,
        r.region_type,
        fmtMoney(r.cost, currency),
        fmtInt(r.impressions, r.impressions_raw),
        fmtInt(r.clicks_destination),
        fmtPct(r.ctr_destination),
      ])}
    />
  );
}

function DemographicTable({
  rows,
  currency,
}: {
  rows: TikTokDemographicRow[];
  currency: string;
}) {
  if (rows.length === 0)
    return <EmptyBreakdown label="No demographic rows in snapshot." />;
  const sorted = [...rows].sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0));
  return (
    <BreakdownTable
      headers={["Age", "Gender", "Spend", "Impr.", "Clicks", "CTR"]}
      rows={sorted.map((r) => [
        r.age_bucket,
        r.gender,
        fmtMoney(r.cost, currency),
        fmtInt(r.impressions, r.impressions_raw),
        fmtInt(r.clicks_destination),
        fmtPct(r.ctr_destination),
      ])}
    />
  );
}

function InterestGroupedTable({
  rows,
  currency,
}: {
  rows: TikTokInterestRow[];
  currency: string;
}) {
  if (rows.length === 0)
    return <EmptyBreakdown label="No interest rows in snapshot." />;
  const grouped = groupBy(rows, (r) => r.vertical ?? "other");
  return (
    <div className="space-y-4">
      {Array.from(grouped.entries()).map(([vertical, list]) => (
        <div key={vertical}>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {labelForVertical(vertical)}
          </h4>
          <BreakdownTable
            headers={["Audience", "Spend", "Impr.", "Clicks", "CTR"]}
            rows={[...list]
              .sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0))
              .slice(0, 10)
              .map((r) => [
                r.audience_label,
                fmtMoney(r.cost, currency),
                fmtInt(r.impressions, r.impressions_raw),
                fmtInt(r.clicks_destination),
                fmtPct(r.ctr_destination),
              ])}
          />
        </div>
      ))}
    </div>
  );
}

function SearchTermGroupedTable({
  rows,
  currency,
}: {
  rows: TikTokSearchTermRow[];
  currency: string;
}) {
  if (rows.length === 0)
    return <EmptyBreakdown label="No search-term rows in snapshot." />;
  const grouped = groupBy(rows, (r) => r.theme_bucket ?? "__unbucketed__");
  return (
    <div className="space-y-4">
      {Array.from(grouped.entries()).map(([bucket, list]) => (
        <div key={bucket}>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {bucket === "__unbucketed__" ? "Other" : bucket}
          </h4>
          <BreakdownTable
            headers={["Search term", "Spend", "Impr.", "Clicks", "CTR"]}
            rows={[...list]
              .sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0))
              .slice(0, 10)
              .map((r) => [
                r.search_term,
                fmtMoney(r.cost, currency),
                fmtInt(r.impressions, r.impressions_raw),
                fmtInt(r.clicks_destination),
                fmtPct(r.ctr_destination),
              ])}
          />
        </div>
      ))}
    </div>
  );
}

function BreakdownTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: (string | number)[][];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
            {headers.map((h, i) => (
              <th
                key={h}
                className={`pb-2 ${i === 0 ? "" : "text-right"}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr
              key={ri}
              className="border-t border-border/40 text-foreground"
            >
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className={`py-1.5 tabular-nums ${ci === 0 ? "" : "text-right"}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyBreakdown({ label }: { label: string }) {
  return <p className="text-xs text-muted-foreground">{label}</p>;
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

// ─────────────────────────────────────────────────────────────────────────────
// Format helpers
// ─────────────────────────────────────────────────────────────────────────────

function fmtInt(n: number | null, raw?: string | null): string {
  if (raw) return raw; // preserve TikTok's "<5" mask verbatim
  if (n == null) return "—";
  return Math.round(n).toLocaleString();
}

function fmtMoney(n: number | null, currency: string): string {
  if (n == null) return "—";
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return n.toLocaleString();
  }
}

function fmtPct(n: number | null): string {
  // TikTok exports already encode percentages on the display scale
  // (e.g. "1.23%" → 1.23), so we just append "%".
  if (n == null) return "—";
  return `${n.toFixed(2)}%`;
}

function fmtDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fmtRelative(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diffMs = Date.now() - d.getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
  });
}

function groupBy<T, K>(items: readonly T[], keyOf: (item: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const list = out.get(key);
    if (list) list.push(item);
    else out.set(key, [item]);
  }
  return out;
}

const VERTICAL_LABELS: Record<TikTokVertical | "other", string> = {
  music_entertainment: "Music & entertainment",
  games: "Games",
  lifestyle: "Lifestyle",
  food_drink: "Food & drink",
  beauty_fashion: "Beauty & fashion",
  travel: "Travel",
  shopping_commerce: "Shopping",
  tech: "Tech",
  sports_fitness: "Sports & fitness",
  other: "Other",
};

function labelForVertical(value: string): string {
  if (value in VERTICAL_LABELS) {
    return VERTICAL_LABELS[value as keyof typeof VERTICAL_LABELS];
  }
  return value;
}
