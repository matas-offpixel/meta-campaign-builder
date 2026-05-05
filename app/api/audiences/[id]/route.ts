import { NextResponse, type NextRequest } from "next/server";

import { parseAudienceUpdateBody } from "@/lib/audiences/api";
import { updateAudience } from "@/lib/db/meta-custom-audiences";
import { archiveMetaCustomAudience } from "@/lib/meta/audience-write";
import { createClient } from "@/lib/supabase/server";

export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  const { id } = await props.params;
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

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { ok: false, error: "Invalid audience payload" },
      { status: 400 },
    );
  }

  try {
    const audience = await updateAudience(id, parseAudienceUpdateBody(body));
    if (!audience) {
      return NextResponse.json(
        { ok: false, error: "Audience not found" },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, audience }, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to update audience",
      },
      { status: 400 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  const { id } = await props.params;
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

  try {
    const ok = await archiveMetaCustomAudience(id, {
      userId: user.id,
      supabase,
    });
    if (!ok) {
      return NextResponse.json(
        { ok: false, error: "Audience not found" },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to archive audience",
      },
      { status: 400 },
    );
  }
}
