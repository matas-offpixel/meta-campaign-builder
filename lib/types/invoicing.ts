// ─────────────────────────────────────────────────────────────────────────────
// Invoicing domain types.
//
// We deliberately do NOT re-export Tables<"quotes"> / Tables<"invoices">
// from the generated database.types.ts — Supabase serialises CHECK-
// constrained text columns (status, invoice_type, billing_mode, etc.)
// as plain `string`, which throws away the discriminated unions we
// rely on across the UI and the API. The interfaces below mirror the
// regenerated schema (post migrations 019 + 021) but tighten those
// columns into proper enums.
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
  | "retainer"
  | "other";

/**
 * How a client is billed.
 *
 *   per_event  - one quote per show, generates upfront + settlement +
 *                optional sell-out-bonus invoices via the standard pricing
 *                calculator.
 *   retainer   - flat monthly fee for ongoing services. Quote total =
 *                retainer_monthly_fee × retainer_months, billed 100%
 *                per month with one invoice per month.
 */
export type BillingMode = "per_event" | "retainer";

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
  /**
   * Quote-level billing mode snapshot. NULL on legacy rows (treated as
   * 'per_event'). Retainer quotes also carry retainer_months below.
   */
  billing_mode: BillingMode | null;
  retainer_months: number | null;
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
  /** Manually entered post-creation. Null until the user types it in. */
  invoice_number: string | null;
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
   * Per-event vs retainer. Defaults to 'per_event' for backwards compat.
   * When 'retainer', service_tier / capacity / sold_out_expected are
   * ignored — pricing comes from the client's retainer_monthly_fee
   * multiplied by retainer_months.
   */
  billing_mode?: BillingMode;
  retainer_months?: number | null;
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
  /**
   * Custom per-ticket rate that overrides the tier rate when set.
   * Null = use the standard tier table.
   */
  custom_rate_per_ticket: number | null;
  /** Custom minimum fee that overrides the £750 floor when set. */
  custom_minimum_fee: number | null;
  /** 'per_event' (default) or 'retainer'. */
  billing_model: BillingMode;
  /** Monthly retainer fee in £; only meaningful when billing_model='retainer'. */
  retainer_monthly_fee: number | null;
  retainer_started_at: string | null;
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
