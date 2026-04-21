import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  deleteScheduledSend,
  updateScheduledSendStatus,
} from "@/lib/db/d2c";

/**
 * /api/d2c/scheduled/[id]
 *
 * PATCH  → cancel a scheduled send (status=cancelled). Other status
 *          transitions are intentionally not exposed: 'sent' is set by
 *          the POST /scheduled flow, 'failed' by the same flow on
 *          error.
 * DELETE → hard-delete a scheduled row.
 */

interface PatchBody {
  status?: unknown;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "Send id is required" },
      { status: 400 },
    );
  }
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
  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }
  if (body.status !== "cancelled") {
    return NextResponse.json(
      {
        ok: false,
        error: "Only status='cancelled' is allowed via PATCH.",
      },
      { status: 400 },
    );
  }
  const updated = await updateScheduledSendStatus(supabase, id, {
    status: "cancelled",
  });
  if (!updated) {
    return NextResponse.json(
      { ok: false, error: "Scheduled send not found" },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, send: updated });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "Send id is required" },
      { status: 400 },
    );
  }
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
  await deleteScheduledSend(supabase, id);
  return NextResponse.json({ ok: true });
}
