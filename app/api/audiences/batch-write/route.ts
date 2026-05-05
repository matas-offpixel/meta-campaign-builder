import { NextResponse, type NextRequest } from "next/server";

import { createMetaCustomAudienceBatch } from "@/lib/meta/audience-write";
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

  const body = (await req.json().catch(() => null)) as {
    audienceIds?: unknown;
  } | null;
  const audienceIds = Array.isArray(body?.audienceIds)
    ? body.audienceIds.filter((id): id is string => typeof id === "string")
    : [];
  if (audienceIds.length === 0) {
    return NextResponse.json(
      { ok: false, error: "audienceIds is required" },
      { status: 400 },
    );
  }

  try {
    const result = await createMetaCustomAudienceBatch(audienceIds, {
      userId: user.id,
      supabase,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create audiences on Meta";
    const status = /disabled/i.test(message) ? 403 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
