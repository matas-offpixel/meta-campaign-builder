/**
 * Share with promoter (S25, HS17). One view-only permission on the event
 * folder — never the client folder or _Brand kit — for the email given,
 * with Drive's notification email. Stop sharing removes that one permission
 * and nothing else. Never called automatically: only the server actions in
 * lib/actions/drive-share.ts call these, after the operator's confirm.
 */

import { DriveApiError, type DriveApi } from "./client.ts";
import { rowById, type DriveDb } from "./db.ts";
import { EVENT_NOT_ON_ACCOUNT } from "./panel.ts";
import { isCancelled } from "./tree.ts";

export type ShareResult = { ok: true; sharedWith: string | null; sharedAt: string | null } | { ok: false; error: string };

export const NO_FOLDER = "This event has no Drive folder yet — set up Drive first.";
export const DRIVE_REFUSED = "Drive won't let the export account share — a Manager of Off / Pixel needs to allow it in the drive's sharing settings.";
const NOT_YOURS = EVENT_NOT_ON_ACCOUNT;

/** Drive's reasons for a share the drive's settings don't allow. */
const REFUSALS = new Set([
  "cannotShareTeamDriveWithNonGoogleAccounts",
  "cannotShareTeamDriveTopFolderWithAnyoneOrDomains",
  "shareOutNotPermitted",
  "shareInNotPermitted",
  "publishOutNotPermitted",
  "teamDrivesSharingRestrictionNotAllowed",
  "insufficientFilePermissions",
  "forbidden",
]);

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function ownedEvent(db: DriveDb, eventId: string, userId: string) {
  const event = await rowById(db, "events", eventId);
  return event && event.user_id === userId ? event : null;
}

export async function shareEventFolder(
  db: DriveDb,
  drive: DriveApi,
  args: { eventId: string; email: string; userId: string; now?: Date },
): Promise<ShareResult> {
  const email = args.email.trim();
  if (!isEmail(email)) return { ok: false, error: "Enter the promoter's email address." };
  const event = await ownedEvent(db, args.eventId, args.userId);
  if (!event) return { ok: false, error: NOT_YOURS };
  if (!event.drive_folder_id) return { ok: false, error: NO_FOLDER };
  if (isCancelled(event.status)) return { ok: false, error: "This event is cancelled — its folder is no longer shared out." };
  if (event.drive_share_permission_id) {
    return { ok: false, error: `This folder is already shared with ${event.drive_shared_with ?? "someone"} — stop sharing first.` };
  }
  let permissionId: string;
  try {
    permissionId = await drive.shareReader(event.drive_folder_id, email);
  } catch (err) {
    if (err instanceof DriveApiError && (err.status === 403 || REFUSALS.has(err.reason))) return { ok: false, error: DRIVE_REFUSED };
    return { ok: false, error: "Drive didn't share the folder. Try again." };
  }
  const sharedAt = (args.now ?? new Date()).toISOString();
  const res = await db
    .from("events")
    .update({ drive_shared_at: sharedAt, drive_shared_by: args.userId, drive_share_permission_id: permissionId, drive_shared_with: email })
    .eq("id", event.id);
  if (res.error) {
    // The grant stands in Drive; take it back so the app and Drive agree.
    await drive.removePermission(event.drive_folder_id, permissionId).catch(() => undefined);
    return { ok: false, error: "Couldn't save the share. Nothing was shared." };
  }
  return { ok: true, sharedWith: email, sharedAt };
}

export async function stopSharingEventFolder(db: DriveDb, drive: DriveApi, args: { eventId: string; userId: string }): Promise<ShareResult> {
  const event = await ownedEvent(db, args.eventId, args.userId);
  if (!event) return { ok: false, error: NOT_YOURS };
  if (!event.drive_folder_id) return { ok: false, error: NO_FOLDER };
  if (!event.drive_share_permission_id) return { ok: true, sharedWith: null, sharedAt: null };
  try {
    await drive.removePermission(event.drive_folder_id, event.drive_share_permission_id);
  } catch (err) {
    if (err instanceof DriveApiError && (err.status === 403 || REFUSALS.has(err.reason))) return { ok: false, error: DRIVE_REFUSED };
    return { ok: false, error: "Drive didn't stop sharing the folder. Try again." };
  }
  const res = await db
    .from("events")
    .update({ drive_shared_at: null, drive_shared_by: null, drive_share_permission_id: null, drive_shared_with: null })
    .eq("id", event.id);
  if (res.error) return { ok: false, error: "Sharing stopped in Drive, but the event didn't save. Reload the page." };
  return { ok: true, sharedWith: null, sharedAt: null };
}
