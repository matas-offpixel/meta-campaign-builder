import { NextResponse, type NextRequest } from "next/server";

import { loadChannelHistory } from "@/lib/plan/channel-history";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const clientId = request.nextUrl.searchParams.get("clientId")?.trim() ?? "";
  if (!clientId) {
    return NextResponse.json({ ok: false, error: "clientId is required" }, { status: 400 });
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }
  const entries = await loadChannelHistory(supabase, user.id, clientId);
  return NextResponse.json({ ok: true, entries });
}
