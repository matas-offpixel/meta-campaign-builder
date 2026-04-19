import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  getQuoteByIdServer,
  listInvoicesForQuoteServer,
  updateInvoice,
  updateQuote,
} from "@/lib/db/invoicing-server";
import { slugifyEvent } from "@/lib/db/events";
import { regenerateAutoMoments } from "@/lib/db/event-key-moments";
import type { TablesInsert } from "@/lib/db/database.types";

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/invoicing/quotes/[id]/convert
//
// One-shot conversion from an approved quote to a real `events` row.
//
// Pre-conditions:
//   - Quote exists, owned by the caller
//   - status = 'approved'
//   - event_id IS NULL  (idempotency guard — never spawns two events)
//
// Side-effects, in order:
//   1. Insert events row using quote fields
//   2. Update quote: status='converted', event_id=<new>, converted_at=now()
//   3. Update invoices: SET event_id=<new> WHERE quote_id=<this quote>
//      (so they show up on the event detail's invoicing panel)
//   4. Best-effort: seed key moments for the new event
//
// On any insert/update failure we surface the error verbatim — partial
// state can be recovered manually since each step is independent.
// ─────────────────────────────────────────────────────────────────────────────

export async function PATCH(
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

  if (quote.status !== "approved") {
    return NextResponse.json(
      {
        ok: false,
        error: `Cannot convert from status '${quote.status}'. Approve the quote first.`,
      },
      { status: 400 },
    );
  }
  if (quote.event_id) {
    return NextResponse.json(
      { ok: false, error: "Quote already converted." },
      { status: 400 },
    );
  }

  // ── 1. Pick a unique slug for the new event ────────────────────────────
  // Adapted from lib/db/events.slugifyEvent — we trim then suffix with the
  // event date if it collides.
  let slug = slugifyEvent(quote.event_name);
  if (!slug) slug = "event";

  const { data: collision } = await supabase
    .from("events")
    .select("id")
    .eq("user_id", user.id)
    .eq("slug", slug)
    .maybeSingle();
  if (collision) {
    const dateSuffix = quote.event_date
      ? quote.event_date.slice(0, 7) // yyyy-mm
      : new Date().toISOString().slice(0, 7);
    slug = `${slug}-${dateSuffix}`;
  }

  const insertPayload: TablesInsert<"events"> = {
    user_id: user.id,
    client_id: quote.client_id,
    name: quote.event_name,
    slug,
    capacity: quote.capacity,
    venue_name: quote.venue_name,
    venue_city: quote.venue_city,
    venue_country: quote.venue_country,
    event_date: quote.event_date,
    budget_marketing: quote.marketing_budget,
    status: "upcoming",
  };

  const { data: created, error: insertErr } = await supabase
    .from("events")
    .insert(insertPayload)
    .select("*")
    .maybeSingle();

  if (insertErr) {
    return NextResponse.json(
      { ok: false, error: `Event insert failed: ${insertErr.message}` },
      { status: 500 },
    );
  }
  if (!created) {
    return NextResponse.json(
      { ok: false, error: "Event insert returned no row." },
      { status: 500 },
    );
  }

  // ── 2. Flip quote → converted + link event ──────────────────────────────
  try {
    await updateQuote(id, {
      status: "converted",
      event_id: created.id,
      converted_at: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? `Event created but quote update failed: ${err.message}`
            : "Event created but quote update failed.",
      },
      { status: 500 },
    );
  }

  // ── 3. Cascade event_id onto every invoice that came from this quote ──
  const invoices = await listInvoicesForQuoteServer(id);
  for (const inv of invoices) {
    if (inv.event_id !== created.id) {
      try {
        await updateInvoice(inv.id, { event_id: created.id });
      } catch (err) {
        console.warn(
          `[quotes convert] failed to link invoice ${inv.invoice_number} to event ${created.id}`,
          err,
        );
      }
    }
  }

  // ── 4. Seed phase moments — best-effort ─────────────────────────────────
  if (created.event_date) {
    try {
      await regenerateAutoMoments({
        eventId: created.id,
        userId: user.id,
        eventDate: created.event_date,
      });
    } catch (err) {
      console.warn(
        "[quotes convert] regenerateAutoMoments failed, continuing.",
        err,
      );
    }
  }

  return NextResponse.json({
    ok: true,
    quote: { ...quote, status: "converted", event_id: created.id },
    event: created,
  });
}
