import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadEventRegistrations } from "@/lib/mailchimp/registrations-loader";

interface Context {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/events/:id/mailchimp/snapshots
 *
 * Returns computed Mailchimp registration data for the event so the
 * internal `InternalEventReport` client component can display the
 * REGISTRATIONS card without full server-component wiring.
 *
 * Requires an authenticated session — same guard as all event-scoped
 * routes in this tree.
 */
export async function GET(_req: Request, { params }: Context) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const data = await loadEventRegistrations(supabase, id);
  if (!data) {
    return NextResponse.json(
      { ok: false, error: "Failed to load registrations" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, data });
}
