import { NextResponse, type NextRequest } from "next/server";

import { driveFromEnv } from "@/lib/drive/client";
import { eventFolderName, londonToday } from "@/lib/drive/tree";
import {
  artistFolderMissSentence,
  createTreePath,
  folderPlace,
  panelRows,
} from "@/lib/drive/panel";
import { createEventTree, linkEventFolder, parseDriveFolderId, resolveDriveFolder } from "@/lib/drive/setup";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function owned(eventId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 }) };
  const db = createServiceRoleClient();
  const { data, error } = await db.from("events").select("*").eq("id", eventId).eq("user_id", user.id).maybeSingle();
  if (error) return { error: NextResponse.json({ ok: false, error: error.message }, { status: 500 }) };
  if (!data) return { error: NextResponse.json({ ok: false, error: "No event with that id." }, { status: 404 }) };
  return { db, event: data, userId: user.id };
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  const who = await owned(id);
  if ("error" in who && who.error) return who.error;
  const { db, event } = who;
  const client = event.client_id
    ? (await db.from("clients").select("id, name, status, drive_folder_id").eq("id", event.client_id).maybeSingle()).data
    : null;
  const folders = (await db.from("drive_folders").select("key, name, drive_folder_id").eq("event_id", id)).data ?? [];
  const misses = (await db.from("drive_artist_folder_misses").select("folder_name").eq("event_id", id)).data ?? [];
  const clips = (await db.from("creative_lab_clips").select("id").eq("event_id", id)).data ?? [];
  const clipIds = clips.map((row) => row.id);
  let winnerCount = 0;
  if (clipIds.length > 0) {
    const winners = await db.from("creative_lab_renders").select("id").in("clip_id", clipIds).not("drive_winner_shortcut_id", "is", null);
    winnerCount = winners.data?.length ?? 0;
  }
  let contactEmail: string | null = null;
  if (event.client_id) {
    const member = (await db.from("client_users").select("user_id").eq("client_id", event.client_id).limit(1).maybeSingle()).data;
    if (member?.user_id) {
      try {
        const admin = db as unknown as { auth: { admin: { getUserById(userId: string): Promise<{ data: { user: { email?: string | null } | null } }> } } };
        const looked = await admin.auth.admin.getUserById(member.user_id);
        contactEmail = looked.data.user?.email ?? null;
      } catch {
        contactEmail = null;
      }
    }
  }
  const today = londonToday(new Date());
  const mapped = folders.find((row) => row.key === "event");
  let folderName = mapped?.name || eventFolderName(event);
  if (event.drive_folder_id) {
    const { drive } = driveFromEnv();
    const file = drive ? await drive.getFile(event.drive_folder_id) : null;
    if (file?.name) folderName = file.name;
  }
  return NextResponse.json({
    ok: true,
    folderId: event.drive_folder_id,
    folderName,
    linked: event.drive_folder_linked,
    place: folderPlace(client?.name ?? null),
    treePath: client ? createTreePath(client.name, event) : folderPlace(null),
    shared: Boolean(event.drive_shared_at),
    contactEmail,
    clientName: client?.name ?? "",
    misses: misses.map((row) => artistFolderMissSentence(row.folder_name)),
    rows: panelRows({
      folders: folders.map((row) => ({ key: row.key, driveFolderId: row.drive_folder_id })),
      winnerCount,
      status: event.status,
      eventDate: event.event_date,
      today,
    }),
    openUrl: event.drive_folder_id ? `https://drive.google.com/drive/folders/${event.drive_folder_id}` : null,
    today,
    status: event.status,
    eventDate: event.event_date,
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  const who = await owned(id);
  if ("error" in who && who.error) return who.error;
  const { db, event } = who;
  const { drive } = driveFromEnv();
  if (!drive) return NextResponse.json({ ok: false, error: "The Drive export isn't set up on this deployment." }, { status: 503 });
  const clientRow = event.client_id
    ? (await db.from("clients").select("id, name, status, drive_folder_id").eq("id", event.client_id).maybeSingle()).data
    : null;
  if (!clientRow) return NextResponse.json({ ok: false, error: "No event with that id." }, { status: 404 });
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "bad JSON" }, { status: 400 });
  }
  try {
    if (body.action === "resolve") {
      const folderId = typeof body.link === "string" ? parseDriveFolderId(body.link) : null;
      if (!folderId) {
        return NextResponse.json({
          ok: false,
          error: "Can't open that folder — share it with the export account or move it into Off / Pixel, then link it again.",
        });
      }
      const resolved = await resolveDriveFolder(drive, folderId);
      return NextResponse.json(resolved);
    }
    if (body.action === "link") {
      const folderId = typeof body.folderId === "string" ? body.folderId : "";
      const resolved = await resolveDriveFolder(drive, folderId);
      if (!resolved.ok) return NextResponse.json(resolved);
      await linkEventFolder(db, drive, event, clientRow, folderId);
      return NextResponse.json({ ok: true, folderId });
    }
    if (body.action === "create") {
      const folderId = await createEventTree(db, drive, event, clientRow);
      return NextResponse.json({ ok: true, folderId });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
  return NextResponse.json({ ok: false, error: "bad JSON" }, { status: 400 });
}
