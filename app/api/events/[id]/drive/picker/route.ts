/**
 * GET /api/events/[id]/drive/picker?folder={drive folder id}&stage={map key}
 *
 * The launcher's From Drive picker (G1, G2): one folder of the event's tree —
 * breadcrumb, owners, child folders and media with Drive's measurements.
 * Opens at the current stage's owners with no folder. Read only.
 */

import { NextResponse, type NextRequest } from "next/server";

import { driveFromEnv } from "@/lib/drive/client";
import { loadPickerView } from "@/lib/drive/picker";

import { ownedPickerEvent } from "./_owned";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  const who = await ownedPickerEvent(id);
  if (who.error) return who.error;
  const { drive } = driveFromEnv();
  const url = new URL(req.url);
  const view = await loadPickerView(who.db, drive, who.event, {
    folderId: url.searchParams.get("folder"),
    stageKey: url.searchParams.get("stage"),
  });
  const status = view.state === "not_in_tree" ? 404 : 200;
  return NextResponse.json({ ok: view.state === "ok", view }, { status });
}
