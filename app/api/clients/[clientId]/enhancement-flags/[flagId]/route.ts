/**
 * PATCH /api/clients/[clientId]/enhancement-flags/[flagId]
 *
 * User-acknowledges a flag: marks it resolved so it disappears from the banner.
 * The scanner will re-open it on the next scan if the enhancement is still active.
 *
 * Auth: signed-in session; caller must own the client.
 */

import { NextResponse, type NextRequest } from "next/server";

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ clientId: string; flagId: string }> },
) {
  const { clientId, flagId } = await params;

  if (!UUID_RE.test(clientId) || !UUID_RE.test(flagId)) {
    return NextResponse.json(
      { error: "clientId and flagId must be UUIDs" },
      { status: 400 },
    );
  }

  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Service-role client unavailable",
      },
      { status: 500 },
    );
  }

  const { data: client, error: clientErr } = await admin
    .from("clients")
    .select("id, user_id")
    .eq("id", clientId)
    .maybeSingle();

  if (clientErr) {
    return NextResponse.json({ error: clientErr.message }, { status: 500 });
  }
  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }
  if (client.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: flag, error: flagErr } = await admin
    .from("creative_enhancement_flags")
    .select("id, client_id, resolved_at")
    .eq("id", flagId)
    .maybeSingle();

  if (flagErr) {
    return NextResponse.json({ error: flagErr.message }, { status: 500 });
  }
  if (!flag) {
    return NextResponse.json({ error: "Flag not found" }, { status: 404 });
  }
  if (flag.client_id !== clientId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (flag.resolved_at !== null) {
    return NextResponse.json({ acknowledged: true, already_resolved: true });
  }

  const { error: updErr } = await admin
    .from("creative_enhancement_flags")
    .update({
      resolved_at: new Date().toISOString(),
      resolved_by_user_id: user.id,
    })
    .eq("id", flagId);

  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({ acknowledged: true });
}
