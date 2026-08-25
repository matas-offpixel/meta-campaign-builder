import { NextResponse, type NextRequest } from "next/server";

import {
  assessRecord,
  ensureRenderablePageForOwnedEvent,
  lookupEventLandingPage,
} from "@/lib/db/event-landing-page";
import { createClient } from "@/lib/supabase/server";

/**
 * GET  /api/wizard/event-landing-page?eventId=
 * POST /api/wizard/event-landing-page  { eventId }
 *
 * Operator-session lookup / ensure for the wizard destination-URL offer.
 * GET returns ready | draft | unconfigured | none. POST creates the
 * missing client config + a live page (or publishes an internal draft).
 * The URL is only offerable when renderability.offerUrl is true.
 */

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Not signed in" },
      { status: 401 },
    );
  }

  const eventId = req.nextUrl.searchParams.get("eventId")?.trim() ?? "";
  if (!eventId) {
    return NextResponse.json(
      { ok: false, error: "eventId is required" },
      { status: 400 },
    );
  }

  const record = await lookupEventLandingPage(eventId);
  return NextResponse.json({
    ok: true,
    record,
    renderability: assessRecord(record),
  });
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Not signed in" },
      { status: 401 },
    );
  }

  let eventId = "";
  try {
    const body = (await req.json()) as { eventId?: unknown };
    eventId = typeof body.eventId === "string" ? body.eventId.trim() : "";
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON" },
      { status: 400 },
    );
  }
  if (!eventId) {
    return NextResponse.json(
      { ok: false, error: "eventId is required" },
      { status: 400 },
    );
  }

  const result = await ensureRenderablePageForOwnedEvent(eventId);
  if ("error" in result) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: 400 },
    );
  }
  return NextResponse.json({
    ok: true,
    record: result.record,
    renderability: result.renderability,
  });
}
