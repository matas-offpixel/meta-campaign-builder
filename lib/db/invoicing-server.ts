import "server-only";

import { createClient } from "@/lib/supabase/server";
import type {
  ClientForQuoteForm,
  InvoiceRow,
  QuoteRow,
} from "@/lib/types/invoicing";
import type { SettlementTiming } from "@/lib/pricing/calculator";

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
