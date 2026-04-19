"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { InvoiceCard } from "@/components/invoicing/invoice-card";
import {
  SETTLEMENT_TIMING_LABEL,
  type SettlementTiming,
} from "@/lib/pricing/calculator";
import type {
  InvoiceRow,
  InvoiceWithRefs,
  QuoteRow,
} from "@/lib/types/invoicing";

// ─────────────────────────────────────────────────────────────────────────────
// Per-client invoicing tab. Lives inside the client detail page.
//
// Three jobs:
//   1. Surface every invoice for this client, grouped by event so the user
//      can scan "Booka Shade Brixton: 2 invoices, both paid" at a glance.
//   2. Aggregate the per-client totals (fees / paid / outstanding).
//   3. Edit the client's default payment terms in-place — these get copied
//      onto every new quote at create time, so changing them here is a
//      one-shot way to bake "Louder always pays on completion" into the
//      flow without touching individual quotes.
//
// All mutation traffic goes through the existing PATCH /api/clients/[id]
// route, extended in Step 7 to whitelist the two new default_* columns.
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
    year: "numeric",
  });
}

interface EventLite {
  id: string;
  name: string;
  event_date: string | null;
  status: string | null;
}

interface Props {
  clientId: string;
  clientName: string;
  events: EventLite[];
  invoices: InvoiceWithRefs[];
  quotes: QuoteRow[];
  defaults: {
    upfront_pct: number;
    settlement_timing: SettlementTiming;
  };
}

const SETTLEMENT_OPTIONS: { value: SettlementTiming; label: string }[] = (
  Object.keys(SETTLEMENT_TIMING_LABEL) as SettlementTiming[]
).map((value) => ({ value, label: SETTLEMENT_TIMING_LABEL[value] }));

export function ClientInvoiceTab({
  clientId,
  clientName,
  events,
  invoices: initialInvoices,
  quotes,
  defaults,
}: Props) {
  const router = useRouter();
  const [invoices, setInvoices] = useState<InvoiceWithRefs[]>(initialInvoices);

  // Local mutable copies of the default payment terms for the inline editor.
  // Kept separate from the saved snapshot so the "Save defaults" button knows
  // when to enable itself.
  const [upfrontPct, setUpfrontPct] = useState<string>(
    String(defaults.upfront_pct ?? 75),
  );
  const [settlementTiming, setSettlementTiming] = useState<SettlementTiming>(
    defaults.settlement_timing ?? "1_month_before",
  );
  const [savedDefaults, setSavedDefaults] = useState({
    upfront_pct: defaults.upfront_pct ?? 75,
    settlement_timing: defaults.settlement_timing ?? "1_month_before",
  });
  const [savingDefaults, setSavingDefaults] = useState(false);
  const [defaultsError, setDefaultsError] = useState<string | null>(null);
  const [defaultsSavedAt, setDefaultsSavedAt] = useState<number | null>(null);

  // ── Summary numbers ─────────────────────────────────────────────────────
  // "Total fees" reflects what we've actually invoiced (sum of excl-VAT).
  // Quote-level base_fee/max_fee are excluded so this matches the Money
  // numbers the master invoicing dashboard shows.
  const summary = useMemo(() => {
    let totalFees = 0;
    let totalPaid = 0;
    let totalOutstanding = 0;
    for (const inv of invoices) {
      if (inv.status === "cancelled") continue;
      totalFees += inv.amount_excl_vat;
      if (inv.status === "paid") totalPaid += inv.amount_excl_vat;
      else if (inv.status === "sent" || inv.status === "overdue")
        totalOutstanding += inv.amount_excl_vat;
    }
    const eventsCount = events.length;
    return { totalFees, totalPaid, totalOutstanding, eventsCount };
  }, [invoices, events.length]);

  // ── Group invoices by event ─────────────────────────────────────────────
  // Anything without an event_id is bucketed under the originating quote
  // ("quote-only") so users still see invoices created before the event
  // record was spawned.
  const groups = useMemo(() => {
    const byEvent = new Map<string, InvoiceWithRefs[]>();
    const byQuote = new Map<string, InvoiceWithRefs[]>();
    const orphans: InvoiceWithRefs[] = [];

    for (const inv of invoices) {
      if (inv.event_id) {
        const arr = byEvent.get(inv.event_id) ?? [];
        arr.push(inv);
        byEvent.set(inv.event_id, arr);
      } else if (inv.quote_id) {
        const arr = byQuote.get(inv.quote_id) ?? [];
        arr.push(inv);
        byQuote.set(inv.quote_id, arr);
      } else {
        orphans.push(inv);
      }
    }

    const eventGroups = events
      .filter((e) => byEvent.has(e.id))
      .sort((a, b) => {
        // event_date DESC, nulls last
        if (!a.event_date && !b.event_date) return 0;
        if (!a.event_date) return 1;
        if (!b.event_date) return -1;
        return b.event_date.localeCompare(a.event_date);
      })
      .map((e) => ({
        kind: "event" as const,
        id: e.id,
        title: e.name,
        date: e.event_date,
        statusBadge: e.status ?? null,
        invoices: byEvent.get(e.id)!,
      }));

    const quoteGroups = Array.from(byQuote.entries()).map(([qid, list]) => {
      const q = quotes.find((row) => row.id === qid);
      return {
        kind: "quote" as const,
        id: qid,
        title: q ? `${q.event_name} (quote ${q.quote_number})` : "Quote-only",
        date: q?.event_date ?? null,
        statusBadge: q ? `quote · ${q.status}` : null,
        invoices: list,
      };
    });

    const orphanGroup =
      orphans.length > 0
        ? [
            {
              kind: "orphan" as const,
              id: "__orphans__",
              title: "Other invoices",
              date: null as string | null,
              statusBadge: null as string | null,
              invoices: orphans,
            },
          ]
        : [];

    return [...eventGroups, ...quoteGroups, ...orphanGroup];
  }, [invoices, events, quotes]);

  function handleInvoiceUpdated(updated: InvoiceRow) {
    setInvoices((prev) =>
      prev.map((row) =>
        row.id === updated.id
          ? // Preserve the joined client/event names from the original ref.
            ({ ...row, ...updated } as InvoiceWithRefs)
          : row,
      ),
    );
  }

  // ── Default payment terms save ──────────────────────────────────────────
  const dirty =
    Number(upfrontPct) !== Number(savedDefaults.upfront_pct) ||
    settlementTiming !== savedDefaults.settlement_timing;

  async function saveDefaults() {
    setSavingDefaults(true);
    setDefaultsError(null);
    try {
      const pctNum = Number(upfrontPct);
      if (Number.isNaN(pctNum) || pctNum < 0 || pctNum > 100) {
        throw new Error("Upfront % must be between 0 and 100.");
      }
      const res = await fetch(`/api/clients/${clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          default_upfront_pct: pctNum,
          default_settlement_timing: settlementTiming,
        }),
      });
      const json = (await res.json()) as
        | { ok: true; client: Record<string, unknown> }
        | { ok: false; error: string };
      if (!res.ok || !("ok" in json) || !json.ok) {
        throw new Error(
          "ok" in json && !json.ok && json.error
            ? json.error
            : "Failed to save defaults.",
        );
      }
      setSavedDefaults({
        upfront_pct: pctNum,
        settlement_timing: settlementTiming,
      });
      setDefaultsSavedAt(Date.now());
      router.refresh();
    } catch (err) {
      setDefaultsError(
        err instanceof Error ? err.message : "Failed to save defaults.",
      );
    } finally {
      setSavingDefaults(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-md border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-heading text-base tracking-wide">
              Invoicing — {clientName}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Quotes, invoices and payment status for this client.
            </p>
          </div>
          <Link
            href={`/invoicing/quotes/new?client_id=${clientId}`}
            className="inline-flex"
          >
            <Button size="sm" variant="outline">
              <Plus className="h-3.5 w-3.5" />
              New quote
            </Button>
          </Link>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <SummaryStat label="Events" value={String(summary.eventsCount)} />
          <SummaryStat
            label="Total invoiced"
            value={formatGBP(summary.totalFees)}
          />
          <SummaryStat
            label="Paid"
            value={formatGBP(summary.totalPaid)}
            tone="green"
          />
          <SummaryStat
            label="Outstanding"
            value={formatGBP(summary.totalOutstanding)}
            tone={summary.totalOutstanding > 0 ? "amber" : "muted"}
          />
        </div>
      </section>

      {/* Event-grouped invoice list */}
      <section className="space-y-4">
        {groups.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-card/40 p-6 text-center">
            <p className="text-sm text-muted-foreground">
              No invoices yet — create a quote to get started.
            </p>
            <Link
              href={`/invoicing/quotes/new?client_id=${clientId}`}
              className="mt-3 inline-flex"
            >
              <Button size="sm">
                <Plus className="h-3.5 w-3.5" />
                New quote
              </Button>
            </Link>
          </div>
        ) : (
          groups.map((group) => (
            <div
              key={`${group.kind}-${group.id}`}
              className="rounded-md border border-border bg-card p-4 space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-baseline gap-2">
                  {group.kind === "event" ? (
                    <Link
                      href={`/events/${group.id}`}
                      className="font-medium text-sm hover:underline"
                    >
                      {group.title}
                    </Link>
                  ) : (
                    <span className="font-medium text-sm">{group.title}</span>
                  )}
                  {group.date && (
                    <span className="text-xs text-muted-foreground">
                      {formatDate(group.date)}
                    </span>
                  )}
                  {group.statusBadge && (
                    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {group.statusBadge}
                    </span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  {group.invoices.length} invoice
                  {group.invoices.length === 1 ? "" : "s"}
                </span>
              </div>

              <div className="space-y-2">
                {group.invoices.map((inv) => (
                  <InvoiceCard
                    key={inv.id}
                    invoice={inv}
                    onUpdated={handleInvoiceUpdated}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </section>

      {/* Default payment terms editor */}
      <section className="rounded-md border border-border bg-card p-5 space-y-3">
        <div>
          <h3 className="font-heading text-sm tracking-wide">
            Default payment terms
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Applied to every new quote for {clientName}. Per-quote overrides
            are still possible from the quote builder.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Upfront %
            </span>
            <Input
              type="number"
              min={0}
              max={100}
              step={1}
              value={upfrontPct}
              onChange={(e) => setUpfrontPct(e.target.value)}
              className="mt-1"
            />
          </label>
          <label className="block md:col-span-2">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Settlement timing
            </span>
            <div className="mt-1">
              <Select
                value={settlementTiming}
                onChange={(e) =>
                  setSettlementTiming(e.target.value as SettlementTiming)
                }
                options={SETTLEMENT_OPTIONS}
              />
            </div>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => void saveDefaults()}
            disabled={!dirty || savingDefaults}
          >
            {savingDefaults && <Loader2 className="h-3 w-3 animate-spin" />}
            Save defaults
          </Button>
          {defaultsSavedAt && !dirty && (
            <span className="text-xs text-muted-foreground">Saved.</span>
          )}
          {defaultsError && (
            <span className="text-xs text-destructive">{defaultsError}</span>
          )}
        </div>
      </section>
    </div>
  );
}

function SummaryStat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "green" | "amber" | "muted";
}) {
  const toneClass =
    tone === "green"
      ? "text-green-700 dark:text-green-400"
      : tone === "amber"
        ? "text-amber-700 dark:text-amber-400"
        : tone === "muted"
          ? "text-muted-foreground"
          : "text-foreground";
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className={`mt-1 text-base font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}
