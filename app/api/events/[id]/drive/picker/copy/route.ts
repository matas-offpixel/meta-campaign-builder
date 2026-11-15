/**
 * POST /api/events/[id]/drive/picker/copy  { fileId, role? }
 *
 * G6's copy for one picked file: Drive → Storage, streamed to the temp disk
 * (#1188 / #1189's path), deduped on creative_assets.drive_file_id (migration
 * 228). The response is NDJSON: {"type":"progress","pct"} and
 * {"type":"registry"} lines, then {"type":"done", ...CopyResult}. The step
 * then sends the returned storagePath through POST /api/meta/upload-asset.
 * No Meta call here.
 */

import { NextResponse, type NextRequest } from "next/server";

import { uploadFileToStorageBucket } from "@/lib/clients/asset-queue/storage-upload";
import { driveFromEnv } from "@/lib/drive/client";
import { PICKER_BUCKET, copyPickedFile } from "@/lib/drive/picker";
import { UNREADABLE_REQUEST } from "@/lib/drive/panel";

import { ownedPickerEvent } from "../_owned";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const who = await ownedPickerEvent(id);
  if (who.error) return who.error;
  let body: { fileId?: unknown; role?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: UNREADABLE_REQUEST }, { status: 400 });
  }
  const fileId = typeof body.fileId === "string" ? body.fileId : "";
  const role = body.role === "4:5" || body.role === "1:1" ? body.role : "9:16";
  if (!fileId) return NextResponse.json({ ok: false, error: UNREADABLE_REQUEST }, { status: 400 });
  const { drive } = driveFromEnv();
  if (!drive) return NextResponse.json({ type: "done", ok: false, code: "copy_failed", reason: "Couldn't copy from Drive" });
  const db = who.db;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (line: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      const result = await copyPickedFile(
        {
          db,
          drive,
          userId: who.userId,
          uploadFile: async (storagePath, filePath, contentType) => {
            const uploaded = await uploadFileToStorageBucket(db as never, PICKER_BUCKET, storagePath, filePath, contentType);
            if (uploaded.error) throw new Error(uploaded.error.message ?? "Storage upload failed");
          },
          copyObject: async (from, to) => {
            const copied = await db.storage.from(PICKER_BUCKET).copy(from, to);
            if (copied.error) throw new Error(copied.error.message);
          },
        },
        who.event,
        { fileId, role },
        (progress) => send(progress),
      );
      send({ type: "done", ...result });
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
