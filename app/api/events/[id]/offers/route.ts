import { NextResponse } from "next/server";

import { insertOffer } from "@/lib/db/releases";
import { offerRefusal, offerWords, type OfferFigures, type OfferKind } from "@/lib/releases/offers";
import { createClient } from "@/lib/supabase/server";

const KINDS = new Set<OfferKind>(["payment_plan", "group", "early_entry"]);

/**
 * POST /api/events/[id]/offers
 * Writes one event_offers row. The sheet refuses sold, final, last and %.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const db = await createClient();
  const { data: auth } = await db.auth.getUser();
  const user = auth.user;
  if (!user) return NextResponse.json({ error: "Sign in again." }, { status: 401 });

  const { data: event } = await db.from("events").select("id").eq("id", id).maybeSingle();
  if (!event) return NextResponse.json({ error: "That event is not on this account." }, { status: 404 });

  const body = (await request.json()) as {
    kind?: string;
    figures?: OfferFigures;
    condition?: string;
    fromAt?: string | null;
    untilAt?: string | null;
  };
  if (!KINDS.has(body.kind as OfferKind)) {
    return NextResponse.json({ error: "That is not an offer kind." }, { status: 400 });
  }
  const kind = body.kind as OfferKind;
  const figures = body.figures ?? {};
  const condition = body.condition ?? "";
  const refusal = offerRefusal([condition, offerWords(kind, figures).card, figures.arrive ?? ""].filter(Boolean).join(" "));
  if (refusal) return NextResponse.json({ error: refusal }, { status: 400 });

  try {
    const saved = await insertOffer(db, {
      userId: user.id,
      eventId: id,
      kind,
      figures,
      condition: condition || null,
      fromAt: body.fromAt || null,
      untilAt: body.untilAt || null,
      enteredBy: user.id,
    });
    if (saved === "missing") return NextResponse.json({ error: "Offers are not on this database yet." }, { status: 503 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not save the offer.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
