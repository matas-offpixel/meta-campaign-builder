import { NextResponse, type NextRequest } from "next/server";

import {
  buildAudienceDraftInputs,
  type AudienceCreateBody,
} from "@/lib/audiences/api";
import {
  createAudienceDrafts,
  listAudiencesForClient,
} from "@/lib/db/meta-custom-audiences";
import {
  createMetaCustomAudienceBatch,
  metaAudienceWritesEnabled,
} from "@/lib/meta/audience-write";
import { createClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
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

  const clientId = req.nextUrl.searchParams.get("clientId")?.trim();
  if (!clientId) {
    return NextResponse.json(
      { ok: false, error: "clientId is required" },
      { status: 400 },
    );
  }
  const status = req.nextUrl.searchParams.get("status");
  const audiences = await listAudiencesForClient(clientId, {
    status: status === "ready" ? ["ready"] : undefined,
  });
  return NextResponse.json({ ok: true, audiences });
}

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
    if (body.createOnMeta && metaAudienceWritesEnabled()) {
      const result = await createMetaCustomAudienceBatch(
        audiences.map((audience) => audience.id),
        { userId: user.id, supabase },
      );
      return NextResponse.json(
        { ok: true, audiences, writeResult: result },
        { status: 201 },
      );
    }
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
