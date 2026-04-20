import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  buildQuotePatch,
  generateInvoicesForQuote,
  getQuoteByIdServer,
  listInvoicesForQuoteServer,
  updateInvoice,
  updateQuote,
} from "@/lib/db/invoicing-server";
import type { QuoteRow, QuoteStatus } from "@/lib/types/invoicing";

// ─────────────────────────────────────────────────────────────────────────────
// /api/invoicing/quotes/[id]
//
// GET    quote + invoices
// PATCH  status transitions + notes
//
// Allowed status transitions:
//   draft     → approved | cancelled
//   approved  → converted | cancelled
//   converted → (no further status changes)
//   cancelled → (terminal)
//
// On draft → approved:  generate the invoice trio (idempotent — skipped if
//                        invoices already exist for this quote).
// On any → cancelled:    also cancel any non-paid invoices.
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_TRANSITIONS: Record<QuoteStatus, QuoteStatus[]> = {
  draft: ["approved", "cancelled"],
  approved: ["converted", "cancelled"],
  converted: [],
  cancelled: [],
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
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

  const quote = await getQuoteByIdServer(id);
  if (!quote || quote.user_id !== user.id) {
    return NextResponse.json(
      { ok: false, error: "Not found" },
      { status: 404 },
    );
  }
  const invoices = await listInvoicesForQuoteServer(id);
  return NextResponse.json({ ok: true, quote, invoices });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
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

  const existing = await getQuoteByIdServer(id);
  if (!existing || existing.user_id !== user.id) {
    return NextResponse.json(
      { ok: false, error: "Not found" },
      { status: 404 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { ok: false, error: "Body must be a JSON object" },
      { status: 400 },
    );
  }

  const patch = buildQuotePatch(body as Record<string, unknown>);
  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "No updatable fields. Allowed: status, approved_at, converted_at, event_id, notes.",
      },
      { status: 400 },
    );
  }

  if (patch.status) {
    const next = patch.status as QuoteStatus;
    const allowed = ALLOWED_TRANSITIONS[existing.status] ?? [];
    if (!allowed.includes(next)) {
      return NextResponse.json(
        {
          ok: false,
          error: `Cannot transition ${existing.status} → ${next}.`,
        },
        { status: 400 },
      );
    }
    if (next === "approved" && !patch.approved_at) {
      patch.approved_at = new Date().toISOString();
    }
    if (next === "converted" && !patch.converted_at) {
      patch.converted_at = new Date().toISOString();
    }
  }

  let updated: QuoteRow | null;
  try {
    updated = await updateQuote(id, patch);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Update failed." },
      { status: 500 },
    );
  }
  if (!updated) {
    return NextResponse.json(
      { ok: false, error: "Update returned no row." },
      { status: 500 },
    );
  }

  let invoices = await listInvoicesForQuoteServer(id);

  // Approval side-effect: generate invoices if there aren't any yet.
  if (
    patch.status === "approved" &&
    existing.status !== "approved" &&
    invoices.length === 0
  ) {
    try {
      const generated = await generateInvoicesForQuote(updated);
      invoices = [...invoices, ...generated];
    } catch (err) {
      // Quote is already flipped to 'approved' — surface the error so the
      // caller can decide whether to reset or retry. The client UI shows
      // the message and leaves the user with a "Retry generate invoices"
      // path (out of scope for this slice).
      return NextResponse.json(
        {
          ok: false,
          error:
            err instanceof Error
              ? `Quote approved but invoice generation failed: ${err.message}`
              : "Quote approved but invoice generation failed.",
        },
        { status: 500 },
      );
    }
  }

  // Cancellation side-effect: cancel any draft/sent invoices.
  if (patch.status === "cancelled" && existing.status !== "cancelled") {
    for (const inv of invoices) {
      if (inv.status === "draft" || inv.status === "sent") {
        try {
          await updateInvoice(inv.id, { status: "cancelled" });
        } catch (err) {
          console.warn(
            `[quotes PATCH] failed to cancel invoice ${inv.invoice_number}`,
            err,
          );
        }
      }
    }
    invoices = await listInvoicesForQuoteServer(id);
  }

  return NextResponse.json({ ok: true, quote: updated, invoices });
}
