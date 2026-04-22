import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { loadEventContextForDraft } from "@/lib/wizard/event-context";

/**
 * GET /api/wizard/event-context?draftId=…
 *
 * Returns `{ ok, event, client }` — both nullable — for the wizard to
 * pre-fill defaults on first hydration. Auth-gated by the active
 * Supabase session; ownership is enforced by RLS on the underlying
 * tables (the resolver only sees rows the caller owns).
 */
export async function GET(req: NextRequest) {
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

  const draftId = req.nextUrl.searchParams.get("draftId")?.trim() ?? "";
  if (!draftId) {
    return NextResponse.json(
      { ok: false, error: "draftId is required" },
      { status: 400 },
    );
  }

  const { event, client } = await loadEventContextForDraft(draftId);

  return NextResponse.json({ ok: true, event, client });
}
