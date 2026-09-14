import { NextRequest, NextResponse } from "next/server";

import { isOperator } from "@/lib/auth/operator-allowlist";
import { applyResolvedWiring } from "@/lib/db/rewire";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

function viewerDb(allowlisted: boolean) {
  if (!allowlisted) return { db: null, operator: false as const };
  try {
    return { db: createServiceRoleClient(), operator: true as const };
  } catch {
    return { db: null, operator: false as const };
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ ok: false, error: "Draft id is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorised" }, { status: 401 });
  }

  const { db: service, operator } = viewerDb(isOperator(user.id));
  const db = service ?? supabase;
  const viewer = { userId: user.id, isOperator: operator };

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const action =
    body && typeof body === "object" && "action" in body
      ? (body as { action?: unknown }).action
      : null;
  if (action !== "rewire" && action !== "stamp_event") {
    return NextResponse.json({ ok: false, error: "action must be rewire or stamp_event" }, { status: 400 });
  }

  const result = await applyResolvedWiring(db, id, action, viewer);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, wiring: result.wiring });
}
