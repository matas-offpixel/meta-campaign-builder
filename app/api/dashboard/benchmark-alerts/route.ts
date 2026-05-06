import { NextResponse } from "next/server";
import { listOpenBenchmarkAlerts } from "@/lib/db/benchmark-alerts";
import { createClient } from "@/lib/supabase/server";

const DEFAULT_LIMIT = 5;
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  const url = new URL(req.url);
  const limitRaw = url.searchParams.get("limit");
  const limit = Math.min(50, Math.max(1, limitRaw ? Number(limitRaw) || DEFAULT_LIMIT : DEFAULT_LIMIT));
  const alerts = await listOpenBenchmarkAlerts(supabase, user.id, limit);
  return NextResponse.json({ ok: true, alerts });
}
