import { NextResponse, type NextRequest } from "next/server";

import {
  createDraftPageForOwnedEvent,
  lookupEventLandingPage,
} from "@/lib/db/event-landing-page";
import { createClient } from "@/lib/supabase/server";

/**
 * GET  /api/wizard/event-landing-page?eventId=
 * POST /api/wizard/event-landing-page  { eventId }
 *
 * Operator-session lookup / stub-create for the wizard destination-URL
 * offer. Create orchestrates the existing page_events insert (same as
 * createPageForExistingEvent); it does not rebuild the LP editor.
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
  return NextResponse.json({ ok: true, record });
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

  const result = await createDraftPageForOwnedEvent(eventId);
  if ("error" in result) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true, record: result });
}
