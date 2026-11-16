import { NextResponse, type NextRequest } from "next/server";

import { requireOperator } from "@/lib/bm/route-auth";
import {
  getD2CConnectionById,
  setD2CConnectionLiveFlag,
} from "@/lib/db/d2c";

interface PatchBody {
  live_enabled?: unknown;
  approved_by_matas?: unknown;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "Connection id is required" },
      { status: 400 },
    );
  }

  // Operator only: a client_users member has a session too (proxy.ts lets
  // any session through outside /admin). No session → 401, member → 403.
  const gate = await requireOperator();
  if (!gate.ok) return gate.response;
  const { supabase, user } = gate;

  const existing = await getD2CConnectionById(supabase, id);
  if (!existing || existing.user_id !== user.id) {
    return NextResponse.json(
      { ok: false, error: "Connection not found" },
      { status: 404 },
    );
  }

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  if (typeof body.live_enabled !== "boolean") {
    return NextResponse.json(
      { ok: false, error: "live_enabled boolean is required" },
      { status: 400 },
    );
  }
  if (typeof body.approved_by_matas !== "boolean") {
    return NextResponse.json(
      { ok: false, error: "approved_by_matas boolean is required" },
      { status: 400 },
    );
  }

  const updated = await setD2CConnectionLiveFlag(supabase, id, {
    liveEnabled: body.live_enabled,
    approvedByMatas: body.approved_by_matas,
  });
  if (!updated) {
    return NextResponse.json(
      { ok: false, error: "Failed to update connection" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    connection: { ...updated, credentials: null },
  });
}
