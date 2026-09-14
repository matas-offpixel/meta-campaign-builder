import { NextRequest, NextResponse } from "next/server";

import { isOperator } from "@/lib/auth/operator-allowlist";
import { loadArmedCampaignRows } from "@/lib/db/armed-campaigns";
import { applyResolvedWiring } from "@/lib/db/rewire";
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

  let body: { eventId?: string } = {};
  try {
    const parsed = await req.json();
    if (parsed && typeof parsed === "object") {
      body = parsed as { eventId?: string };
    }
  } catch {
    body = {};
  }

  const eventId = body.eventId?.trim() || "";
  if (eventId && !isArmedEventId(eventId)) {
    return NextResponse.json({ ok: false, error: "eventId must be a uuid" }, { status: 400 });
  }
  const query = eventId ? ({ kind: "event", eventId } as const) : ({ kind: "armed" } as const);

  const { campaigns } = await loadArmedCampaignRows(db, query, viewer);
  const results: Array<{ draftId: string; ok: boolean; error?: string }> = [];
  for (const row of campaigns) {
    if (row.wiring?.kind !== "rewire" && row.wiring?.kind !== "stamp_event") continue;
    if (!row.canWrite) continue;
    if (row.wiring.kind === "stamp_event" && !row.canStampEvent) continue;
    const result = await applyResolvedWiring(db, row.id, row.wiring.kind, viewer);
    results.push(
      result.ok
        ? { draftId: row.id, ok: true }
        : { draftId: row.id, ok: false, error: result.error },
    );
  }
  return NextResponse.json({ ok: true, results });
}
