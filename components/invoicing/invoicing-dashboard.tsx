"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  Plus,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  SERVICE_TIER_LABEL,
  SETTLEMENT_TIMING_LABEL,
} from "@/lib/pricing/calculator";
import type {
  InvoiceRow,
  InvoiceStatus,
  InvoiceType,
  InvoiceWithRefs,
  QuoteStatus,
  QuoteWithRefs,
} from "@/lib/types/invoicing";

// ─────────────────────────────────────────────────────────────────────────────
// Master invoicing dashboard.
//
// Pure client-side: data is server-fetched once, all filtering / sorting /
// grouping happens in memory. Status mutations call the existing
// /api/invoicing/invoices/[id] PATCH route then router.refresh() to pull
// the fresh server snapshot.
//
// Three tabs share the same dataset:
//   - all      flat invoice list with multi-filter
//   - quotes   quote-centric view with action buttons per row
//   - by_client per-client expanders with mini totals
// ─────────────────────────────────────────────────────────────────────────────

const GBP = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 2,
});

const GBP0 = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});

function formatGBP(value: number | null | undefined, dp = 2): string {
  if (value == null) return "—";
  return (dp === 0 ? GBP0 : GBP).format(Number(value));
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
  });
}

function isoMonth(value: string | null): string | null {
  if (!value) return null;
  return value.slice(0, 7);
}

function isOverdue(inv: InvoiceRow): boolean {
  if (inv.status !== "sent") return false;
  if (!inv.due_date) return false;
  const due = new Date(inv.due_date);
  if (Number.isNaN(due.getTime())) return false;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return due < today;
}

const STATUS_ORDER: InvoiceStatus[] = [
  "draft",
  "sent",
  "paid",
  "overdue",
  "cancelled",
];

const TYPE_ORDER: InvoiceType[] = [
  "upfront",
  "settlement",
  "retainer",
  "sell_out_bonus",
  "other",
];

const TYPE_LABEL: Record<InvoiceType, string> = {
  upfront: "Upfront",
  settlement: "Settlement",
  retainer: "Retainer",
  sell_out_bonus: "Sell-out bonus",
  other: "Other",
};

const STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  paid: "Paid",
  overdue: "Overdue",
  cancelled: "Cancelled",
};

const STATUS_TONE: Record<InvoiceStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  sent: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-300",
  paid: "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-300",
  overdue: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-300",
  cancelled: "bg-muted text-muted-foreground line-through",
};

const QUOTE_STATUS_TONE: Record<QuoteStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  approved: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-300",
  converted: "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-300",
  cancelled: "bg-muted text-muted-foreground line-through",
};

type DashboardTab = "all" | "quotes" | "by_client";

interface Props {
  invoices: InvoiceWithRefs[];
  quotes: QuoteWithRefs[];
  initialTab?: DashboardTab;
  initialStatusFilter?: InvoiceStatus | null;
}

export function InvoicingDashboard({
  invoices: initialInvoices,
  quotes,
  initialTab = "all",
  initialStatusFilter = null,
}: Props) {
  const router = useRouter();
  const [invoices, setInvoices] = useState<InvoiceWithRefs[]>(initialInvoices);
  const [tab, setTab] = useState<DashboardTab>(initialTab);
  const [statusFilter, setStatusFilter] = useState<Set<InvoiceStatus>>(
    initialStatusFilter ? new Set([initialStatusFilter]) : new Set(),
  );
  const [typeFilter, setTypeFilter] = useState<Set<InvoiceType>>(new Set());
  const [clientFilter, setClientFilter] = useState<string | null>(null);
  const [monthFilter, setMonthFilter] = useState<string>("");

  const overdueCount = invoices.filter((i) => isOverdue(i)).length;

  // Stat strip
  const totalInvoiced = invoices
    .filter((i) => i.status !== "cancelled")
    .reduce((sum, i) => sum + Number(i.amount_excl_vat ?? 0), 0);
  const totalPaid = invoices
    .filter((i) => i.status === "paid")
    .reduce((sum, i) => sum + Number(i.amount_excl_vat ?? 0), 0);
  const outstanding = invoices
    .filter((i) => i.status === "sent" && !isOverdue(i))
    .reduce((sum, i) => sum + Number(i.amount_excl_vat ?? 0), 0);
  const overdueTotal = invoices
    .filter((i) => isOverdue(i))
    .reduce((sum, i) => sum + Number(i.amount_excl_vat ?? 0), 0);

  // Distinct clients for the dropdown
  const clientOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const inv of invoices) {
      if (inv.client_id && !map.has(inv.client_id)) {
        map.set(inv.client_id, inv.client_name ?? "Unknown client");
      }
    }
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [invoices]);

  // All Invoices filter pipeline
  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      if (clientFilter && inv.client_id !== clientFilter) return false;
      if (statusFilter.size > 0) {
        const effective = isOverdue(inv) ? "overdue" : inv.status;
        if (!statusFilter.has(effective)) return false;
      }
      if (typeFilter.size > 0 && !typeFilter.has(inv.invoice_type)) {
        return false;
      }
      if (monthFilter && isoMonth(inv.issued_date ?? inv.due_date) !== monthFilter) {
        return false;
      }
      return true;
    });
  }, [invoices, clientFilter, statusFilter, typeFilter, monthFilter]);

  function toggleStatus(s: InvoiceStatus) {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }
  function toggleType(t: InvoiceType) {
    setTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }

  async function patchInvoice(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/invoicing/invoices/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as
      | { ok: true; invoice: InvoiceRow }
      | { ok: false; error: string };
    if (!res.ok || !("ok" in json) || !json.ok) {
      throw new Error(
        "ok" in json && !json.ok ? json.error : "Failed to update invoice.",
      );
    }
    setInvoices((prev) =>
      prev.map((row) =>
        row.id === id
          ? {
              ...row,
              ...json.invoice,
              client_name: row.client_name,
              event_name: row.event_name,
            }
          : row,
      ),
    );
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {/* SUMMARY STRIP */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Invoiced"
          value={formatGBP(totalInvoiced, 0)}
          tone="default"
          onClick={() => {
            setTab("all");
            setStatusFilter(new Set());
          }}
        />
        <StatCard
          label="Paid"
          value={formatGBP(totalPaid, 0)}
          tone="green"
          onClick={() => {
            setTab("all");
            setStatusFilter(new Set(["paid"]));
          }}
        />
        <StatCard
          label="Outstanding"
          value={formatGBP(outstanding, 0)}
          tone="blue"
          onClick={() => {
            setTab("all");
            setStatusFilter(new Set(["sent"]));
          }}
        />
        <StatCard
          label={`Overdue${overdueCount ? ` (${overdueCount})` : ""}`}
          value={formatGBP(overdueTotal, 0)}
          tone={overdueCount > 0 ? "red" : "default"}
          onClick={() => {
            setTab("all");
            setStatusFilter(new Set(["overdue"]));
          }}
        />
      </div>

      {/* TABS */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border">
        <TabButton
          active={tab === "all"}
          onClick={() => setTab("all")}
          label={`All Invoices (${invoices.length})`}
        />
        <TabButton
          active={tab === "quotes"}
          onClick={() => setTab("quotes")}
          label={`Quotes (${quotes.length})`}
        />
        <TabButton
          active={tab === "by_client"}
          onClick={() => setTab("by_client")}
          label={`By Client (${clientOptions.length})`}
        />
        <div className="ml-auto pb-2">
          <Link href="/invoicing/quotes/new">
            <Button size="sm">
              <Plus className="h-3.5 w-3.5" />
              New quote
            </Button>
          </Link>
        </div>
      </div>

      {tab === "all" && (
        <AllInvoicesTab
          invoices={filteredInvoices}
          clientOptions={clientOptions}
          statusFilter={statusFilter}
          typeFilter={typeFilter}
          clientFilter={clientFilter}
          monthFilter={monthFilter}
          setMonthFilter={setMonthFilter}
          setClientFilter={setClientFilter}
          toggleStatus={toggleStatus}
          toggleType={toggleType}
          onClearFilters={() => {
            setStatusFilter(new Set());
            setTypeFilter(new Set());
            setClientFilter(null);
            setMonthFilter("");
          }}
          onPatch={patchInvoice}
        />
      )}

      {tab === "quotes" && <QuotesTab quotes={quotes} />}

      {tab === "by_client" && (
        <ByClientTab
          invoices={invoices}
          clientOptions={clientOptions}
          onPatch={patchInvoice}
        />
      )}
    </div>
  );
}

// ─── Summary card ──────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  tone,
  onClick,
}: {
  label: string;
  value: string;
  tone: "default" | "green" | "blue" | "red";
  onClick?: () => void;
}) {
  const toneClass =
    tone === "green"
      ? "border-green-200 dark:border-green-900"
      : tone === "blue"
        ? "border-blue-200 dark:border-blue-900"
        : tone === "red"
          ? "border-red-200 dark:border-red-900 bg-red-50/40 dark:bg-red-950/20"
          : "border-border";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border bg-card p-4 text-left transition-colors hover:border-border-strong ${toneClass}`}
    >
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-heading text-2xl tracking-wide">{value}</p>
    </button>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative -mb-px border-b-2 px-3 pb-2 pt-1 text-sm transition-colors ${
        active
          ? "border-primary font-medium text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

// ─── All invoices tab ──────────────────────────────────────────────────────

interface AllInvoicesTabProps {
  invoices: InvoiceWithRefs[];
  clientOptions: { id: string; name: string }[];
  statusFilter: Set<InvoiceStatus>;
  typeFilter: Set<InvoiceType>;
  clientFilter: string | null;
  monthFilter: string;
  setMonthFilter: (v: string) => void;
  setClientFilter: (v: string | null) => void;
  toggleStatus: (s: InvoiceStatus) => void;
  toggleType: (t: InvoiceType) => void;
  onClearFilters: () => void;
  onPatch: (id: string, body: Record<string, unknown>) => Promise<void>;
}

function AllInvoicesTab(props: AllInvoicesTabProps) {
  const {
    invoices,
    clientOptions,
    statusFilter,
    typeFilter,
    clientFilter,
    monthFilter,
    setMonthFilter,
    setClientFilter,
    toggleStatus,
    toggleType,
    onClearFilters,
    onPatch,
  } = props;

  const filtersActive =
    statusFilter.size > 0 ||
    typeFilter.size > 0 ||
    clientFilter !== null ||
    monthFilter !== "";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-card p-3">
        <FilterBlock label="Client">
          <select
            value={clientFilter ?? ""}
            onChange={(e) => setClientFilter(e.target.value || null)}
            className="h-8 rounded-md border border-border-strong bg-background px-2 text-xs"
          >
            <option value="">All clients</option>
            {clientOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </FilterBlock>

        <FilterBlock label="Status">
          <div className="flex flex-wrap gap-1">
            {STATUS_ORDER.map((s) => (
              <FilterChip
                key={s}
                active={statusFilter.has(s)}
                onClick={() => toggleStatus(s)}
              >
                {STATUS_LABEL[s]}
              </FilterChip>
            ))}
          </div>
        </FilterBlock>

        <FilterBlock label="Type">
          <div className="flex flex-wrap gap-1">
            {TYPE_ORDER.map((t) => (
              <FilterChip
                key={t}
                active={typeFilter.has(t)}
                onClick={() => toggleType(t)}
              >
                {TYPE_LABEL[t]}
              </FilterChip>
            ))}
          </div>
        </FilterBlock>

        <FilterBlock label="Month">
          <input
            type="month"
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value)}
            className="h-8 rounded-md border border-border-strong bg-background px-2 text-xs"
          />
        </FilterBlock>

        {filtersActive && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onClearFilters}
          >
            Clear
          </Button>
        )}
      </div>

      <InvoiceTable invoices={invoices} onPatch={onPatch} />
    </div>
  );
}

function FilterBlock({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
        {label}
      </p>
      {children}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide transition-colors ${
        active
          ? "border-primary bg-primary-light text-foreground"
          : "border-border text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

// ─── Invoice table (shared between All + By Client) ────────────────────────

function InvoiceTable({
  invoices,
  onPatch,
  hideClient,
}: {
  invoices: InvoiceWithRefs[];
  onPatch: (id: string, body: Record<string, unknown>) => Promise<void>;
  hideClient?: boolean;
}) {
  if (invoices.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        No invoices match the current filters.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="bg-card text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">Invoice #</th>
            {!hideClient && <th className="px-3 py-2 text-left">Client</th>}
            <th className="px-3 py-2 text-left">Event</th>
            <th className="px-3 py-2 text-left">Type</th>
            <th className="px-3 py-2 text-right">Excl VAT</th>
            <th className="px-3 py-2 text-right">VAT</th>
            <th className="px-3 py-2 text-right">Total</th>
            <th className="px-3 py-2 text-left">Issued</th>
            <th className="px-3 py-2 text-left">Due</th>
            <th className="px-3 py-2 text-left">Paid</th>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-left">Actions</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => (
            <InvoiceTableRow
              key={inv.id}
              invoice={inv}
              hideClient={hideClient}
              onPatch={onPatch}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InvoiceTableRow({
  invoice,
  hideClient,
  onPatch,
}: {
  invoice: InvoiceWithRefs;
  hideClient?: boolean;
  onPatch: (id: string, body: Record<string, unknown>) => Promise<void>;
}) {
  const [busy, setBusy] = useState<null | string>(null);
  const [error, setError] = useState<string | null>(null);
  const overdue = isOverdue(invoice);
  const status: InvoiceStatus = overdue ? "overdue" : invoice.status;
  const vat =
    invoice.amount_incl_vat != null && invoice.amount_excl_vat != null
      ? Number(invoice.amount_incl_vat) - Number(invoice.amount_excl_vat)
      : null;

  async function go(body: Record<string, unknown>, label: string) {
    setBusy(label);
    setError(null);
    try {
      await onPatch(invoice.id, body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <tr
      className={`border-t border-border align-middle ${
        overdue ? "bg-red-50/40 dark:bg-red-950/20" : "hover:bg-muted/40"
      }`}
    >
      <td className="px-3 py-2 font-mono text-xs">{invoice.invoice_number}</td>
      {!hideClient && (
        <td className="px-3 py-2 text-muted-foreground">
          {invoice.client_name ?? "—"}
        </td>
      )}
      <td className="px-3 py-2 text-muted-foreground">
        {invoice.event_name ?? "—"}
      </td>
      <td className="px-3 py-2 text-muted-foreground">
        {TYPE_LABEL[invoice.invoice_type]}
      </td>
      <td className="px-3 py-2 text-right">{formatGBP(invoice.amount_excl_vat)}</td>
      <td className="px-3 py-2 text-right text-muted-foreground">
        {formatGBP(vat)}
      </td>
      <td className="px-3 py-2 text-right font-semibold">
        {formatGBP(invoice.amount_incl_vat)}
      </td>
      <td className="px-3 py-2 text-muted-foreground">
        {formatDate(invoice.issued_date)}
      </td>
      <td className="px-3 py-2 text-muted-foreground">
        {formatDate(invoice.due_date)}
      </td>
      <td className="px-3 py-2 text-muted-foreground">
        {formatDate(invoice.paid_date)}
      </td>
      <td className="px-3 py-2">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${STATUS_TONE[status]}`}
        >
          {STATUS_LABEL[status]}
        </span>
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5">
          {invoice.status === "draft" && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() => void go({ status: "sent" }, "send")}
            >
              {busy === "send" && <Loader2 className="h-3 w-3 animate-spin" />}
              Send
            </Button>
          )}
          {(invoice.status === "sent" || overdue) && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() => void go({ status: "paid" }, "paid")}
            >
              {busy === "paid" && <Loader2 className="h-3 w-3 animate-spin" />}
              Mark paid
            </Button>
          )}
          {error && <span className="text-xs text-destructive">{error}</span>}
        </div>
      </td>
    </tr>
  );
}

// ─── Quotes tab ────────────────────────────────────────────────────────────

function QuotesTab({ quotes }: { quotes: QuoteWithRefs[] }) {
  if (quotes.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        No quotes yet.{" "}
        <Link href="/invoicing/quotes/new" className="underline-offset-2 hover:underline">
          Create your first quote.
        </Link>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="bg-card text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">Quote #</th>
            <th className="px-3 py-2 text-left">Client</th>
            <th className="px-3 py-2 text-left">Event</th>
            <th className="px-3 py-2 text-right">Cap</th>
            <th className="px-3 py-2 text-right">Budget</th>
            <th className="px-3 py-2 text-left">Tier</th>
            <th className="px-3 py-2 text-right">Base fee</th>
            <th className="px-3 py-2 text-right">Max fee</th>
            <th className="px-3 py-2 text-right">Upfront</th>
            <th className="px-3 py-2 text-left">Settle</th>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-left">Actions</th>
          </tr>
        </thead>
        <tbody>
          {quotes.map((q) => (
            <tr key={q.id} className="border-t border-border align-middle hover:bg-muted/40">
              <td className="px-3 py-2 font-mono text-xs">{q.quote_number}</td>
              <td className="px-3 py-2 text-muted-foreground">
                {q.client_name ?? "—"}
              </td>
              <td className="px-3 py-2 text-muted-foreground">{q.event_name}</td>
              <td className="px-3 py-2 text-right">
                {q.capacity?.toLocaleString("en-GB") ?? "—"}
              </td>
              <td className="px-3 py-2 text-right text-muted-foreground">
                {formatGBP(q.marketing_budget, 0)}
              </td>
              <td className="px-3 py-2 text-muted-foreground">
                {SERVICE_TIER_LABEL[q.service_tier]}
              </td>
              <td className="px-3 py-2 text-right">{formatGBP(q.base_fee)}</td>
              <td className="px-3 py-2 text-right font-semibold">
                {formatGBP(q.max_fee)}
              </td>
              <td className="px-3 py-2 text-right text-muted-foreground">
                {q.upfront_pct}%
              </td>
              <td className="px-3 py-2 text-muted-foreground">
                {SETTLEMENT_TIMING_LABEL[q.settlement_timing]}
              </td>
              <td className="px-3 py-2">
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${QUOTE_STATUS_TONE[q.status]}`}
                >
                  {q.status}
                </span>
              </td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-1.5">
                  {q.status === "approved" && q.event_id && (
                    <Link
                      href={`/events/${q.event_id}`}
                      className="text-xs underline-offset-2 hover:underline"
                    >
                      View event →
                    </Link>
                  )}
                  {q.status === "converted" && q.event_id && (
                    <Link
                      href={`/events/${q.event_id}`}
                      className="text-xs underline-offset-2 hover:underline"
                    >
                      View event →
                    </Link>
                  )}
                  {(q.status === "draft" || q.status === "approved") && (
                    <Link
                      href={`/invoicing/quotes/${q.id}`}
                      className="text-xs underline-offset-2 hover:underline"
                    >
                      Open
                    </Link>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── By Client tab ─────────────────────────────────────────────────────────

function ByClientTab({
  invoices,
  clientOptions,
  onPatch,
}: {
  invoices: InvoiceWithRefs[];
  clientOptions: { id: string; name: string }[];
  onPatch: (id: string, body: Record<string, unknown>) => Promise<void>;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const groups = clientOptions
    .map((c) => {
      const rows = invoices.filter((i) => i.client_id === c.id);
      const paid = rows
        .filter((i) => i.status === "paid")
        .reduce((s, i) => s + Number(i.amount_excl_vat ?? 0), 0);
      const outstanding = rows
        .filter((i) => i.status === "sent" || isOverdue(i))
        .reduce((s, i) => s + Number(i.amount_excl_vat ?? 0), 0);
      return { client: c, rows, paid, outstanding };
    })
    .filter((g) => g.rows.length > 0);

  if (groups.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        No clients have invoices yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {groups.map(({ client, rows, paid, outstanding }) => {
        const isOpen = open.has(client.id);
        return (
          <div key={client.id} className="rounded-md border border-border">
            <button
              type="button"
              onClick={() => toggle(client.id)}
              className="flex w-full items-center justify-between gap-3 bg-card px-4 py-3 text-left"
            >
              <div className="flex items-center gap-2">
                {isOpen ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                <span className="font-medium">{client.name}</span>
                <span className="text-xs text-muted-foreground">
                  {rows.length} invoice{rows.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>Paid {formatGBP(paid, 0)}</span>
                <span>Outstanding {formatGBP(outstanding, 0)}</span>
              </div>
            </button>
            {isOpen && (
              <div className="border-t border-border p-3">
                <InvoiceTable
                  invoices={rows}
                  onPatch={onPatch}
                  hideClient
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
