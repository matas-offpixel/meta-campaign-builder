import { NextRequest, NextResponse } from "next/server";

import { deletePlanTemplateForUser } from "@/lib/plan/plan-templates";
import { createClient } from "@/lib/supabase/server";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorised" }, { status: 401 });
  }
  const result = await deletePlanTemplateForUser(supabase, id, user.id);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, tableMissing: result.tableMissing, error: result.error },
      { status: result.tableMissing ? 503 : 400 },
    );
  }
  return NextResponse.json({ ok: true });
}
