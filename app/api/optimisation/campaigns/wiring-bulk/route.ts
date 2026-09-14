import { NextRequest, NextResponse } from "next/server";

import { isOperator } from "@/lib/auth/operator-allowlist";
import { applyPreviewedRewires } from "@/lib/db/rewire";
import { isArmedEventId } from "@/lib/optimisation/armed-read-model";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

function viewerDb(allowlisted: boolean) {
  if (!allowlisted) return { db: null, operator: false as const };
  try {
    return { db: createServiceRoleClient(), operator: true as const };
  } catch {
    return { db: null, operator: false as const };
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
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

  let draftIds: unknown;
  try {
    const parsed = await req.json();
    draftIds =
      parsed && typeof parsed === "object" && "draftIds" in parsed
        ? (parsed as { draftIds?: unknown }).draftIds
        : null;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(draftIds) || draftIds.length === 0) {
    return NextResponse.json({ ok: false, error: "draftIds is required" }, { status: 400 });
  }
  const ids: string[] = [];
  for (const value of draftIds) {
    if (typeof value !== "string" || !isArmedEventId(value)) {
      return NextResponse.json({ ok: false, error: "draftIds must be uuids" }, { status: 400 });
    }
    ids.push(value);
  }

  const results = await applyPreviewedRewires(db, ids, viewer);
  return NextResponse.json({ ok: true, results });
}
