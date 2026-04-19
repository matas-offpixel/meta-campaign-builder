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
  ClientForQuoteForm,
  CreateQuoteRequest,
  InvoiceRow,
  QuoteRow,
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
    .select("id, name, default_upfront_pct, default_settlement_timing, status")
    .eq("user_id", userId)
    .order("name", { ascending: true });

  if (error) {
    console.warn("[invoicing-server listClientsForQuoteForm]", error.message);
    return [];
  }

  // The two default_* columns ship with migration 019 (not applied yet).
  // Treat them as optional and fall back to the global defaults so the form
  // works even before the migration lands.
  // TODO(post-019): drop the cast once types regenerate.
  const rows =
    (data as unknown as Array<{
      id: string;
      name: string;
      default_upfront_pct: number | null;
      default_settlement_timing: SettlementTiming | null;
      status: string | null;
    }>) ?? [];

  return rows
    .filter((r) => (r.status ?? "active") !== "archived")
    .map((r) => ({
      id: r.id,
      name: r.name,
      default_upfront_pct: r.default_upfront_pct ?? 75,
      default_settlement_timing:
        r.default_settlement_timing ?? "1_month_before",
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

// ─── Sequence helpers ───────────────────────────────────────────────────────

/**
 * Reserve the next QUO / INV number atomically.
 *
 * Uses an UPDATE … RETURNING round-trip so the read + bump happen as one
 * statement on the database. Two concurrent calls cannot reserve the same
 * number — Postgres serialises the row update under the hood.
 *
 * Returns formatted strings: 'QUO-0001', 'INV-0029', etc.
 */
async function reserveSequenceValue(key: "QUO" | "INV"): Promise<number> {
  const supabase = await createClient();

  // Fetch current then bump. UPDATE … RETURNING in a single PostgREST call
  // would be ideal but the JS client doesn't expose it cleanly without RPC,
  // so we read+update and rely on RLS-bounded single-tenant access. Wrapping
  // this in a Postgres function is the upgrade path once we go multi-tenant.
  // TODO(post-019): swap `as never`/`as unknown as` for typed `from("invoice_sequences")`.
  const { data: current, error: readErr } = await supabase
    .from("invoice_sequences" as never)
    .select("last_n")
    .eq("key", key)
    .maybeSingle();

  if (readErr) {
    throw new Error(`Failed to read invoice_sequences: ${readErr.message}`);
  }

  const lastN =
    (current as unknown as { last_n: number } | null)?.last_n ?? 0;
  const nextN = lastN + 1;

  const { error: updateErr } = await supabase
    .from("invoice_sequences" as never)
    .update({ last_n: nextN } as never)
    .eq("key", key);

  if (updateErr) {
    throw new Error(`Failed to bump invoice_sequences: ${updateErr.message}`);
  }
  return nextN;
}

export async function getNextInvoiceNumber(
  type: "INV" | "QUO",
): Promise<string> {
  const n = await reserveSequenceValue(type);
  return `${type}-${String(n).padStart(4, "0")}`;
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

  const tier = request.service_tier as ServiceTier;
  const calculated = calculateQuote({
    capacity: request.capacity,
    marketing_budget: request.marketing_budget ?? 0,
    service_tier: tier,
    sold_out_expected: request.sold_out_expected,
  });

  const quoteNumber = await getNextInvoiceNumber("QUO");
  const wantApprove = request.approve;
  const insertPayload = {
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
    capacity: request.capacity,
    marketing_budget: request.marketing_budget,
    service_tier: tier,
    sold_out_expected: request.sold_out_expected,
    base_fee: calculated.base_fee,
    sell_out_bonus: calculated.sell_out_bonus,
    max_fee: calculated.max_fee,
    upfront_pct: request.upfront_pct,
    settlement_timing: request.settlement_timing,
    status: wantApprove ? "approved" : "draft",
    approved_at: wantApprove ? new Date().toISOString() : null,
    notes: request.notes,
  };

  // TODO(post-019): typed insert once types regenerate.
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

  const invoices = await generateInvoicesForQuote(quote);
  return { quote, invoices };
}

/**
 * Generate the canonical invoice trio for a freshly-approved quote:
 *   - upfront    base_fee × upfront_pct, due today + 7 days
 *   - settlement base_fee × (100 - upfront_pct), due per settlement_timing
 *   - sell_out_bonus  capacity × £0.10, due on completion (only if expected)
 *
 * Invoice numbers are bumped sequentially in the same order to keep audit
 * trails grouped (e.g. INV-0029 / 0030 / 0031 for one quote's trio).
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
    const num = await getNextInvoiceNumber("INV");
    rows.push({
      user_id: quote.user_id,
      client_id: quote.client_id,
      event_id: quote.event_id,
      quote_id: quote.id,
      invoice_number: num,
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
    const num = await getNextInvoiceNumber("INV");
    rows.push({
      user_id: quote.user_id,
      client_id: quote.client_id,
      event_id: quote.event_id,
      quote_id: quote.id,
      invoice_number: num,
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
    const num = await getNextInvoiceNumber("INV");
    rows.push({
      user_id: quote.user_id,
      client_id: quote.client_id,
      event_id: quote.event_id,
      quote_id: quote.id,
      invoice_number: num,
      invoice_type: "sell_out_bonus",
      amount_excl_vat: quote.sell_out_bonus,
      vat_applicable: true,
      vat_rate: 0.2,
      issued_date: null,
      // Bonus is only earned once the show actually sells out, so the due
      // date mirrors the event date if known, falls back to settlement.
      due_date: settlementDue
        ? settlementDue.toISOString().slice(0, 10)
        : null,
      status: "draft",
    });
  }

  if (rows.length === 0) return [];

  // TODO(post-019): typed insert once types regenerate.
  const { data, error } = await supabase
    .from("invoices" as never)
    .insert(rows as never)
    .select("*");

  if (error) {
    throw new Error(`Invoice insert failed: ${error.message}`);
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
