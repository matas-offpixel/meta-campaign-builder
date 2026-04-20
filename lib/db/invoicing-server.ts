import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  calculateInvoiceAmounts,
  calculateQuote,
  calculateSettlementDueDate,
  type ServiceTier,
  type SettlementTiming,
} from "@/lib/pricing/calculator";
import type {
  BillingMode,
  ClientForQuoteForm,
  CreateQuoteRequest,
  InvoiceRow,
  InvoiceWithRefs,
  QuoteRow,
  QuoteWithRefs,
} from "@/lib/types/invoicing";

// ─────────────────────────────────────────────────────────────────────────────
// Server-only helpers for the invoicing surfaces.
//
// Read helpers live here so route handlers, server components, and the API
// layer all share one path. Write helpers (createQuoteWithInvoices,
// getNextInvoiceNumber, transitions) are added in Step 4.
//
// All Supabase calls go through createClient() which is RLS-bound, so
// callers do not need to filter by user_id explicitly — the policies in
// migration 019 enforce that for us.
//
// TODO(post-019): drop the `as never` / `as unknown as` casts once
// migration 019 is applied + types regenerated. They're flagged inline.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List clients with their default payment terms, for the quote builder
 * dropdown. Only returns active clients, sorted A→Z.
 */
export async function listClientsForQuoteFormServer(
  userId: string,
): Promise<ClientForQuoteForm[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .select(
      "id, name, default_upfront_pct, default_settlement_timing, status, custom_rate_per_ticket, custom_minimum_fee, billing_model, retainer_monthly_fee, retainer_started_at",
    )
    .eq("user_id", userId)
    .order("name", { ascending: true });

  if (error) {
    console.warn("[invoicing-server listClientsForQuoteForm]", error.message);
    return [];
  }

  type Raw = {
    id: string;
    name: string;
    default_upfront_pct: number | null;
    default_settlement_timing: SettlementTiming | null;
    status: string | null;
    custom_rate_per_ticket: number | null;
    custom_minimum_fee: number | null;
    billing_model: BillingMode | null;
    retainer_monthly_fee: number | null;
    retainer_started_at: string | null;
  };
  const rows = (data as unknown as Raw[]) ?? [];

  return rows
    .filter((r) => (r.status ?? "active") !== "archived")
    .map((r) => ({
      id: r.id,
      name: r.name,
      default_upfront_pct: r.default_upfront_pct ?? 75,
      default_settlement_timing:
        r.default_settlement_timing ?? "1_month_before",
      custom_rate_per_ticket: r.custom_rate_per_ticket,
      custom_minimum_fee: r.custom_minimum_fee,
      billing_model: (r.billing_model ?? "per_event") as BillingMode,
      retainer_monthly_fee: r.retainer_monthly_fee,
      retainer_started_at: r.retainer_started_at,
    }));
}

export async function getQuoteByIdServer(
  id: string,
): Promise<QuoteRow | null> {
  const supabase = await createClient();
  // TODO(post-019): swap `as never` for typed `from("quotes")`.
  const { data, error } = await supabase
    .from("quotes" as never)
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.warn("[invoicing-server getQuoteById]", error.message);
    return null;
  }
  return (data as unknown as QuoteRow | null) ?? null;
}

export async function listQuotesServer(
  userId: string,
  filter?: { client_id?: string; status?: QuoteRow["status"] },
): Promise<QuoteRow[]> {
  const supabase = await createClient();
  // TODO(post-019): swap `as never` for typed `from("quotes")`.
  let query = supabase
    .from("quotes" as never)
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (filter?.client_id) query = query.eq("client_id", filter.client_id);
  if (filter?.status) query = query.eq("status", filter.status);

  const { data, error } = await query;
  if (error) {
    console.warn("[invoicing-server listQuotes]", error.message);
    return [];
  }
  return ((data as unknown as QuoteRow[] | null) ?? []) as QuoteRow[];
}

/**
 * Build name lookup tables for a list of client / event ids.
 *
 * Used by the dashboard list helpers to denormalise refs in one round-trip
 * instead of N+1 lookups. Returns Maps so callers can do trivial joins.
 */
async function fetchNameMaps(
  clientIds: Set<string>,
  eventIds: Set<string>,
): Promise<{
  clients: Map<string, string>;
  events: Map<string, string>;
}> {
  const supabase = await createClient();
  const clients = new Map<string, string>();
  const events = new Map<string, string>();

  if (clientIds.size > 0) {
    const { data, error } = await supabase
      .from("clients")
      .select("id, name")
      .in("id", Array.from(clientIds));
    if (!error && data) {
      for (const row of data as Array<{ id: string; name: string | null }>) {
        if (row.id && row.name) clients.set(row.id, row.name);
      }
    }
  }

  if (eventIds.size > 0) {
    const { data, error } = await supabase
      .from("events")
      .select("id, name")
      .in("id", Array.from(eventIds));
    if (!error && data) {
      for (const row of data as Array<{ id: string; name: string | null }>) {
        if (row.id && row.name) events.set(row.id, row.name);
      }
    }
  }

  return { clients, events };
}

/**
 * Dashboard helper: every invoice for the user with client + event names
 * resolved alongside. Sorted newest-first so the master table always
 * surfaces the most recent activity at the top.
 */
export async function listInvoicesWithRefsServer(
  userId: string,
): Promise<InvoiceWithRefs[]> {
  const invoices = await listInvoicesServer(userId);
  if (invoices.length === 0) return [];

  const clientIds = new Set<string>();
  const eventIds = new Set<string>();
  for (const inv of invoices) {
    if (inv.client_id) clientIds.add(inv.client_id);
    if (inv.event_id) eventIds.add(inv.event_id);
  }

  const { clients, events } = await fetchNameMaps(clientIds, eventIds);
  return invoices.map((inv) => ({
    ...inv,
    client_name: clients.get(inv.client_id) ?? null,
    event_name: inv.event_id ? (events.get(inv.event_id) ?? null) : null,
  }));
}

/**
 * Dashboard helper: every quote for the user with client name resolved.
 * Same fan-out pattern as listInvoicesWithRefsServer.
 */
export async function listQuotesWithRefsServer(
  userId: string,
): Promise<QuoteWithRefs[]> {
  const quotes = await listQuotesServer(userId);
  if (quotes.length === 0) return [];

  const clientIds = new Set<string>();
  for (const q of quotes) if (q.client_id) clientIds.add(q.client_id);

  const { clients } = await fetchNameMaps(clientIds, new Set());
  return quotes.map((q) => ({
    ...q,
    client_name: clients.get(q.client_id) ?? null,
  }));
}

/**
 * Per-client view: every invoice for the client, with denormalised event
 * names resolved alongside. Used by the client detail page's Invoicing tab.
 */
export async function listInvoicesForClientWithRefsServer(
  userId: string,
  clientId: string,
): Promise<InvoiceWithRefs[]> {
  const invoices = await listInvoicesServer(userId, { client_id: clientId });
  if (invoices.length === 0) return [];

  const eventIds = new Set<string>();
  for (const inv of invoices) {
    if (inv.event_id) eventIds.add(inv.event_id);
  }

  const { events } = await fetchNameMaps(new Set(), eventIds);
  return invoices.map((inv) => ({
    ...inv,
    // Client name is the page itself — the caller already knows it.
    client_name: null,
    event_name: inv.event_id ? (events.get(inv.event_id) ?? null) : null,
  }));
}

/**
 * Find the quote that spawned an event, if any. Used by the event detail
 * page to render the "From quote QUO-XXXX" badge + linked invoice panel.
 */
export async function getQuoteForEventServer(
  eventId: string,
): Promise<QuoteRow | null> {
  const supabase = await createClient();
  // TODO(post-019): typed `from("quotes")`.
  const { data, error } = await supabase
    .from("quotes" as never)
    .select("*")
    .eq("event_id", eventId)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("[invoicing-server getQuoteForEvent]", error.message);
    return null;
  }
  return (data as unknown as QuoteRow | null) ?? null;
}

export async function listInvoicesForEventServer(
  eventId: string,
): Promise<InvoiceRow[]> {
  const supabase = await createClient();
  // TODO(post-019): typed `from("invoices")`.
  const { data, error } = await supabase
    .from("invoices" as never)
    .select("*")
    .eq("event_id", eventId)
    .order("created_at", { ascending: true });
  if (error) {
    console.warn("[invoicing-server listInvoicesForEvent]", error.message);
    return [];
  }
  return ((data as unknown as InvoiceRow[]) ?? []) as InvoiceRow[];
}

export async function listInvoicesForQuoteServer(
  quoteId: string,
): Promise<InvoiceRow[]> {
  const supabase = await createClient();
  // TODO(post-019): swap `as never` for typed `from("invoices")`.
  const { data, error } = await supabase
    .from("invoices" as never)
    .select("*")
    .eq("quote_id", quoteId)
    .order("created_at", { ascending: true });

  if (error) {
    console.warn("[invoicing-server listInvoicesForQuote]", error.message);
    return [];
  }
  return ((data as unknown as InvoiceRow[] | null) ?? []) as InvoiceRow[];
}

// ─── Quote numbering ────────────────────────────────────────────────────────

/**
 * Compute the next QUO-XXXX number for the given user by scanning their
 * existing quote_numbers — no sequences table.
 *
 * Two concurrent quote creates can race here. Acceptable trade-off: the
 * DB-level UNIQUE (user_id, quote_number) constraint will reject the loser,
 * the UI surfaces the error, the user retries. In practice, a single user
 * almost never races themselves.
 *
 * Invoice numbers (INV-XXXX) are no longer derived — they're entered
 * manually post-creation via updateInvoiceNumber().
 */
export async function getNextQuoteNumber(userId: string): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("quotes" as never)
    .select("quote_number")
    .eq("user_id", userId)
    .like("quote_number", "QUO-%");

  if (error) {
    throw new Error(`Failed to read existing quote numbers: ${error.message}`);
  }

  let maxN = 0;
  for (const row of (data as unknown as Array<{ quote_number: string }>) ??
    []) {
    const m = /^QUO-(\d+)$/.exec(row.quote_number ?? "");
    if (!m) continue;
    const n = Number.parseInt(m[1], 10);
    if (Number.isFinite(n) && n > maxN) maxN = n;
  }
  return `QUO-${String(maxN + 1).padStart(4, "0")}`;
}

// ─── Create / update quotes + invoices ─────────────────────────────────────

interface CreateQuoteOpts {
  userId: string;
  request: CreateQuoteRequest;
}

interface CreateQuoteResult {
  quote: QuoteRow;
  invoices: InvoiceRow[];
}

/**
 * Create a quote and (when approve=true) generate its invoice rows.
 *
 * Not a true Postgres transaction — Supabase JS doesn't expose one without
 * an RPC. Failure modes:
 *   - Quote insert fails        → nothing persisted, error bubbles
 *   - Quote insert succeeds but invoice inserts fail
 *                                → quote stays in 'draft' so the user can
 *                                  retry the approve transition manually.
 * Once we have an RPC budget this should move to a single PL/pgSQL function.
 */
export async function createQuoteWithInvoices(
  opts: CreateQuoteOpts,
): Promise<CreateQuoteResult> {
  const { userId, request } = opts;
  const supabase = await createClient();

  const isRetainer = request.billing_mode === "retainer";

  // Pull client overrides + retainer fee in one shot so the calculator and
  // retainer path both work off the same source of truth.
  const { data: clientRow } = await supabase
    .from("clients")
    .select(
      "custom_rate_per_ticket, custom_minimum_fee, billing_model, retainer_monthly_fee",
    )
    .eq("id", request.client_id)
    .maybeSingle();

  const overrides = clientRow as unknown as {
    custom_rate_per_ticket: number | null;
    custom_minimum_fee: number | null;
    billing_model: BillingMode | null;
    retainer_monthly_fee: number | null;
  } | null;

  let baseFee: number;
  let sellOutBonus: number;
  let maxFee: number;

  if (isRetainer) {
    const months = Math.max(1, Math.floor(request.retainer_months ?? 1));
    const monthly = Number(overrides?.retainer_monthly_fee ?? 0);
    baseFee = Math.round(monthly * months * 100) / 100;
    sellOutBonus = 0;
    maxFee = baseFee;
  } else {
    const tier = request.service_tier as ServiceTier;
    const calculated = calculateQuote(
      {
        capacity: request.capacity,
        marketing_budget: request.marketing_budget ?? 0,
        service_tier: tier,
        sold_out_expected: request.sold_out_expected,
      },
      {
        customRatePerTicket: overrides?.custom_rate_per_ticket ?? null,
        customMinimumFee: overrides?.custom_minimum_fee ?? null,
      },
    );
    baseFee = calculated.base_fee;
    sellOutBonus = calculated.sell_out_bonus;
    maxFee = calculated.max_fee;
  }

  const quoteNumber = await getNextQuoteNumber(userId);
  const wantApprove = request.approve;

  // Retainer quotes are paid 100% per month — force the snapshot upfront_pct
  // to 100 and the settlement_timing to on_completion so the QuoteRow is
  // self-consistent regardless of what the form sent.
  const upfrontPct = isRetainer ? 100 : request.upfront_pct;
  const settlementTiming: SettlementTiming = isRetainer
    ? "on_completion"
    : request.settlement_timing;

  const insertPayload: Record<string, unknown> = {
    user_id: userId,
    client_id: request.client_id,
    event_id: null,
    quote_number: quoteNumber,
    event_name: request.event_name,
    event_date: request.event_date,
    announcement_date: request.announcement_date,
    venue_name: request.venue_name,
    venue_city: request.venue_city,
    venue_country: request.venue_country,
    capacity: isRetainer ? 0 : request.capacity,
    marketing_budget: request.marketing_budget,
    service_tier: isRetainer ? "ads" : (request.service_tier as ServiceTier),
    sold_out_expected: isRetainer ? false : request.sold_out_expected,
    base_fee: baseFee,
    sell_out_bonus: sellOutBonus,
    max_fee: maxFee,
    upfront_pct: upfrontPct,
    settlement_timing: settlementTiming,
    billing_mode: isRetainer ? "retainer" : "per_event",
    retainer_months: isRetainer
      ? Math.max(1, Math.floor(request.retainer_months ?? 1))
      : null,
    status: wantApprove ? "approved" : "draft",
    approved_at: wantApprove ? new Date().toISOString() : null,
    notes: request.notes,
  };

  const { data: quoteRow, error: insertErr } = await supabase
    .from("quotes" as never)
    .insert(insertPayload as never)
    .select("*")
    .maybeSingle();

  if (insertErr) {
    throw new Error(`Quote insert failed: ${insertErr.message}`);
  }
  if (!quoteRow) {
    throw new Error("Quote insert returned no row.");
  }
  const quote = quoteRow as unknown as QuoteRow;

  if (!wantApprove) {
    return { quote, invoices: [] };
  }

  const invoices = isRetainer
    ? await generateRetainerInvoices(
        quote,
        Number(overrides?.retainer_monthly_fee ?? 0),
      )
    : await generateInvoicesForQuote(quote);
  return { quote, invoices };
}

/**
 * Generate the canonical invoice trio for a freshly-approved per-event
 * quote:
 *   - upfront         base_fee × upfront_pct, due today + 7 days
 *   - settlement      base_fee × (100 - upfront_pct), due per timing rule
 *   - sell_out_bonus  capacity × £0.10, due on completion (when expected)
 *
 * Invoice numbers are NOT assigned at create time — the user types them in
 * manually post-creation via PATCH /api/invoicing/invoices/[id].
 */
export async function generateInvoicesForQuote(
  quote: QuoteRow,
): Promise<InvoiceRow[]> {
  const supabase = await createClient();

  const split = calculateInvoiceAmounts(
    { base_fee: quote.base_fee },
    quote.upfront_pct,
  );

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const upfrontDue = new Date(today);
  upfrontDue.setUTCDate(upfrontDue.getUTCDate() + 7);

  const settlementDue = calculateSettlementDueDate(
    quote.event_date ? new Date(quote.event_date) : null,
    quote.settlement_timing,
  );

  const rows: Array<Record<string, unknown>> = [];

  if (split.upfront > 0) {
    rows.push({
      user_id: quote.user_id,
      client_id: quote.client_id,
      event_id: quote.event_id,
      quote_id: quote.id,
      invoice_number: null,
      invoice_type: "upfront",
      amount_excl_vat: split.upfront,
      vat_applicable: true,
      vat_rate: 0.2,
      issued_date: null,
      due_date: upfrontDue.toISOString().slice(0, 10),
      status: "draft",
    });
  }

  if (split.settlement > 0) {
    rows.push({
      user_id: quote.user_id,
      client_id: quote.client_id,
      event_id: quote.event_id,
      quote_id: quote.id,
      invoice_number: null,
      invoice_type: "settlement",
      amount_excl_vat: split.settlement,
      vat_applicable: true,
      vat_rate: 0.2,
      issued_date: null,
      due_date: settlementDue
        ? settlementDue.toISOString().slice(0, 10)
        : null,
      status: "draft",
    });
  }

  if (quote.sold_out_expected && quote.sell_out_bonus > 0) {
    rows.push({
      user_id: quote.user_id,
      client_id: quote.client_id,
      event_id: quote.event_id,
      quote_id: quote.id,
      invoice_number: null,
      invoice_type: "sell_out_bonus",
      amount_excl_vat: quote.sell_out_bonus,
      vat_applicable: true,
      vat_rate: 0.2,
      issued_date: null,
      due_date: settlementDue
        ? settlementDue.toISOString().slice(0, 10)
        : null,
      status: "draft",
    });
  }

  if (rows.length === 0) return [];

  const { data, error } = await supabase
    .from("invoices" as never)
    .insert(rows as never)
    .select("*");

  if (error) {
    throw new Error(`Invoice insert failed: ${error.message}`);
  }
  return ((data as unknown as InvoiceRow[]) ?? []) as InvoiceRow[];
}

/**
 * Generate one invoice per month for a retainer-mode quote.
 *
 * Each row is invoice_type = 'retainer', amount = monthly fee,
 * due_date = the 1st of each month from retainer_started_at (or today)
 * forward. Invoice numbers stay null — the user types them in manually
 * as they bill each month.
 */
export async function generateRetainerInvoices(
  quote: QuoteRow,
  monthlyFee: number,
): Promise<InvoiceRow[]> {
  const supabase = await createClient();
  const months = Math.max(1, Math.floor(quote.retainer_months ?? 1));
  if (monthlyFee <= 0) return [];

  // Anchor month: event_date if set (retainer "engagement start"), else today.
  const start = quote.event_date ? new Date(quote.event_date) : new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);

  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < months; i++) {
    const due = new Date(start);
    due.setUTCMonth(due.getUTCMonth() + i);
    rows.push({
      user_id: quote.user_id,
      client_id: quote.client_id,
      event_id: quote.event_id,
      quote_id: quote.id,
      invoice_number: null,
      invoice_type: "retainer",
      amount_excl_vat: monthlyFee,
      vat_applicable: true,
      vat_rate: 0.2,
      issued_date: null,
      due_date: due.toISOString().slice(0, 10),
      status: "draft",
    });
  }

  const { data, error } = await supabase
    .from("invoices" as never)
    .insert(rows as never)
    .select("*");

  if (error) {
    throw new Error(`Retainer invoice insert failed: ${error.message}`);
  }
  return ((data as unknown as InvoiceRow[]) ?? []) as InvoiceRow[];
}

// ─── Update helpers ─────────────────────────────────────────────────────────

const QUOTE_PATCH_FIELDS = [
  "status",
  "approved_at",
  "converted_at",
  "event_id",
  "notes",
] as const;

export type QuotePatchField = (typeof QUOTE_PATCH_FIELDS)[number];

export function buildQuotePatch(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of QUOTE_PATCH_FIELDS) {
    if (k in body) out[k] = body[k];
  }
  return out;
}

export async function updateQuote(
  id: string,
  patch: Record<string, unknown>,
): Promise<QuoteRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("quotes" as never)
    .update(patch as never)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as unknown as QuoteRow | null) ?? null;
}

const INVOICE_PATCH_FIELDS = [
  "status",
  "issued_date",
  "due_date",
  "paid_date",
  "notes",
  "invoice_number",
] as const;

export type InvoicePatchField = (typeof INVOICE_PATCH_FIELDS)[number];

export function buildInvoicePatch(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of INVOICE_PATCH_FIELDS) {
    if (k in body) out[k] = body[k];
  }
  return out;
}

export async function updateInvoice(
  id: string,
  patch: Record<string, unknown>,
): Promise<InvoiceRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoices" as never)
    .update(patch as never)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as unknown as InvoiceRow | null) ?? null;
}

/**
 * Set the human invoice number on a row (e.g. "INV-0029").
 *
 * Pass an empty string to clear it back to null. Uniqueness is enforced
 * server-side via the partial unique index in migration 019.
 */
export async function updateInvoiceNumber(
  invoiceId: string,
  invoiceNumber: string | null,
): Promise<InvoiceRow | null> {
  const trimmed =
    typeof invoiceNumber === "string" ? invoiceNumber.trim() : invoiceNumber;
  return updateInvoice(invoiceId, {
    invoice_number: trimmed === "" ? null : trimmed,
  });
}

export async function getInvoiceById(id: string): Promise<InvoiceRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoices" as never)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as unknown as InvoiceRow | null) ?? null;
}

export async function listInvoicesServer(
  userId: string,
  filter?: {
    client_id?: string;
    event_id?: string;
    status?: InvoiceRow["status"];
  },
): Promise<InvoiceRow[]> {
  const supabase = await createClient();
  // TODO(post-019): swap `as never` for typed `from("invoices")`.
  let query = supabase
    .from("invoices" as never)
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (filter?.client_id) query = query.eq("client_id", filter.client_id);
  if (filter?.event_id) query = query.eq("event_id", filter.event_id);
  if (filter?.status) query = query.eq("status", filter.status);

  const { data, error } = await query;
  if (error) {
    console.warn("[invoicing-server listInvoices]", error.message);
    return [];
  }
  return ((data as unknown as InvoiceRow[] | null) ?? []) as InvoiceRow[];
}
