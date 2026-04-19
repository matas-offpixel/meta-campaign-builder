import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/integrations/google-drive/create-folder
 *
 * Creates a Google Drive folder for an event and stores the folder id +
 * URL on the event row. CURRENT STATE: stub. Returns
 * `{ ok: false, error: 'Google Drive not configured' }` until the
 * integration is wired up.
 *
 * TODO (when ready):
 *   1. Add `googleapis` to package.json (caller must approve — no new
 *      deps added in this scaffold slice).
 *   2. Read service-account credentials from
 *      `process.env.GOOGLE_SERVICE_ACCOUNT_JSON` (full JSON blob).
 *   3. Build a Drive client scoped to drive.file, create the folder
 *      under the parent shared-drive folder configured per-client (read
 *      `clients.google_drive_folder_url` to derive the parent), name it
 *      `${clientName} — ${eventName}`, share with the configured
 *      domain, and persist the returned id + webViewLink onto
 *      `events.google_drive_folder_id` + `events.google_drive_folder_url`.
 *   4. Return `{ ok: true, folderId, folderUrl }` so the UI can drop
 *      the toast and switch the button to "Open Drive folder".
 *
 * Auth: bound to the cookie session — only the owner of the event can
 * trigger creation. RLS on events would catch a cross-tenant attempt
 * anyway, but we fail fast here for a friendlier UX.
 */

interface CreateFolderRequest {
  eventId: string;
  eventName: string;
  clientName: string;
}

function isCreateFolderRequest(value: unknown): value is CreateFolderRequest {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.eventId === "string" &&
    typeof v.eventName === "string" &&
    typeof v.clientName === "string"
  );
}

export async function POST(req: NextRequest) {
  // Authentication first — even though the integration is unwired we
  // don't want unauthenticated callers probing this endpoint.
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  if (!isCreateFolderRequest(body)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Missing required fields: eventId, eventName, clientName (all strings).",
      },
      { status: 400 },
    );
  }

  // Stub response — surfaced as a toast in the event detail UI.
  return NextResponse.json(
    {
      ok: false,
      error: "Google Drive not configured",
    },
    { status: 200 },
  );
}
