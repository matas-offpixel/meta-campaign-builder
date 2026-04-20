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

const MONTH_FORMAT = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
});

function formatRetainerRange(months: number): string {
  const start = new Date();
  start.setUTCDate(1);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + Math.max(1, months) - 1);
  return months <= 1
    ? MONTH_FORMAT.format(start)
    : `${MONTH_FORMAT.format(start)} to ${MONTH_FORMAT.format(end)}`;
}

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

  // Retainer-mode month count (only used when the selected client is on
  // billing_model = 'retainer'). 1 month default, capped at 60 to match the
  // server-side validator.
  const [retainerMonths, setRetainerMonths] = useState("1");

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

  const isRetainer = selectedClient?.billing_model === "retainer";
  const retainerFee = Number(selectedClient?.retainer_monthly_fee ?? 0);
  const retainerMonthsNum = Math.max(
    1,
    Math.floor(Number.parseInt(retainerMonths || "1", 10) || 1),
  );

  // Live-quote inputs go through calculateQuote() with the client overrides
  // applied so the rail mirrors what the server will compute on save.
  // Retainer clients skip this entirely — the rail switches to monthly fee
  // × months math instead (see below).
  const overrides = useMemo(
    () => ({
      customRatePerTicket: selectedClient?.custom_rate_per_ticket ?? null,
      customMinimumFee: selectedClient?.custom_minimum_fee ?? null,
    }),
    [selectedClient],
  );

  const quote = useMemo(
    () =>
      calculateQuote(
        {
          capacity: Number.parseInt(capacity || "0", 10),
          marketing_budget: Number.parseFloat(marketingBudget || "0"),
          service_tier: serviceTier,
          sold_out_expected: soldOutExpected,
        },
        overrides,
      ),
    [capacity, marketingBudget, serviceTier, soldOutExpected, overrides],
  );

  const retainerTotal = useMemo(
    () => Math.round(retainerFee * retainerMonthsNum * 100) / 100,
    [retainerFee, retainerMonthsNum],
  );

  const split = useMemo(
    () =>
      calculateInvoiceAmounts(
        { base_fee: isRetainer ? retainerTotal : quote.base_fee },
        isRetainer ? 100 : Number.parseFloat(upfrontPct || "0"),
      ),
    [quote.base_fee, upfrontPct, isRetainer, retainerTotal],
  );

  const effectivePerTicket =
    overrides.customRatePerTicket && overrides.customRatePerTicket > 0
      ? overrides.customRatePerTicket
      : PER_TICKET_RATE[serviceTier];

  async function handleSubmit(mode: SubmitMode) {
    if (!clientId) {
      setError("Pick a client first.");
      return;
    }
    let effectiveEventName = eventName.trim();
    if (isRetainer && !effectiveEventName) {
      effectiveEventName = `Monthly retainer — ${formatRetainerRange(
        retainerMonthsNum,
      )}`;
    }
    if (!effectiveEventName) {
      setError("Event name is required.");
      return;
    }
    if (isRetainer && retainerFee <= 0) {
      setError(
        "This client is on a retainer plan but no monthly fee is set. Update the client's billing settings first.",
      );
      return;
    }
    setSubmitting(mode);
    setError(null);
    try {
      const payload: CreateQuoteRequest = {
        client_id: clientId,
        event_name: effectiveEventName,
        event_date: eventDate || null,
        announcement_date: announcementDate || null,
        venue_name: venueName.trim() || null,
        venue_city: venueCity.trim() || null,
        venue_country: venueCountry.trim() || null,
        capacity: isRetainer ? 0 : Number.parseInt(capacity || "0", 10),
        marketing_budget: marketingBudget
          ? Number.parseFloat(marketingBudget)
          : null,
        service_tier: serviceTier,
        sold_out_expected: isRetainer ? false : soldOutExpected,
        upfront_pct: isRetainer ? 100 : Number.parseFloat(upfrontPct || "0"),
        settlement_timing: isRetainer ? "on_completion" : settlementTiming,
        billing_mode: isRetainer ? "retainer" : "per_event",
        retainer_months: isRetainer ? retainerMonthsNum : null,
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

          {!isRetainer && (
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
                {formatGBP(effectivePerTicket)} per ticket
                {overrides.customRatePerTicket != null && (
                  <span className="ml-1 text-amber-700 dark:text-amber-400">
                    (custom rate for {selectedClient?.name})
                  </span>
                )}
              </p>
            </div>
          )}
        </section>

        {/* SECTION 2 — Pricing inputs */}
        {isRetainer ? (
          <section className="rounded-md border border-amber-200 bg-amber-50/40 p-5 space-y-4 dark:border-amber-900 dark:bg-amber-950/20">
            <div>
              <h2 className="font-heading text-base tracking-wide">
                Monthly retainer
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {selectedClient?.name} is on a retainer plan. Per-ticket
                pricing doesn&apos;t apply — the quote total is the monthly fee
                multiplied by the number of months billed.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-md border border-border bg-background p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Monthly fee
                </p>
                <p className="mt-1 text-lg font-semibold">
                  {formatGBP(retainerFee)}
                </p>
                {retainerFee <= 0 && (
                  <p className="mt-1 text-xs text-destructive">
                    Set a retainer fee on the client&apos;s billing settings.
                  </p>
                )}
              </div>
              <Input
                id="quote-retainer-months"
                label="Months billed"
                type="number"
                min={1}
                max={60}
                step={1}
                value={retainerMonths}
                onChange={(e) => setRetainerMonths(e.target.value)}
              />
            </div>

            <p className="text-xs text-muted-foreground">
              {formatRetainerRange(retainerMonthsNum)}
            </p>
          </section>
        ) : (
          <section className="rounded-md border border-border bg-card p-5 space-y-4">
            <h2 className="font-heading text-base tracking-wide">
              Pricing inputs
            </h2>

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

            {selectedClient && overrides.customMinimumFee != null && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Minimum fee override: {formatGBP(overrides.customMinimumFee)}{" "}
                (default £750).
              </p>
            )}
          </section>
        )}

        {/* SECTION 3 — Payment terms */}
        <section className="rounded-md border border-border bg-card p-5 space-y-4">
          <h2 className="font-heading text-base tracking-wide">Payment terms</h2>

          {isRetainer ? (
            <p className="text-sm text-muted-foreground">
              Retainers are billed 100% per month — payment terms are fixed at
              <span className="font-medium text-foreground"> 100% upfront </span>
              with no settlement split.
            </p>
          ) : (
            <>
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
            </>
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
          <div className="flex items-center justify-between">
            <h3 className="font-heading text-base tracking-wide">Live quote</h3>
            <Pill tone={isRetainer ? "amber" : "grey"}>
              {isRetainer ? "Monthly Retainer" : "Per Event"}
            </Pill>
          </div>

          {isRetainer ? (
            <>
              <Row
                label={`Monthly fee × ${retainerMonthsNum}`}
                value={formatGBP(retainerFee * retainerMonthsNum)}
                bold
              />
              <div className="border-t border-border" />
              <Row label="Total" value={formatGBP(retainerTotal)} bold />

              <div className="border-t border-border" />

              <Row label="Per month invoice" value={formatGBP(retainerFee)} />
              <p className="text-xs text-muted-foreground">
                {retainerMonthsNum} invoice
                {retainerMonthsNum === 1 ? "" : "s"} created — one per month,
                100% upfront, no settlement.
              </p>

              <div className="flex flex-wrap gap-1.5 pt-2">
                <Pill tone={retainerFee > 0 ? "green" : "amber"}>
                  {retainerFee > 0 ? "Retainer ready" : "Set monthly fee"}
                </Pill>
              </div>
            </>
          ) : (
            <>
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

              <Row
                label={`Upfront (${upfrontPct || 0}%)`}
                value={formatGBP(split.upfront)}
              />
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
                {overrides.customRatePerTicket != null && (
                  <Pill tone="amber">Custom rate</Pill>
                )}
                {overrides.customMinimumFee != null && (
                  <Pill tone="amber">Custom minimum</Pill>
                )}
                {!quote.fee_cap_applied &&
                  !quote.minimum_fee_applied &&
                  overrides.customRatePerTicket == null &&
                  overrides.customMinimumFee == null && (
                    <Pill tone="grey">Standard pricing</Pill>
                  )}
              </div>
            </>
          )}
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
