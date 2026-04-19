"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  PER_TICKET_RATE,
  SERVICE_TIER_LABEL,
  SETTLEMENT_TIMING_LABEL,
  type ServiceTier,
  type SettlementTiming,
  calculateInvoiceAmounts,
  calculateQuote,
} from "@/lib/pricing/calculator";
import type {
  ClientForQuoteForm,
  CreateQuoteRequest,
  CreateQuoteResponse,
} from "@/lib/types/invoicing";

// ─────────────────────────────────────────────────────────────────────────────
// Quote builder.
//
// All calculation is in the pure pricing module (lib/pricing/calculator.ts),
// so the live preview card just calls calculateQuote() on every render.
// Persistence happens via POST /api/invoicing/quotes (added in Step 4).
//
// "Save + approve + create event" sets approve=true and tags the redirect
// with a query param so the quote-detail page (or future event-create page)
// knows to immediately invoke the convert endpoint added in Step 5.
// ─────────────────────────────────────────────────────────────────────────────

const SERVICE_TIER_OPTIONS: { value: ServiceTier; label: string }[] = (
  Object.keys(SERVICE_TIER_LABEL) as ServiceTier[]
).map((value) => ({ value, label: SERVICE_TIER_LABEL[value] }));

const SETTLEMENT_OPTIONS: { value: SettlementTiming; label: string }[] = (
  Object.keys(SETTLEMENT_TIMING_LABEL) as SettlementTiming[]
).map((value) => ({ value, label: SETTLEMENT_TIMING_LABEL[value] }));

interface Props {
  clients: ClientForQuoteForm[];
  defaultClientId?: string;
}

const GBP = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 2,
});

function formatGBP(value: number): string {
  return GBP.format(value);
}

type SubmitMode = "draft" | "approve" | "approve_and_event";

export function QuoteForm({ clients, defaultClientId }: Props) {
  const router = useRouter();

  const [clientId, setClientId] = useState(defaultClientId ?? "");
  const [eventName, setEventName] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [announcementDate, setAnnouncementDate] = useState("");
  const [venueName, setVenueName] = useState("");
  const [venueCity, setVenueCity] = useState("");
  const [venueCountry, setVenueCountry] = useState("");

  const [serviceTier, setServiceTier] = useState<ServiceTier>("ads_d2c_creative");
  const [capacity, setCapacity] = useState("1500");
  const [marketingBudget, setMarketingBudget] = useState("");
  const [soldOutExpected, setSoldOutExpected] = useState(true);

  const selectedClient = useMemo(
    () => clients.find((c) => c.id === clientId) ?? null,
    [clients, clientId],
  );

  const [upfrontPct, setUpfrontPct] = useState<string>("75");
  const [settlementTiming, setSettlementTiming] =
    useState<SettlementTiming>("1_month_before");
  const [paymentTermsTouched, setPaymentTermsTouched] = useState(false);

  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState<SubmitMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleClientChange(value: string) {
    setClientId(value);
    const client = clients.find((c) => c.id === value);
    if (client && !paymentTermsTouched) {
      setUpfrontPct(String(client.default_upfront_pct));
      setSettlementTiming(client.default_settlement_timing);
    }
  }

  const quote = useMemo(
    () =>
      calculateQuote({
        capacity: Number.parseInt(capacity || "0", 10),
        marketing_budget: Number.parseFloat(marketingBudget || "0"),
        service_tier: serviceTier,
        sold_out_expected: soldOutExpected,
      }),
    [capacity, marketingBudget, serviceTier, soldOutExpected],
  );

  const split = useMemo(
    () =>
      calculateInvoiceAmounts(
        { base_fee: quote.base_fee },
        Number.parseFloat(upfrontPct || "0"),
      ),
    [quote.base_fee, upfrontPct],
  );

  async function handleSubmit(mode: SubmitMode) {
    if (!clientId) {
      setError("Pick a client first.");
      return;
    }
    if (!eventName.trim()) {
      setError("Event name is required.");
      return;
    }
    setSubmitting(mode);
    setError(null);
    try {
      const payload: CreateQuoteRequest = {
        client_id: clientId,
        event_name: eventName.trim(),
        event_date: eventDate || null,
        announcement_date: announcementDate || null,
        venue_name: venueName.trim() || null,
        venue_city: venueCity.trim() || null,
        venue_country: venueCountry.trim() || null,
        capacity: Number.parseInt(capacity || "0", 10),
        marketing_budget: marketingBudget
          ? Number.parseFloat(marketingBudget)
          : null,
        service_tier: serviceTier,
        sold_out_expected: soldOutExpected,
        upfront_pct: Number.parseFloat(upfrontPct || "0"),
        settlement_timing: settlementTiming,
        notes: notes.trim() || null,
        approve: mode !== "draft",
      };

      const res = await fetch("/api/invoicing/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as
        | CreateQuoteResponse
        | { ok: false; error: string };
      if (!res.ok || !("ok" in json) || !json.ok) {
        throw new Error(
          "ok" in json && !json.ok && json.error
            ? json.error
            : "Failed to save quote.",
        );
      }
      router.refresh();
      if (mode === "approve_and_event") {
        router.push(`/invoicing/quotes/${json.quote.id}?convert=1`);
      } else {
        router.push(`/invoicing/quotes/${json.quote.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save quote.");
    } finally {
      setSubmitting(null);
    }
  }

  const clientOptions = clients.map((c) => ({ value: c.id, label: c.name }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-6">
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSubmit("draft");
        }}
      >
        {/* SECTION 1 — Client + Event */}
        <section className="rounded-md border border-border bg-card p-5 space-y-4">
          <h2 className="font-heading text-base tracking-wide">Client &amp; event</h2>

          <Select
            id="quote-client"
            label="Client"
            required
            value={clientId}
            onChange={(e) => handleClientChange(e.target.value)}
            options={clientOptions}
            placeholder={
              clientOptions.length === 0
                ? "No active clients — create one first"
                : "Pick a client"
            }
            disabled={clientOptions.length === 0}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              id="quote-event-name"
              label="Event name"
              required
              value={eventName}
              onChange={(e) => setEventName(e.target.value)}
              placeholder="e.g. Booka Shade @ Drumsheds"
            />
            <Input
              id="quote-venue-name"
              label="Venue"
              value={venueName}
              onChange={(e) => setVenueName(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Input
              id="quote-event-date"
              label="Event date"
              type="date"
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
            />
            <Input
              id="quote-announcement-date"
              label="Announcement"
              type="date"
              value={announcementDate}
              onChange={(e) => setAnnouncementDate(e.target.value)}
            />
            <Input
              id="quote-venue-city"
              label="City"
              value={venueCity}
              onChange={(e) => setVenueCity(e.target.value)}
            />
          </div>

          <Input
            id="quote-venue-country"
            label="Country"
            value={venueCountry}
            onChange={(e) => setVenueCountry(e.target.value)}
            placeholder="England"
          />

          <div className="space-y-1.5">
            <p className="text-sm font-medium">Service tier</p>
            <div className="grid grid-cols-3 gap-2">
              {SERVICE_TIER_OPTIONS.map((opt) => {
                const active = serviceTier === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setServiceTier(opt.value)}
                    className={`h-9 rounded-md border text-xs font-medium transition-colors
                      ${
                        active
                          ? "border-primary bg-primary-light text-foreground"
                          : "border-border-strong bg-background text-muted-foreground hover:bg-muted"
                      }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              {formatGBP(PER_TICKET_RATE[serviceTier])} per ticket
            </p>
          </div>
        </section>

        {/* SECTION 2 — Pricing inputs */}
        <section className="rounded-md border border-border bg-card p-5 space-y-4">
          <h2 className="font-heading text-base tracking-wide">Pricing inputs</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              id="quote-capacity"
              label="Capacity"
              type="number"
              min={0}
              required
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
            />
            <Input
              id="quote-marketing-budget"
              label="Marketing budget (£)"
              type="number"
              step="0.01"
              min={0}
              value={marketingBudget}
              onChange={(e) => setMarketingBudget(e.target.value)}
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={soldOutExpected}
              onChange={(e) => setSoldOutExpected(e.target.checked)}
              className="h-4 w-4 rounded border-border-strong"
            />
            Sold-out expected (adds £0.10 / ticket bonus invoice)
          </label>
        </section>

        {/* SECTION 3 — Payment terms */}
        <section className="rounded-md border border-border bg-card p-5 space-y-4">
          <h2 className="font-heading text-base tracking-wide">Payment terms</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              id="quote-upfront-pct"
              label="Upfront %"
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={upfrontPct}
              onChange={(e) => {
                setPaymentTermsTouched(true);
                setUpfrontPct(e.target.value);
              }}
            />
            <Select
              id="quote-settlement-timing"
              label="Settlement timing"
              value={settlementTiming}
              onChange={(e) => {
                setPaymentTermsTouched(true);
                setSettlementTiming(e.target.value as SettlementTiming);
              }}
              options={SETTLEMENT_OPTIONS}
            />
          </div>

          {selectedClient && (
            <p className="text-xs text-muted-foreground">
              Default for {selectedClient.name}:{" "}
              {selectedClient.default_upfront_pct}% upfront ·{" "}
              {SETTLEMENT_TIMING_LABEL[selectedClient.default_settlement_timing]}
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="quote-notes" className="text-sm font-medium">
              Notes
            </label>
            <textarea
              id="quote-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Anything Matas should remember when sending the invoice."
              className="w-full rounded-md border border-border-strong bg-background px-3 py-2 text-sm
                focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </section>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="flex flex-wrap items-center gap-2 pt-2">
          <Button type="submit" variant="outline" disabled={submitting !== null}>
            {submitting === "draft" && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            )}
            Save as draft
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={submitting !== null}
            onClick={() => void handleSubmit("approve")}
          >
            {submitting === "approve" && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            )}
            Save + approve
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={submitting !== null}
            onClick={() => void handleSubmit("approve_and_event")}
          >
            {submitting === "approve_and_event" && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            )}
            Save + approve + create event
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={submitting !== null}
            onClick={() => router.back()}
          >
            Cancel
          </Button>
        </div>
      </form>

      {/* Live preview rail */}
      <aside className="lg:sticky lg:top-6 self-start space-y-3">
        <div className="rounded-md border border-border bg-card p-5 space-y-3">
          <h3 className="font-heading text-base tracking-wide">Live quote</h3>

          <Row label="Base fee" value={formatGBP(quote.base_fee)} bold />
          {soldOutExpected && (
            <Row
              label="Sell-out bonus"
              value={formatGBP(quote.sell_out_bonus)}
              muted
            />
          )}
          <div className="border-t border-border" />
          <Row label="Maximum fee" value={formatGBP(quote.max_fee)} bold />

          <div className="border-t border-border" />

          <Row label={`Upfront (${upfrontPct || 0}%)`} value={formatGBP(split.upfront)} />
          <Row label="Settlement" value={formatGBP(split.settlement)} />
          {soldOutExpected && (
            <Row
              label="Sell-out bonus (separate)"
              value={formatGBP(quote.sell_out_bonus)}
              muted
            />
          )}

          <div className="flex flex-wrap gap-1.5 pt-2">
            {quote.fee_cap_applied && (
              <Pill tone="amber">Fee cap applied</Pill>
            )}
            {quote.minimum_fee_applied && (
              <Pill tone="amber">Minimum fee applied</Pill>
            )}
            {!quote.fee_cap_applied && !quote.minimum_fee_applied && (
              <Pill tone="grey">Standard pricing</Pill>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

function Row({
  label,
  value,
  bold,
  muted,
}: {
  label: string;
  value: string;
  bold?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className={muted ? "text-muted-foreground" : "text-foreground"}>
        {label}
      </span>
      <span
        className={
          bold
            ? "font-semibold text-foreground"
            : muted
              ? "text-muted-foreground"
              : "text-foreground"
        }
      >
        {value}
      </span>
    </div>
  );
}

function Pill({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "amber" | "grey" | "green";
}) {
  const className =
    tone === "amber"
      ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300"
      : tone === "green"
        ? "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-300"
        : "bg-muted text-muted-foreground";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${className}`}
    >
      {children}
    </span>
  );
}
