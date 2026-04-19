"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  SERVICE_TIER_LABEL,
  SETTLEMENT_TIMING_LABEL,
} from "@/lib/pricing/calculator";
import type {
  InvoiceRow,
  QuoteRow,
  QuoteStatus,
} from "@/lib/types/invoicing";

// ─────────────────────────────────────────────────────────────────────────────
// Quote detail.
//
// Read-only summary of all quote inputs + lifecycle controls. Wires up to:
//   PATCH /api/invoicing/quotes/[id]            - approve / cancel
//   PATCH /api/invoicing/quotes/[id]/convert    - convert + spawn event
// Both endpoints are added in Step 4 / Step 5 — the buttons below stay
// inert (just bubble fetch errors) until those routes land.
//
// `autoConvert` triggers the convert endpoint immediately when the user
// arrived here via "Save + approve + create event" on the form.
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  quote: QuoteRow;
  invoices: InvoiceRow[];
  clientName: string;
  autoConvert?: boolean;
}

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
    year: "numeric",
  });
}

const STATUS_TONE: Record<QuoteStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  approved: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-300",
  converted: "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-300",
  cancelled: "bg-muted text-muted-foreground line-through",
};

export function QuoteDetail({
  quote,
  invoices,
  clientName,
  autoConvert,
}: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<null | "approve" | "convert" | "cancel">(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [convertedEventId, setConvertedEventId] = useState<string | null>(
    quote.event_id,
  );

  async function patchQuote(body: Record<string, unknown>) {
    const res = await fetch(`/api/invoicing/quotes/${quote.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new Error(
        (json as { error?: string }).error ?? "Failed to update quote.",
      );
    }
    return res.json();
  }

  async function convertToEvent() {
    setBusy("convert");
    setError(null);
    try {
      const res = await fetch(
        `/api/invoicing/quotes/${quote.id}/convert`,
        { method: "PATCH" },
      );
      const json = (await res.json()) as
        | { ok: true; event: { id: string } }
        | { ok: false; error: string };
      if (!res.ok || !("ok" in json) || !json.ok) {
        throw new Error(
          "ok" in json && !json.ok && json.error
            ? json.error
            : "Conversion failed.",
        );
      }
      setConvertedEventId(json.event.id);
      start(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Conversion failed.");
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    if (autoConvert && quote.status === "approved" && !quote.event_id) {
      void convertToEvent();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function approveQuote() {
    setBusy("approve");
    setError(null);
    try {
      await patchQuote({ status: "approved" });
      start(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed.");
    } finally {
      setBusy(null);
    }
  }

  async function cancelQuote() {
    if (!confirm("Cancel this quote? Linked invoices will also be cancelled.")) {
      return;
    }
    setBusy("cancel");
    setError(null);
    try {
      await patchQuote({ status: "cancelled" });
      start(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed.");
    } finally {
      setBusy(null);
    }
  }

  const statusBadge = (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_TONE[quote.status]}`}
    >
      {quote.status}
    </span>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-heading text-xl tracking-wide">
          {quote.quote_number}
        </h2>
        {statusBadge}
        <span className="text-sm text-muted-foreground">
          · {clientName} · {quote.event_name}
        </span>
      </div>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card title="Event">
          <Field label="Event name" value={quote.event_name} />
          <Field label="Event date" value={formatDate(quote.event_date)} />
          <Field label="Announcement" value={formatDate(quote.announcement_date)} />
          <Field
            label="Venue"
            value={
              [quote.venue_name, quote.venue_city, quote.venue_country]
                .filter(Boolean)
                .join(" · ") || "—"
            }
          />
          <Field label="Capacity" value={quote.capacity.toLocaleString("en-GB")} />
          <Field
            label="Marketing budget"
            value={formatGBP(quote.marketing_budget)}
          />
        </Card>

        <Card title="Pricing">
          <Field
            label="Service tier"
            value={SERVICE_TIER_LABEL[quote.service_tier]}
          />
          <Field
            label="Sold-out expected"
            value={quote.sold_out_expected ? "Yes" : "No"}
          />
          <Field label="Base fee" value={formatGBP(quote.base_fee)} bold />
          <Field
            label="Sell-out bonus"
            value={formatGBP(quote.sell_out_bonus)}
          />
          <Field label="Maximum fee" value={formatGBP(quote.max_fee)} bold />
          <Field label="Upfront %" value={`${quote.upfront_pct}%`} />
          <Field
            label="Settlement timing"
            value={SETTLEMENT_TIMING_LABEL[quote.settlement_timing]}
          />
        </Card>
      </section>

      {quote.notes && (
        <Card title="Notes">
          <p className="text-sm whitespace-pre-line text-foreground">
            {quote.notes}
          </p>
        </Card>
      )}

      <Card title={`Invoices (${invoices.length})`}>
        {invoices.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No invoices generated yet. Approve the quote to create them.
          </p>
        ) : (
          <ul className="space-y-2">
            {invoices.map((inv) => (
              <li
                key={inv.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs">{inv.invoice_number}</span>
                  <span className="capitalize text-muted-foreground">
                    {inv.invoice_type.replace(/_/g, " ")}
                  </span>
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${invoiceStatusClass(inv.status)}`}
                  >
                    {inv.status}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-semibold">
                    {formatGBP(inv.amount_excl_vat)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Due {formatDate(inv.due_date)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-wrap gap-2">
        {quote.status === "draft" && (
          <>
            <Button
              type="button"
              onClick={() => void approveQuote()}
              disabled={busy !== null}
            >
              {busy === "approve" && (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              )}
              Approve
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push(`/invoicing/quotes/new?client_id=${quote.client_id}`)}
              disabled={busy !== null}
            >
              Edit (start over)
            </Button>
          </>
        )}

        {quote.status === "approved" && !convertedEventId && (
          <Button
            type="button"
            onClick={() => void convertToEvent()}
            disabled={busy !== null || pending}
          >
            {busy === "convert" && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            )}
            Convert to event
          </Button>
        )}

        {convertedEventId && (
          <Link
            href={`/events/${convertedEventId}`}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border-strong px-4 text-sm hover:bg-muted"
          >
            View event →
          </Link>
        )}

        {quote.status !== "cancelled" && quote.status !== "converted" && (
          <Button
            type="button"
            variant="destructive"
            onClick={() => void cancelQuote()}
            disabled={busy !== null}
          >
            {busy === "cancel" && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            )}
            Cancel quote
          </Button>
        )}
      </div>
    </div>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-border bg-card p-5 space-y-3">
      <h3 className="font-heading text-base tracking-wide">{title}</h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Field({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={bold ? "font-semibold" : ""}>{value}</span>
    </div>
  );
}

function invoiceStatusClass(status: InvoiceRow["status"]): string {
  switch (status) {
    case "paid":
      return "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-300";
    case "sent":
      return "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-300";
    case "overdue":
      return "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-300";
    case "cancelled":
      return "bg-muted text-muted-foreground line-through";
    default:
      return "bg-muted text-muted-foreground";
  }
}
