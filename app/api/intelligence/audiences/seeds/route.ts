import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  createAudienceSeed,
  listAudienceSeeds,
} from "@/lib/db/audience-seeds";
import type { AudienceSeedFilters } from "@/lib/types/intelligence";

/**
 * GET  list every saved audience seed for the user.
 * POST create a seed.   body: { name, description?, filters? }
 *
 * `filters` is stored as JSONB so the audience builder can recall the exact
 * filter combination without a schema migration when it grows new dimensions.
 */

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }
  const seeds = await listAudienceSeeds(user.id);
  return NextResponse.json({ ok: true, seeds });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json(
      { ok: false, error: "`name` is required." },
      { status: 400 },
    );
  }

  const filters: AudienceSeedFilters =
    body.filters && typeof body.filters === "object"
      ? (body.filters as AudienceSeedFilters)
      : {};

  try {
    const seed = await createAudienceSeed(user.id, {
      name,
      description:
        typeof body.description === "string" ? body.description : null,
      filters,
    });
    return NextResponse.json({ ok: true, seed }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create seed.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
