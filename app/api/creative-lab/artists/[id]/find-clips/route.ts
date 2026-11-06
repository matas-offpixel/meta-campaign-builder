/**
 * POST /api/creative-lab/artists/[id]/find-clips
 *
 * Session and ownership. Lists Instagram clips. No downloads.
 */

import { NextResponse, type NextRequest } from "next/server";

import { findArtistClips, IgDiscoveryError } from "@/lib/creative-lab/ig-discovery";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const db = createServiceRoleClient();
  const owned = await db.from("creative_lab_artists").select("id").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (owned.error) return NextResponse.json({ error: owned.error.message }, { status: 500 });
  if (!owned.data) return NextResponse.json({ error: "No artist with that id." }, { status: 404 });
  try {
    return NextResponse.json(await findArtistClips(db, { artistId: id }));
  } catch (err) {
    if (err instanceof IgDiscoveryError) return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
    const message = err instanceof Error ? err.message : "Could not find clips.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
