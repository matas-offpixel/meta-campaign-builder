"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, ChevronRight, Receipt } from "lucide-react";

import { InvoiceCard } from "@/components/invoicing/invoice-card";
import type { InvoiceRow, QuoteRow } from "@/lib/types/invoicing";

// ─────────────────────────────────────────────────────────────────────────────
// Read-only invoicing summary on the event detail Overview tab.
//
// Renders nothing when the event has no invoices and no linked quote —
// the empty state lives on the master /invoicing dashboard, not here.
// Collapsed by default; users opt-in to seeing the row breakdown.
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  quote: QuoteRow | null;
  invoices: InvoiceRow[];
}

const GBP = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});

export function EventInvoicingPanel({ quote, invoices }: Props) {
  const [open, setOpen] = useState(false);

  if (!quote && invoices.length === 0) return null;

  const totalExclVat = invoices.reduce(
    (sum, i) => sum + Number(i.amount_excl_vat ?? 0),
    0,
  );
  const totalPaid = invoices
    .filter((i) => i.status === "paid")
    .reduce((sum, i) => sum + Number(i.amount_excl_vat ?? 0), 0);

  return (
    <section className="rounded-md border border-border bg-card p-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div className="flex items-center gap-2">
          <Receipt className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-heading text-base tracking-wide">Invoicing</h2>
          {quote && (
            <Link
              href={`/invoicing/quotes/${quote.id}`}
              className="ml-1 inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground hover:border-border-strong"
              onClick={(e) => e.stopPropagation()}
            >
              From quote {quote.quote_number}
            </Link>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {invoices.length > 0 && (
            <span>
              {GBP.format(totalPaid)} / {GBP.format(totalExclVat)} paid ·{" "}
              {invoices.length} invoice{invoices.length === 1 ? "" : "s"}
            </span>
          )}
          {open ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </div>
      </button>

      {open && (
        <div className="mt-4 space-y-2">
          {invoices.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Quote linked but no invoices generated yet.
            </p>
          ) : (
            invoices.map((inv) => (
              <InvoiceCard key={inv.id} invoice={inv} readOnly />
            ))
          )}
        </div>
      )}
    </section>
  );
}
