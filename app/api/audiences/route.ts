import { NextResponse, type NextRequest } from "next/server";

import {
  buildAudienceDraftInputs,
  type AudienceCreateBody,
} from "@/lib/audiences/api";
import { createAudienceDrafts } from "@/lib/db/meta-custom-audiences";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
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

  const body = (await req.json().catch(() => ({}))) as AudienceCreateBody;

  try {
    const inputs = await buildAudienceDraftInputs(supabase, user.id, body);
    const audiences = await createAudienceDrafts(inputs);
    return NextResponse.json({ ok: true, audiences }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to create audience",
      },
      { status: 400 },
    );
  }
}
