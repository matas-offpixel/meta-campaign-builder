import { NextResponse, type NextRequest } from "next/server";
import { updateBenchmarkAlertStatus } from "@/lib/db/benchmark-alerts";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });
  let body: { action?: string };
  try { body = (await req.json()) as { action?: string }; }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }
  if (body.action !== "acknowledge" && body.action !== "dismiss") {
    return NextResponse.json({ ok: false, error: "`action` must be acknowledge or dismiss" }, { status: 400 });
  }
  const status = body.action === "dismiss" ? "dismissed" : "acknowledged";
  const result = await updateBenchmarkAlertStatus(supabase, { userId: user.id, id, status });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error ?? "Update failed" },
      { status: result.error?.includes("Not found") ? 404 : 400 });
  }
  return NextResponse.json({ ok: true });
}
