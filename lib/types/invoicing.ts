// ─────────────────────────────────────────────────────────────────────────────
// Invoicing domain types.
//
// Not derived from lib/db/database.types.ts because migration 019 hasn't
// been applied to the live Supabase project yet — these types stand in
// until `supabase gen types` is re-run, at which point we can switch to
// `Tables<"quotes">` and `Tables<"invoices">` directly.
//
// TODO(post-019): once migration 019 is applied + types regenerated,
// drop the manual definitions below and re-export `Tables<"quotes">` etc.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  ServiceTier,
  SettlementTiming,
} from "@/lib/pricing/calculator";

export type QuoteStatus =
  | "draft"
  | "approved"
  | "converted"
  | "cancelled";

export type InvoiceStatus =
  | "draft"
  | "sent"
  | "paid"
  | "overdue"
  | "cancelled";

export type InvoiceType =
  | "upfront"
  | "settlement"
  | "sell_out_bonus"
  | "other";

export interface QuoteRow {
  id: string;
  user_id: string;
  client_id: string;
  event_id: string | null;
  quote_number: string;
  event_name: string;
  event_date: string | null;
  announcement_date: string | null;
  venue_name: string | null;
  venue_city: string | null;
  venue_country: string | null;
  capacity: number;
  marketing_budget: number | null;
  service_tier: ServiceTier;
  sold_out_expected: boolean;
  base_fee: number;
  sell_out_bonus: number;
  max_fee: number;
  upfront_pct: number;
  settlement_timing: SettlementTiming;
  status: QuoteStatus;
  approved_at: string | null;
  converted_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceRow {
  id: string;
  user_id: string;
  client_id: string;
  event_id: string | null;
  quote_id: string | null;
  invoice_number: string;
  invoice_type: InvoiceType;
  amount_excl_vat: number;
  vat_applicable: boolean;
  vat_rate: number;
  amount_incl_vat: number;
  issued_date: string | null;
  due_date: string | null;
  paid_date: string | null;
  status: InvoiceStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** Form payload for POST /api/invoicing/quotes. */
export interface CreateQuoteRequest {
  client_id: string;
  event_name: string;
  event_date: string | null;
  announcement_date: string | null;
  venue_name: string | null;
  venue_city: string | null;
  venue_country: string | null;
  capacity: number;
  marketing_budget: number | null;
  service_tier: ServiceTier;
  sold_out_expected: boolean;
  upfront_pct: number;
  settlement_timing: SettlementTiming;
  notes: string | null;
  /**
   * "draft"    save without generating invoices
   * "approved" save AND auto-generate invoice rows
   */
  approve: boolean;
}

export interface CreateQuoteResponse {
  ok: true;
  quote: QuoteRow;
  invoices: InvoiceRow[];
}

/** Slim shape passed into the QuoteForm — only what the form needs. */
export interface ClientForQuoteForm {
  id: string;
  name: string;
  default_upfront_pct: number;
  default_settlement_timing: SettlementTiming;
}

/** Invoice + denormalised client/event names for dashboard tables. */
export interface InvoiceWithRefs extends InvoiceRow {
  client_name: string | null;
  event_name: string | null;
}

/** Quote + denormalised client/event names for the Quotes tab. */
export interface QuoteWithRefs extends QuoteRow {
  client_name: string | null;
}
