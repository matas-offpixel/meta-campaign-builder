import { NextRequest, NextResponse } from "next/server";

import { isOperator } from "@/lib/auth/operator-allowlist";
import { loadArmedCampaignRows } from "@/lib/db/armed-campaigns";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorised" }, { status: 401 });
  }

  const eventId = req.nextUrl.searchParams.get("eventId")?.trim() || "";
  const query = eventId ? ({ kind: "event", eventId } as const) : ({ kind: "armed" } as const);
  const operator = isOperator(user.id);
  let db = supabase;
  if (operator) {
    try {
      db = createServiceRoleClient();
    } catch {
      db = supabase;
    }
  }

  try {
    const campaigns = await loadArmedCampaignRows(db, query, {
      userId: user.id,
      isOperator: operator,
    });
    return NextResponse.json({ ok: true, campaigns });
  } catch (err) {
    console.error("[optimisation/campaigns]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed to load campaigns" },
      { status: 500 },
    );
  }
}
