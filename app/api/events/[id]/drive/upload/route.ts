import { NextResponse, type NextRequest } from "next/server";

import { driveFromEnv } from "@/lib/drive/client";
import { appKeepsFile, parseCreativesKey, placeUploadedFile } from "@/lib/drive/place-upload";
import { EVENT_NOT_ON_ACCOUNT, FOLDER_NOT_IN_TREE, NO_CLIENT_TREE, SIGN_IN_AGAIN } from "@/lib/drive/panel";
import { ARTIST_CLIPS_KEY, EVENT_TREE, PRESS_KITS_KEY } from "@/lib/drive/tree";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function allowedKey(key: string): boolean {
  // The creatives row's D5 key (2026-11-11-creative-lab-upload-owner, HU1).
  if (parseCreativesKey(key)) return true;
  if (EVENT_TREE.some((spec) => spec.key === key)) return true;
  if (key.startsWith(`${ARTIST_CLIPS_KEY}/`) || key === ARTIST_CLIPS_KEY) return true;
  if (key.startsWith(`${PRESS_KITS_KEY}/`) || key === PRESS_KITS_KEY) return true;
  return /^03\/3\/wc\/\d{4}-\d{2}-\d{2}(?:\/[a-z-]+)?$/.test(key);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: SIGN_IN_AGAIN }, { status: 401 });
  const db = createServiceRoleClient();
  const { data: event, error } = await db.from("events").select("*").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!event) return NextResponse.json({ ok: false, error: EVENT_NOT_ON_ACCOUNT }, { status: 404 });
  const client = event.client_id
    ? (await db.from("clients").select("id, name, status, drive_folder_id").eq("id", event.client_id).maybeSingle()).data
    : null;
  if (!client) return NextResponse.json({ ok: false, error: NO_CLIENT_TREE }, { status: 404 });
  const { drive } = driveFromEnv();
  if (!drive) return NextResponse.json({ ok: false, error: "The Drive export isn't set up on this deployment." }, { status: 503 });
  const form = await req.formData();
  const file = form.get("file");
  const key = String(form.get("key") ?? "");
  const artistName = String(form.get("artistName") ?? "").trim() || null;
  if (!(file instanceof File) || !allowedKey(key)) {
    return NextResponse.json({ ok: false, error: FOLDER_NOT_IN_TREE }, { status: 400 });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const placed = await placeUploadedFile(db, drive, {
      event,
      client,
      userId: user.id,
      choice: { key, artistName },
      name: file.name,
      mimeType: file.type,
      bytes,
    });
    if (appKeepsFile(key) && !key.startsWith(`${ARTIST_CLIPS_KEY}/`)) {
      const path = `videos/drive/${id}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]+/g, "_")}`;
      await db.storage.from("campaign-assets").upload(path, bytes, { contentType: file.type || "application/octet-stream", upsert: false });
    }
    return NextResponse.json({ ok: true, fileId: placed.fileId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: message === FOLDER_NOT_IN_TREE ? 400 : 500 });
  }
}
