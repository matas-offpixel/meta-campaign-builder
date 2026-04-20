import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { deleteAudienceSeed, getAudienceSeed } from "@/lib/db/audience-seeds";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  const seed = await getAudienceSeed(id);
  if (!seed) {
    return NextResponse.json(
      { ok: false, error: "Seed not found" },
      { status: 404 },
    );
  }
  if (seed.user_id !== user.id) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  try {
    await deleteAudienceSeed(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete seed.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
