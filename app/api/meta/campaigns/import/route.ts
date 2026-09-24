import { NextResponse, type NextRequest } from "next/server";

import { handleMetaImport } from "@/lib/meta/import/save";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/meta/campaigns/import
 *
 * Without `carry`, read the live campaign and return the picker —
 * nothing is saved. `carry: []` also saves nothing. With
 * `carry: string[]` of creative ids, map those creatives onto a
 * draft and save. The carry path requires `eventId` belonging to
 * the resolved client. Writes nothing to Meta.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const result = await handleMetaImport({
    userId: user?.id ?? null,
    body,
    supabase,
  });
  return NextResponse.json(result.body, { status: result.status });
}
