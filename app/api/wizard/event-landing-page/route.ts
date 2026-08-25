import { NextResponse, type NextRequest } from "next/server";

import {
  assessRecord,
  lookupEventLandingPage,
} from "@/lib/db/event-landing-page";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/wizard/event-landing-page?eventId=
 *
 * Read-only lookup for the launch wizards. Returns ready | draft |
 * unconfigured | none. Wizards consume destination URLs; they do not
 * create or publish pages. There is no POST on this route.
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
