import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { optimisationWritesGateState } from "@/lib/optimisation/gates";

/** Same session-auth + env-probe shape as GET /api/plan/launch. */
export async function GET(): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorised" }, { status: 401 });
  }
  const gate = optimisationWritesGateState();
  return NextResponse.json({
    ok: true,
    writesEnabled: gate.writesEnabled,
    skippedReason: gate.skippedReason,
  });
}
