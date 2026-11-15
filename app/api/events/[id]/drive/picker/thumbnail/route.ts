/**
 * GET /api/events/[id]/drive/picker/thumbnail?file={drive file id}
 *
 * Drive's own thumbnail for a file in the event's tree, fetched as the export
 * account (Drive's thumbnailLink needs it) and passed through. Read only.
 */

import { type NextRequest } from "next/server";

import { driveFromEnv } from "@/lib/drive/client";
import { fileInTree } from "@/lib/drive/picker";

import { ownedPickerEvent } from "../_owned";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const who = await ownedPickerEvent(id);
  if (who.error) return who.error;
  const fileId = new URL(req.url).searchParams.get("file") ?? "";
  const { drive } = driveFromEnv();
  if (!drive?.fetchThumbnail || !fileId) return new Response(null, { status: 404 });
  try {
    const file = await fileInTree(who.db, drive, who.event, fileId);
    if (!file?.thumbnailLink) return new Response(null, { status: 404 });
    const res = await drive.fetchThumbnail(file.thumbnailLink);
    if (!res.ok || !res.body) return new Response(null, { status: 502 });
    return new Response(res.body, {
      status: 200,
      headers: { "content-type": res.headers.get("content-type") ?? "image/jpeg", "cache-control": "private, max-age=3600" },
    });
  } catch {
    return new Response(null, { status: 502 });
  }
}
