"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { InvoiceRow, InvoiceStatus } from "@/lib/types/invoicing";

// ─────────────────────────────────────────────────────────────────────────────
// Compact invoice card.
//
// Used in three places:
//   - Quote detail page (read-only invoice list)
//   - Master /invoicing dashboard rows
//   - Client + event invoicing tabs
//
// Action buttons (Mark sent / Mark paid) are context-sensitive: a draft
// row only shows "Mark sent", a sent row shows "Mark paid", paid/cancelled
// rows show no actions at all. `readOnly=true` hides every action button —
// pass it from the event detail panel where users shouldn't fiddle with
// invoice status mid-event.
// ─────────────────────────────────────────────────────────────────────────────

const GBP = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 2,
});

function formatGBP(value: number | null | undefined): string {
  if (value == null) return "—";
  return GBP.format(value);
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
  cancelled:
    "bg-muted text-muted-foreground line-through",
};

const TYPE_LABEL: Record<InvoiceRow["invoice_type"], string> = {
  upfront: "Upfront",
  settlement: "Settlement",
  sell_out_bonus: "Sell-out bonus",
  other: "Other",
};

interface Props {
  invoice: InvoiceRow;
  readOnly?: boolean;
  /** Called with the updated row after a successful PATCH. */
  onUpdated?: (updated: InvoiceRow) => void;
}

/**
 * Detect overdue rows on the fly so the card renders correctly even when
 * the underlying status field hasn't been re-stamped by a cron job.
 */
function isOverdueDerived(inv: InvoiceRow): boolean {
  if (inv.status !== "sent") return false;
  if (!inv.due_date) return false;
  const due = new Date(inv.due_date);
  if (Number.isNaN(due.getTime())) return false;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return due < today;
}

export function InvoiceCard({ invoice, readOnly, onUpdated }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "send" | "paid">(null);
  const [error, setError] = useState<string | null>(null);
  const [row, setRow] = useState<InvoiceRow>(invoice);

  const overdue = row.status === "overdue" || isOverdueDerived(row);
  const displayStatus: InvoiceStatus = overdue ? "overdue" : row.status;

  async function patch(body: Record<string, unknown>, mode: "send" | "paid") {
    setBusy(mode);
    setError(null);
    try {
      const res = await fetch(`/api/invoicing/invoices/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as
        | { ok: true; invoice: InvoiceRow }
        | { ok: false; error: string };
      if (!res.ok || !("ok" in json) || !json.ok) {
        throw new Error(
          "ok" in json && !json.ok && json.error
            ? json.error
            : "Failed to update invoice.",
        );
      }
      setRow(json.invoice);
      onUpdated?.(json.invoice);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update invoice.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className={`rounded-md border bg-background p-3 space-y-2 ${overdue ? "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40" : "border-border"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs">{row.invoice_number}</span>
          <span className="text-xs text-muted-foreground">
            {TYPE_LABEL[row.invoice_type]}
          </span>
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${STATUS_TONE[displayStatus]}`}
          >
            {STATUS_LABEL[displayStatus]}
          </span>
        </div>
        <div className="text-sm font-semibold">
          {formatGBP(row.amount_excl_vat)}
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            +VAT → {formatGBP(row.amount_incl_vat)}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>Issued: {formatDate(row.issued_date)}</span>
        <span>Due: {formatDate(row.due_date)}</span>
        {row.paid_date && <span>Paid: {formatDate(row.paid_date)}</span>}
      </div>

      {!readOnly && (row.status === "draft" || row.status === "sent" || row.status === "overdue") && (
        <div className="flex flex-wrap items-center gap-2">
          {row.status === "draft" && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void patch({ status: "sent" }, "send")}
              disabled={busy !== null}
            >
              {busy === "send" && <Loader2 className="h-3 w-3 animate-spin" />}
              Mark sent
            </Button>
          )}
          {(row.status === "sent" || row.status === "overdue") && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void patch({ status: "paid" }, "paid")}
              disabled={busy !== null}
            >
              {busy === "paid" && <Loader2 className="h-3 w-3 animate-spin" />}
              Mark paid
            </Button>
          )}
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
