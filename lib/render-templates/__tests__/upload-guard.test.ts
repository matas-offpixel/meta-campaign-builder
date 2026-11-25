import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { fakeDb } from "../../mcp/__tests__/fake-db.ts";
import { D_DRAFT, UPDATED, draftCtx, draftTables } from "../../mcp/__tests__/draft-fixtures.ts";
import { attachDriveCreativesTool } from "../../mcp/tools/draft-drive.ts";
import { ToolInputError } from "../../mcp/tool-types.ts";
import { refusedUploads, uploadFilesOf } from "../upload-guard.ts";

const failedRow = (drive: string) => ({
  id: `r-${drive}`,
  recipe: "montage",
  file_name: "P26-BDAY__promoter-puzzle__montage__no-text__no-cta__r1__4x5.mp4",
  drive_file_id: drive,
  storage_path: `renders/m4/p/${drive}.mp4`,
  status: "done",
  checks: { passed: false, failed: ["format", "montage.text"], notes: ["1080×1080"] },
});
const passedRow = (drive: string) => ({ ...failedRow(drive), id: `ok-${drive}`, file_name: "P26-BDAY__promoter-puzzle__montage__teaser__tickets__r1__9x16.mp4", checks: { passed: true, failed: [], notes: [] } });

test("a file that failed a check is refused in RT2's words, by Drive id, Storage path or name; a passed one goes on", async () => {
  const db = fakeDb({ creative_lab_renders: [failedRow("drv-bad"), passedRow("drv-ok"), { id: "cap", recipe: null, drive_file_id: "drv-caption", status: "done", checks: null }] });
  const out = await refusedUploads(db, [{ driveFileId: "drv-bad" }, { driveFileId: "drv-ok" }, { driveFileId: "drv-caption" }, { driveFileId: "elsewhere" }]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.line, "Failed Format · Text on the kicks, so it can’t be uploaded.");
  assert.equal((await refusedUploads(db, [{ storagePath: "renders/m4/p/drv-bad.mp4" }])).length, 1);
  assert.equal((await refusedUploads(db, [{ fileName: "P26-BDAY__promoter-puzzle__montage__no-text__no-cta__r1__4x5.mp4" }])).length, 1);
  assert.deepEqual(await refusedUploads(db, [{ driveFileId: "drv-ok" }]), []);
});

test("before migration 270 there are no package files, so nothing is refused (and nothing breaks)", async () => {
  assert.deepEqual(await refusedUploads(fakeDb({}), [{ driveFileId: "drv-bad" }]), []);
});

test("the campaign tree's Add creatives to… path: the bulk-attach body's slots are checked, and the route refuses before any token or Meta call", async () => {
  const db = fakeDb({ creative_lab_renders: [failedRow("drv-bad")] });
  const creatives = [
    { id: "c1", name: "Montage", assetVariations: [{ id: "v1", name: "v", assets: [{ id: "a1", aspectRatio: "4:5", driveFileId: "drv-bad", uploadStatus: "pending" }, { id: "a2", aspectRatio: "9:16", driveFileId: "drv-other", uploadStatus: "pending" }] }] },
  ];
  const files = uploadFilesOf(creatives);
  assert.deepEqual(files.map((f) => f.driveFileId), ["drv-bad", "drv-other"]);
  const refused = await refusedUploads(db, files);
  assert.equal(refused[0]!.line, "Failed Format · Text on the kicks, so it can’t be uploaded.");
  const route = readFileSync(new URL("../../../app/api/meta/bulk-attach-ads/route.ts", import.meta.url), "utf8");
  const guard = route.indexOf("refusedUploads(guardDb, uploadFilesOf(newCreatives))");
  assert.ok(guard > 0, "the route runs the guard on every run, tree or not");
  assert.ok(guard < route.indexOf("// ── Resolve token"), "before the token, so before any Meta call");
  assert.match(route, /code: "render_failed_check"/);
  const page = readFileSync(new URL("../../../app/(dashboard)/events/[id]/bulk-attach/page.tsx", import.meta.url), "utf8");
  assert.match(page, /data\.code === "render_failed_check" && data\.error \? data\.error/, "the stage sheet shows RT2's line");
});

test("the connector path: attach_drive_creatives refuses a failed render file and saves nothing; a passed one is added", async () => {
  const tables = { ...draftTables(), creative_lab_renders: [failedRow("file-static-916")] };
  const { ctx } = draftCtx({ db: fakeDb(tables) as never });
  const db = ctx.db as ReturnType<typeof fakeDb>;
  try {
    await attachDriveCreativesTool.run(ctx, { draft_id: D_DRAFT, updated_at: UPDATED, file_ids: ["file-static-916"] });
    assert.fail("expected a refusal");
  } catch (e) {
    assert.ok(e instanceof ToolInputError);
    assert.equal(e.message, "Failed Format · Text on the kicks, so it can’t be uploaded.");
    assert.equal(e.summary?.refused, "render_failed_check");
  }
  assert.deepEqual(db.writes.filter((w) => w.table === "campaign_drafts"), []);

  const ok = { ...draftTables(), creative_lab_renders: [passedRow("file-static-916")] };
  const { ctx: ctx2 } = draftCtx({ db: fakeDb(ok) as never });
  const out = (await attachDriveCreativesTool.run(ctx2, { draft_id: D_DRAFT, updated_at: UPDATED, file_ids: ["file-static-916"] })) as { data: { added: unknown[] } };
  assert.equal(out.data.added.length, 1);
});
