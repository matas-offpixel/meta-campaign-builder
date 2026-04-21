import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { deleteD2CTemplate } from "@/lib/db/d2c";

/**
 * DELETE /api/d2c/templates/[id]
 *
 * Hard-delete a template. Scheduled sends reference templates with
 * `on delete restrict`, so the DB will reject deletes for templates
 * still in use — surfaces as a 500 here, with the constraint message
 * passed through.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "Template id is required" },
      { status: 400 },
    );
  }
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
  await deleteD2CTemplate(supabase, id);
  return NextResponse.json({ ok: true });
}
