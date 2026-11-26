/**
 * upload_to_event_folder (M3d-c): only the show's own tree, the show's
 * client's own files or the artist library, never a permission, share,
 * move or delete, and tagged so the Drive pickup skips its own copy.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDb } from "./fake-db.ts";
import { OPERATOR, STRANGER } from "./helpers.ts";
import { uploadToEventFolderTool } from "../tools/folder-in.ts";
import { folderDepsFor, sourceTag } from "../folder-in/place.ts";
import { folderSegments, resolveFolderPath } from "../folder-in/resolve.ts";
import { ToolInputError, type ToolContext } from "../tool-types.ts";
import { skipReason } from "../../drive/pickup.ts";
import type { DriveApi, DriveFile } from "../../drive/client.ts";

const DRIVE = "0ADRIVE";
const CLIENT = "c0000000-0000-4000-8000-000000000001";
const OTHER_CLIENT = "c0000000-0000-4000-8000-000000000002";
const EVENT = "e0000000-0000-4000-8000-000000000001";
const OTHER_EVENT = "e0000000-0000-4000-8000-000000000002";
const ENZO = "a0000000-0000-4000-8000-000000000001";
const LAB_ENZO = "b0000000-0000-4000-8000-000000000001";
const MONDAY = "2026-11-30";

/** Drive folders and files: id → { name, parents, mimeType }. */
function driveFiles(): Record<string, DriveFile> {
  const folder = (id: string, name: string, parent: string): DriveFile => ({ id, name, mimeType: "application/vnd.google-apps.folder", parents: [parent] });
  return {
    F_CLIENT: folder("F_CLIENT", "Electric Studios", DRIVE),
    F_EVENT: folder("F_EVENT", "2027-01-10 Enzo [ES27-ENZO]", "F_CLIENT"),
    F_01: folder("F_01", "01 Open files", "F_EVENT"),
    F_02: folder("F_02", "02 Source", "F_EVENT"),
    F_CLIPS: folder("F_CLIPS", "Artist clips", "F_02"),
    F_CLIPS_ENZO: folder("F_CLIPS_ENZO", "Enzo Siragusa", "F_CLIPS"),
    F_AUDIO: folder("F_AUDIO", "Audio", "F_02"),
    F_AUDIO_ENZO: folder("F_AUDIO_ENZO", "Enzo Siragusa", "F_AUDIO"),
    F_03: folder("F_03", "03 Creatives", "F_EVENT"),
    F_ONSALE: folder("F_ONSALE", "3 On sale", "F_03"),
    F_WC: folder("F_WC", "w/c 30 Nov", "F_ONSALE"),
    F_WC_ENZO: folder("F_WC_ENZO", "Enzo Siragusa", "F_WC"),
    F_WC_ENZO_V: folder("F_WC_ENZO_V", "Videos", "F_WC_ENZO"),
    F_WC_ENZO_S: folder("F_WC_ENZO_S", "Statics", "F_WC_ENZO"),
    // Another of the client's shows.
    F_OTHER_EVENT: folder("F_OTHER_EVENT", "2027-02-01 Other [ES27-OTHER]", "F_CLIENT"),
    F_OTHER_01: folder("F_OTHER_01", "01 Open files", "F_OTHER_EVENT"),
    // Another client.
    F_OTHER_CLIENT: folder("F_OTHER_CLIENT", "NX Loves", DRIVE),
    // The artist library.
    F_LIB: folder("F_LIB", "00 Artist Library", DRIVE),
    F_LIB_ENZO: folder("F_LIB_ENZO", "Enzo Siragusa", "F_LIB"),
    // Files.
    CLIP_OWN: { id: "CLIP_OWN", name: "enzo-crowd.mp4", mimeType: "video/mp4", parents: ["F_CLIENT"] },
    CLIP_LIB: { id: "CLIP_LIB", name: "enzo-press.mp4", mimeType: "video/mp4", parents: ["F_LIB_ENZO"] },
    CLIP_OTHER: { id: "CLIP_OTHER", name: "nx-crowd.mp4", mimeType: "video/mp4", parents: ["F_OTHER_CLIENT"] },
    PHOTO_OWN: { id: "PHOTO_OWN", name: "poster.jpg", mimeType: "image/jpeg", parents: ["F_CLIENT"] },
    WAV_OWN: { id: "WAV_OWN", name: "track.wav", mimeType: "audio/wav", parents: ["F_CLIENT"] },
    OUTSIDE: { id: "OUTSIDE", name: "mine.mp4", mimeType: "video/mp4", parents: ["MY_DRIVE_FOLDER"] },
  };
}

type Call = { fn: string; args: unknown[] };

/** A full DriveApi that records every call: the test asserts what was (and wasn't) touched. */
function spyDrive(files = driveFiles()): DriveApi & { calls: Call[]; created: DriveFile[] } {
  const calls: Call[] = [];
  const created: DriveFile[] = [];
  const rec =
    (fn: string, impl: (...a: never[]) => unknown) =>
    (...args: unknown[]) => {
      calls.push({ fn, args });
      return (impl as (...a: unknown[]) => unknown)(...args);
    };
  let n = 0;
  return {
    driveId: DRIVE,
    calls,
    created,
    getFile: rec("getFile", async (id: string) => files[id] ?? null) as DriveApi["getFile"],
    listChildren: rec("listChildren", async (parent: string, opts?: { name?: string }) =>
      [...Object.values(files), ...created].filter((f) => f.parents?.[0] === parent && (opts?.name == null || f.name === opts.name)),
    ) as DriveApi["listChildren"],
    copyFile: rec("copyFile", async (a: { fileId: string; parentId: string; name: string; appProperties: Record<string, string> }) => {
      const f: DriveFile = { id: `NEW_${++n}`, name: a.name, mimeType: files[a.fileId]!.mimeType, parents: [a.parentId], appProperties: a.appProperties };
      created.push(f);
      return f;
    }) as NonNullable<DriveApi["copyFile"]>,
    uploadFile: rec("uploadFile", async (a: { parentId: string; name: string; mimeType: string; appProperties: Record<string, string> }) => {
      const f: DriveFile = { id: `NEW_${++n}`, name: a.name, mimeType: a.mimeType, parents: [a.parentId], appProperties: a.appProperties };
      created.push(f);
      return f;
    }) as DriveApi["uploadFile"],
    createFolder: rec("createFolder", async () => assert.fail("no folder is made")) as DriveApi["createFolder"],
    createShortcut: rec("createShortcut", async () => assert.fail("no shortcut")) as DriveApi["createShortcut"],
    update: rec("update", async () => assert.fail("no rename or move")) as DriveApi["update"],
    download: rec("download", async () => new Uint8Array()) as DriveApi["download"],
    startPageToken: rec("startPageToken", async () => "1") as DriveApi["startPageToken"],
    listChanges: rec("listChanges", async () => ({ changes: [], nextPageToken: null, newStartPageToken: null })) as DriveApi["listChanges"],
    shareReader: rec("shareReader", async () => assert.fail("never shares")) as DriveApi["shareReader"],
    removePermission: rec("removePermission", async () => assert.fail("never touches a permission")) as DriveApi["removePermission"],
  };
}

const map = (key: string, name: string, id: string, eventId: string | null = EVENT) => ({ client_id: CLIENT, event_id: eventId, key, name, drive_folder_id: id });

function tables() {
  return {
    clients: [
      { id: CLIENT, name: "Electric Studios", status: "active" },
      { id: OTHER_CLIENT, name: "NX Loves", status: "active" },
    ],
    events: [
      { id: EVENT, user_id: OPERATOR, client_id: CLIENT, event_code: "ES27-ENZO", name: "Enzo", drive_folder_id: "F_EVENT", event_date: "2027-01-10", status: "on_sale", client: { name: "Electric Studios" } },
      { id: OTHER_EVENT, user_id: OPERATOR, client_id: CLIENT, event_code: "ES27-OTHER", name: "Other", drive_folder_id: "F_OTHER_EVENT", event_date: "2027-02-01", status: "on_sale", client: { name: "Electric Studios" } },
    ],
    drive_folders: [
      map("client", "Electric Studios", "F_CLIENT", null),
      map("event", "2027-01-10 Enzo [ES27-ENZO]", "F_EVENT"),
      map("01", "01 Open files", "F_01"),
      map("02", "02 Source", "F_02"),
      map("02/artist-clips", "Artist clips", "F_CLIPS"),
      map(`02/artist-clips/${ENZO}`, "Enzo Siragusa", "F_CLIPS_ENZO"),
      map("02/audio", "Audio", "F_AUDIO"),
      map(`02/audio/${ENZO}`, "Enzo Siragusa", "F_AUDIO_ENZO"),
      map("03", "03 Creatives", "F_03"),
      map("03/3", "3 On sale", "F_ONSALE"),
      map(`03/3/wc/${MONDAY}`, "w/c 30 Nov", "F_WC"),
      map(`03/3/wc/${MONDAY}/owner/artist:${LAB_ENZO}`, "Enzo Siragusa", "F_WC_ENZO"),
      map(`03/3/wc/${MONDAY}/owner/artist:${LAB_ENZO}/videos`, "Videos", "F_WC_ENZO_V"),
      map(`03/3/wc/${MONDAY}/owner/artist:${LAB_ENZO}/statics`, "Statics", "F_WC_ENZO_S"),
      map("event", "2027-02-01 Other [ES27-OTHER]", "F_OTHER_EVENT", OTHER_EVENT),
      { client_id: OTHER_CLIENT, event_id: null, key: "client", name: "NX Loves", drive_folder_id: "F_OTHER_CLIENT" },
      map("01", "01 Open files", "F_OTHER_01", OTHER_EVENT),
    ],
    event_artists: [{ id: "ea1", event_id: EVENT, artist_id: ENZO, source: "lab", billing_order: 0 }],
    artists: [{ id: ENZO, name: "Enzo Siragusa" }],
    artist_library_folders: [],
    campaign_drafts: [
      {
        id: "d1",
        event_id: EVENT,
        user_id: OPERATOR,
        draft_json: { creatives: [{ assetVariations: [{ assets: [{ storagePath: "drive-picks/videos/abc.mp4", storageBucket: "campaign-assets", fileName: "enzo-cut.mp4" }] }] }] },
      },
    ],
  };
}

function ctxFor(drive: DriveApi | null, opts: { userId?: string; scope?: string; storage?: Uint8Array } = {}) {
  const db = fakeDb(tables() as never);
  const downloads: string[] = [];
  const folderIn = folderDepsFor(drive, async (bucket, path) => {
    downloads.push(`${bucket}/${path}`);
    return opts.storage ?? new Uint8Array([1, 2, 3]);
  });
  const ctx = {
    db,
    readers: {} as never,
    userId: opts.userId ?? OPERATOR,
    scope: opts.scope ?? "mcp:read mcp:draft",
    folderIn,
    seesClientNames: true,
    today: "2026-11-26",
    now: new Date("2026-11-26T09:00:00Z"),
  } as ToolContext;
  return { ctx, db, downloads };
}

const run = (ctx: ToolContext, args: Record<string, unknown>) => uploadToEventFolderTool.run(ctx, { event_code: "ES27-ENZO", ...args });

async function refused(p: Promise<unknown>, refusedCode: string): Promise<ToolInputError> {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof ToolInputError, String(e));
    assert.equal((e.summary as { refused?: string } | null)?.refused, refusedCode, e.message);
    assert.match(e.message, /Nothing (was )?changed\.$/);
    return e;
  }
  assert.fail(`expected a refusal ${refusedCode}`);
}

const writes = (d: ReturnType<typeof spyDrive>) => d.calls.filter((c) => ["copyFile", "uploadFile", "createFolder", "createShortcut", "update", "shareReader", "removePermission"].includes(c.fn));

test("folder paths: the five targets resolve by the tree's own keys; w/c is one segment", () => {
  assert.deepEqual(folderSegments("w/c 30 Nov / Enzo Siragusa / Videos"), ["w/c 30 Nov", "Enzo Siragusa", "Videos"]);
  const rows = tables().drive_folders.filter((r) => r.event_id === EVENT);
  const lineup = [{ libraryArtistId: ENZO, name: "Enzo Siragusa" }];
  const r = (t: string) => resolveFolderPath(t, rows, lineup);
  assert.deepEqual(r("01 Open files"), { ok: true, key: "01", folderId: "F_01", label: "01 Open files", takes: "any" });
  assert.equal((r("3 On sale") as { folderId: string }).folderId, "F_ONSALE");
  assert.equal((r("02 Source / Artist clips / Enzo Siragusa") as { folderId: string }).folderId, "F_CLIPS_ENZO");
  assert.equal((r("02 Source / Audio / enzo siragusa") as { folderId: string }).folderId, "F_AUDIO_ENZO");
  assert.equal((r("w/c 30 Nov / Enzo Siragusa / Statics") as { folderId: string }).folderId, "F_WC_ENZO_S");
  assert.equal((r("3 On sale / w/c 2026-11-30 / Enzo Siragusa / Videos") as { folderId: string }).folderId, "F_WC_ENZO_V");
  assert.equal((r("00 Brief & admin") as { refused: string }).refused, "folder_unrecognised");
  assert.equal((r("02 Source / Artist clips / Someone Else") as { refused: string }).refused, "artist_not_on_lineup");
  assert.equal((r("w/c 7 Dec / Enzo Siragusa / Videos") as { refused: string }).refused, "cycle_not_found");
  assert.equal((r("w/c 30 Nov / Electric Studios / Videos") as { refused: string }).refused, "owner_not_found");
});

test("a shared-drive file of the show's client is copied into the show's folder, tagged so the pickup skips it", async () => {
  const drive = spyDrive();
  const { ctx } = ctxFor(drive);
  const out = await run(ctx, { folder: "w/c 30 Nov / Enzo Siragusa / Videos", drive_file_id: "CLIP_OWN" });
  const data = out.data as { placed: boolean; fileId: string; link: string; message: string };
  assert.equal(data.placed, true);
  assert.match(data.message, /^Done: enzo-crowd\.mp4 is in w\/c 30 Nov \/ Enzo Siragusa \/ Videos\./);
  assert.match(data.link, /^https:\/\/drive\.google\.com\/file\/d\/NEW_1\/view$/);
  const w = writes(drive);
  assert.deepEqual(w.map((c) => c.fn), ["copyFile"]);
  const args = w[0]!.args[0] as { fileId: string; parentId: string; appProperties: Record<string, string> };
  assert.equal(args.fileId, "CLIP_OWN");
  assert.equal(args.parentId, "F_WC_ENZO_V");
  // Pickup's own predicate reads the new file as the app's own.
  const placed = drive.created[0]!;
  assert.equal(skipReason({ fileId: placed.id, removed: false, file: placed }), "ours");
  assert.equal(out.summary.rights, "own");
});

test("artist-library material may go in; another client's footage may not", async () => {
  {
    const drive = spyDrive();
    const { ctx } = ctxFor(drive);
    const out = await run(ctx, { folder: "02 Source / Artist clips / Enzo Siragusa", drive_file_id: "CLIP_LIB" });
    assert.equal(out.summary.rights, "artist_library");
  }
  const drive = spyDrive();
  const { ctx } = ctxFor(drive);
  const e = await refused(run(ctx, { folder: "01 Open files", drive_file_id: "CLIP_OTHER" }), "other_client");
  assert.match(e.message, /in NX Loves’s folders/);
  assert.deepEqual(writes(drive), []);
});

test("only the show's own tree: another show's folder id, an unmapped id and a source outside the shared drive are refused", async () => {
  for (const [args, code] of [
    [{ folder_id: "F_OTHER_01", drive_file_id: "CLIP_OWN" }, "outside_tree"],
    [{ folder_id: "F_OTHER_CLIENT", drive_file_id: "CLIP_OWN" }, "outside_tree"],
    [{ folder_id: "F_02", drive_file_id: "CLIP_OWN" }, "not_a_target"],
    [{ folder: "01 Open files", drive_file_id: "OUTSIDE" }, "owner_unknown"],
    [{ folder: "01 Open files", drive_file_id: "NOPE" }, "source_outside"],
    [{ folder: "01 Open files", drive_file_id: "F_CLIPS" }, "source_folder"],
  ] as const) {
    const drive = spyDrive();
    const { ctx } = ctxFor(drive);
    await refused(run(ctx, args), code);
    assert.deepEqual(writes(drive), [], code);
  }
  // A folder id that is the show's own works.
  const drive = spyDrive();
  const { ctx } = ctxFor(drive);
  const out = await run(ctx, { folder_id: "F_01", drive_file_id: "PHOTO_OWN" });
  assert.equal(out.summary.key, "01");
});

test("a folder's map row that Drive doesn't place under the show is refused (the walk must reach the show)", async () => {
  const files = driveFiles();
  // The map says F_01 is the show's, but Drive has it under another show.
  files.F_01 = { ...files.F_01!, parents: ["F_OTHER_EVENT"] };
  const drive = spyDrive(files);
  const { ctx } = ctxFor(drive);
  // The walk from F_01 never passes the show's own event folder.
  await refused(run(ctx, { folder: "01 Open files", drive_file_id: "PHOTO_OWN" }), "outside_tree");
  assert.deepEqual(writes(drive), []);
});

test("what a folder takes: Videos a video, Statics a photo, Audio an audio file", async () => {
  for (const [folder, file, ok] of [
    ["w/c 30 Nov / Enzo Siragusa / Statics", "CLIP_OWN", false],
    ["w/c 30 Nov / Enzo Siragusa / Videos", "PHOTO_OWN", false],
    ["02 Source / Audio / Enzo Siragusa", "CLIP_OWN", false],
    ["02 Source / Audio / Enzo Siragusa", "WAV_OWN", true],
    ["w/c 30 Nov / Enzo Siragusa / Statics", "PHOTO_OWN", true],
  ] as const) {
    const drive = spyDrive();
    const { ctx } = ctxFor(drive);
    if (ok) assert.equal(((await run(ctx, { folder, drive_file_id: file })).data as { placed: boolean }).placed, true);
    else await refused(run(ctx, { folder, drive_file_id: file }), "kind");
  }
});

test("a Storage file on one of the show's drafts is uploaded; a path that isn't is refused", async () => {
  const drive = spyDrive();
  const { ctx, downloads } = ctxFor(drive);
  const out = await run(ctx, { folder: "02 Source / Artist clips / Enzo Siragusa", storage_path: "drive-picks/videos/abc.mp4" });
  assert.equal((out.data as { placed: boolean }).placed, true);
  assert.deepEqual(downloads, ["campaign-assets/drive-picks/videos/abc.mp4"]);
  const w = writes(drive);
  assert.deepEqual(w.map((c) => c.fn), ["uploadFile"]);
  const a = w[0]!.args[0] as { name: string; mimeType: string; parentId: string; appProperties: Record<string, string> };
  assert.deepEqual([a.name, a.mimeType, a.parentId], ["enzo-cut.mp4", "video/mp4", "F_CLIPS_ENZO"]);
  assert.equal(a.appProperties.offpixel_source, sourceTag({ storagePath: "drive-picks/videos/abc.mp4" }));
  assert.equal(skipReason({ fileId: "x", removed: false, file: drive.created[0]! }), "ours");

  const d2 = spyDrive();
  const c2 = ctxFor(d2);
  await refused(run(c2.ctx, { folder: "01 Open files", storage_path: "drive-picks/videos/someone-elses.mp4" }), "storage_not_on_event");
  assert.deepEqual(c2.downloads, []);
  assert.deepEqual(writes(d2), []);
});

test("a retry finds its own copy and places nothing twice", async () => {
  const drive = spyDrive();
  const { ctx } = ctxFor(drive);
  await run(ctx, { folder: "01 Open files", drive_file_id: "PHOTO_OWN" });
  const again = await run(ctx, { folder: "01 Open files", drive_file_id: "PHOTO_OWN" });
  assert.equal((again.data as { placed: boolean }).placed, false);
  assert.match((again.data as { message: string }).message, /^Nothing changed: poster\.jpg is already in 01 Open files\./);
  assert.deepEqual(writes(drive).map((c) => c.fn), ["copyFile"]);
});

test("no permission, share, move, rename, folder or delete call is ever made, on any path", async () => {
  const drive = spyDrive();
  const { ctx } = ctxFor(drive);
  await run(ctx, { folder: "01 Open files", drive_file_id: "PHOTO_OWN" });
  await run(ctx, { folder: "3 On sale", storage_path: "drive-picks/videos/abc.mp4" });
  await run(ctx, { folder: "w/c 30 Nov / Enzo Siragusa / Videos", drive_file_id: "CLIP_LIB" });
  const fns = new Set(drive.calls.map((c) => c.fn));
  for (const forbidden of ["shareReader", "removePermission", "update", "createFolder", "createShortcut"]) assert.ok(!fns.has(forbidden), forbidden);
  assert.deepEqual([...fns].sort(), ["copyFile", "getFile", "listChildren", "uploadFile"]);
});

test("refusals before anything is read or written: scope, event, owner, source and folder", async () => {
  const drive = spyDrive();
  await refused(run(ctxFor(drive, { scope: "mcp:read" }).ctx, { folder: "01 Open files", drive_file_id: "PHOTO_OWN" }), "insufficient_scope");
  await refused(run(ctxFor(drive, { userId: STRANGER }).ctx, { folder: "01 Open files", drive_file_id: "PHOTO_OWN" }), "not_owner");
  await refused(uploadToEventFolderTool.run(ctxFor(drive).ctx, { event_code: "NOPE-1", folder: "01 Open files", drive_file_id: "PHOTO_OWN" }), "event_not_found");
  await refused(run(ctxFor(drive).ctx, { folder: "01 Open files" }), "source");
  await refused(run(ctxFor(drive).ctx, { folder: "01 Open files", drive_file_id: "PHOTO_OWN", storage_path: "x" }), "source");
  await refused(run(ctxFor(drive).ctx, { drive_file_id: "PHOTO_OWN" }), "folder");
  await refused(run(ctxFor(null).ctx, { folder: "01 Open files", drive_file_id: "PHOTO_OWN" }), "no_drive");
  assert.deepEqual(writes(drive), []);
});
