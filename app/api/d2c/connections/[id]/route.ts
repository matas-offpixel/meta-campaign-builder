import { NextResponse, type NextRequest } from "next/server";

import { requireOperator } from "@/lib/bm/route-auth";
import {
  deleteD2CConnection,
  getD2CConnectionById,
  setD2CConnectionStatus,
} from "@/lib/db/d2c";
import type { D2CConnectionStatus } from "@/lib/d2c/types";

/**
 * /api/d2c/connections/[id]
 *
 * PATCH  → update status (active/paused/error). Bodies that contain a
 *          credentials blob are rejected — re-saving credentials goes
 *          through POST /connections so the validation flow runs.
 * DELETE → soft-delete by default (status=paused). `?hard=1` triggers
 *          a true delete.
 * Both are operator only (`requireOperator`): 401 / 403 before any read.
 */

interface PatchBody {
  status?: unknown;
  lastError?: unknown;
  credentials?: unknown;
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

  if (body.credentials !== undefined) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Re-saving credentials goes through POST /api/d2c/connections so validation runs.",
      },
      { status: 400 },
    );
  }

  const status = body.status as D2CConnectionStatus | undefined;
  const validStatuses: D2CConnectionStatus[] = ["active", "paused", "error"];
  if (!status || !validStatuses.includes(status)) {
    return NextResponse.json(
      {
        ok: false,
        error: `status must be one of: ${validStatuses.join(", ")}`,
      },
      { status: 400 },
    );
  }
  const lastError =
    typeof body.lastError === "string" || body.lastError === null
      ? (body.lastError as string | null)
      : undefined;

  await setD2CConnectionStatus(supabase, id, status, lastError);
  return NextResponse.json({ ok: true });
}

export async function DELETE(
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

  const hard = req.nextUrl.searchParams.get("hard") === "1";
  if (hard) {
    await deleteD2CConnection(supabase, id);
    return NextResponse.json({ ok: true, deleted: "hard" });
  }
  await setD2CConnectionStatus(supabase, id, "paused");
  return NextResponse.json({ ok: true, deleted: "soft" });
}
