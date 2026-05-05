import { NextResponse, type NextRequest } from "next/server";

import { createMetaCustomAudience } from "@/lib/meta/audience-write";
import { createClient } from "@/lib/supabase/server";

export async function POST(
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
    const audience = await createMetaCustomAudience(id, {
      userId: user.id,
      supabase,
    });
    return NextResponse.json({ ok: true, audience });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create audience on Meta";
    const status = /disabled/i.test(message) ? 403 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
