import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  createQuoteWithInvoices,
  listQuotesServer,
} from "@/lib/db/invoicing-server";
import type {
  CreateQuoteRequest,
  QuoteStatus,
} from "@/lib/types/invoicing";
import type {
  ServiceTier,
  SettlementTiming,
} from "@/lib/pricing/calculator";

// ─────────────────────────────────────────────────────────────────────────────
// /api/invoicing/quotes
//
// GET  list   ?status=draft|approved|converted|cancelled (optional)
//             ?client_id=<uuid>                          (optional)
//
// POST create. Body: CreateQuoteRequest (see lib/types/invoicing.ts).
//             When approve=true, also generates invoice rows.
//
// Auth: session cookie. RLS enforces ownership at the database level.
// ─────────────────────────────────────────────────────────────────────────────

const SERVICE_TIERS: ServiceTier[] = ["ads", "ads_d2c", "ads_d2c_creative"];
const SETTLEMENT_TIMINGS: SettlementTiming[] = [
  "1_month_before",
  "2_weeks_before",
  "on_completion",
];
const QUOTE_STATUSES: QuoteStatus[] = [
  "draft",
  "approved",
  "converted",
  "cancelled",
];

function badRequest(message: string) {
  return NextResponse.json({ ok: false, error: message }, { status: 400 });
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Not signed in" },
      { status: 401 },
    );
  }

  const sp = req.nextUrl.searchParams;
  const status = sp.get("status");
  const clientId = sp.get("client_id");

  if (status && !QUOTE_STATUSES.includes(status as QuoteStatus)) {
    return badRequest(`Invalid status. One of: ${QUOTE_STATUSES.join(", ")}.`);
  }

  const quotes = await listQuotesServer(user.id, {
    status: (status as QuoteStatus | null) ?? undefined,
    client_id: clientId ?? undefined,
  });

  return NextResponse.json({ ok: true, quotes });
}

interface ParseResult {
  ok: true;
  request: CreateQuoteRequest;
}

interface ParseError {
  ok: false;
  error: string;
}

function parseBody(input: unknown): ParseResult | ParseError {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Body must be a JSON object." };
  }
  const b = input as Record<string, unknown>;

  const clientId = typeof b.client_id === "string" ? b.client_id : null;
  if (!clientId) return { ok: false, error: "client_id is required." };

  const eventName =
    typeof b.event_name === "string" ? b.event_name.trim() : "";
  if (!eventName) return { ok: false, error: "event_name is required." };

  const tier = b.service_tier;
  if (typeof tier !== "string" || !SERVICE_TIERS.includes(tier as ServiceTier)) {
    return {
      ok: false,
      error: `service_tier must be one of: ${SERVICE_TIERS.join(", ")}.`,
    };
  }

  const settlement = b.settlement_timing;
  if (
    typeof settlement !== "string" ||
    !SETTLEMENT_TIMINGS.includes(settlement as SettlementTiming)
  ) {
    return {
      ok: false,
      error: `settlement_timing must be one of: ${SETTLEMENT_TIMINGS.join(", ")}.`,
    };
  }

  const capacity = Number(b.capacity);
  if (!Number.isFinite(capacity) || capacity <= 0) {
    return { ok: false, error: "capacity must be a positive number." };
  }

  const upfrontPct = Number(b.upfront_pct);
  if (!Number.isFinite(upfrontPct) || upfrontPct < 0 || upfrontPct > 100) {
    return { ok: false, error: "upfront_pct must be between 0 and 100." };
  }

  const marketingBudget =
    b.marketing_budget == null ? null : Number(b.marketing_budget);
  if (
    marketingBudget != null &&
    (!Number.isFinite(marketingBudget) || marketingBudget < 0)
  ) {
    return { ok: false, error: "marketing_budget must be a non-negative number." };
  }

  const request: CreateQuoteRequest = {
    client_id: clientId,
    event_name: eventName,
    event_date: typeof b.event_date === "string" ? b.event_date : null,
    announcement_date:
      typeof b.announcement_date === "string" ? b.announcement_date : null,
    venue_name: typeof b.venue_name === "string" ? b.venue_name : null,
    venue_city: typeof b.venue_city === "string" ? b.venue_city : null,
    venue_country:
      typeof b.venue_country === "string" ? b.venue_country : null,
    capacity: Math.floor(capacity),
    marketing_budget: marketingBudget,
    service_tier: tier as ServiceTier,
    sold_out_expected: Boolean(b.sold_out_expected),
    upfront_pct: upfrontPct,
    settlement_timing: settlement as SettlementTiming,
    notes: typeof b.notes === "string" ? b.notes : null,
    approve: Boolean(b.approve),
  };

  return { ok: true, request };
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Not signed in" },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const parsed = parseBody(body);
  if (!parsed.ok) return badRequest(parsed.error);

  const { data: client, error: clientErr } = await supabase
    .from("clients")
    .select("id, user_id")
    .eq("id", parsed.request.client_id)
    .maybeSingle();
  if (clientErr) {
    return NextResponse.json(
      { ok: false, error: clientErr.message },
      { status: 500 },
    );
  }
  if (!client || client.user_id !== user.id) {
    return NextResponse.json(
      { ok: false, error: "Client not found" },
      { status: 404 },
    );
  }

  try {
    const { quote, invoices } = await createQuoteWithInvoices({
      userId: user.id,
      request: parsed.request,
    });
    return NextResponse.json({ ok: true, quote, invoices }, { status: 201 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create quote.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
