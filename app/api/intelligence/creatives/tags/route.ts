import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { addTag, removeTag } from "@/lib/db/creative-tags";
import type { CreativeTagType } from "@/lib/types/intelligence";

const TAG_TYPES: CreativeTagType[] = [
  "format",
  "hook",
  "genre",
  "style",
  "asset_type",
];

/**
 * POST   add a tag.    body: { metaAdId, eventId?, tagType, tagValue, metaCreativeId? }
 * DELETE remove a tag. body: { id }
 *
 * RLS bounds the write; we still gate on auth so the route can short-circuit
 * with 401 instead of returning a Supabase error.
 */

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

  const metaAdId = typeof body.metaAdId === "string" ? body.metaAdId.trim() : "";
  const tagType = typeof body.tagType === "string" ? body.tagType : "";
  const tagValue =
    typeof body.tagValue === "string" ? body.tagValue.trim() : "";

  if (!metaAdId || !tagValue) {
    return NextResponse.json(
      { ok: false, error: "`metaAdId` and `tagValue` are required." },
      { status: 400 },
    );
  }
  if (!TAG_TYPES.includes(tagType as CreativeTagType)) {
    return NextResponse.json(
      { ok: false, error: `\`tagType\` must be one of: ${TAG_TYPES.join(", ")}.` },
      { status: 400 },
    );
  }

  try {
    const tag = await addTag(user.id, {
      meta_ad_id: metaAdId,
      meta_creative_id:
        typeof body.metaCreativeId === "string" ? body.metaCreativeId : null,
      event_id: typeof body.eventId === "string" ? body.eventId : null,
      tag_type: tagType as CreativeTagType,
      tag_value: tagValue,
    });
    return NextResponse.json({ ok: true, tag }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to add tag.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
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
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) {
    return NextResponse.json({ ok: false, error: "`id` is required." }, { status: 400 });
  }

  try {
    await removeTag(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to remove tag.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
