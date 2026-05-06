/**
 * GET /api/clients/[clientId]/enhancement-flags
 *
 * Session-auth read of open creative enhancement policy flags for a client.
 * Optional query: eventIds=comma-separated UUIDs (venue / event-scoped banner).
 */

import { NextResponse, type NextRequest } from "next/server";

import { fetchEnhancementFlagsForClient } from "@/lib/db/creative-enhancement-flags";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function parseEventIds(req: NextRequest): string[] | undefined {
  const sp = req.nextUrl.searchParams;
  const single = sp.get("eventId");
  const multi = sp.get("eventIds");
  if (multi && multi.trim()) {
    return multi.split(",").map((s) => s.trim()).filter(Boolean);
  }
  if (single && single.trim()) {
    return [single.trim()];
  }
  return undefined;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const { clientId } = await params;

  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { data: existing, error: lookupErr } = await userClient
    .from("clients")
    .select("id, user_id")
    .eq("id", clientId)
    .maybeSingle();
  if (lookupErr) {
    return NextResponse.json({ error: lookupErr.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }
  if (existing.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Service-role client unavailable",
      },
      { status: 500 },
    );
  }

  const eventIds = parseEventIds(req);

  try {
    const payload = await fetchEnhancementFlagsForClient(admin, {
      clientId,
      eventIds,
    });
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
