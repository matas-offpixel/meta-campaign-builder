import assert from "node:assert/strict";
import { test } from "node:test";

import { fakeDb } from "../../mcp/__tests__/fake-db.ts";
import { refusedTodayRow, todayRow, type RenderFileRow } from "../report.ts";
import { londonMidnight, loadTodayRenderLog } from "../today-load.ts";
import { MATAS } from "./fixtures.ts";

const file = (i: number, passed: boolean, status: RenderFileRow["status"] = "done"): RenderFileRow => ({
  id: `f${i}`,
  fileName: `P26-BDAY__promoter-puzzle__montage__teaser__tickets__r1__9x16-${i}.mp4`,
  status,
  round: 1,
  recipe: "montage",
  shareable: false,
  heldReason: "filmed",
  checks: status === "done" ? { passed, failed: passed ? [] : ["format"] } : null,
  driveFileId: status === "done" ? `d${i}` : null,
});
const pkg = { id: "p1", eventCode: "P26-BDAY", eventId: "ev", recipes: ["montage" as const], fileCount: 9, approvalAsked: "Render the P26-BDAY montage: 9 files … OK?", approvalAnswer: "yes", approvedAt: "2026-11-25T15:10:00Z", createdAt: "2026-11-25T15:10:00Z" };

test("RY2 while rendering: FC1's row, Approved in Claude, What Claude asked, n of m done, the no-Undo line, no Approve or Reject", () => {
  const row = todayRow({ ...pkg, status: "rendering" }, [file(1, true), file(2, true), file(3, true), file(4, true), file(5, true, "rendering")]);
  assert.equal(row.title, "Render package · P26-BDAY");
  assert.equal(row.change, "Montage (15 s): 9 files");
  assert.equal(row.approved, "Approved in Claude · Wed 25 Nov, 15:10");
  assert.equal(row.asked, "What Claude asked");
  assert.equal(row.askedQ, "Asked: “Render the P26-BDAY montage: 9 files … OK?”");
  assert.equal(row.askedA, "Answer: “yes”");
  assert.equal(row.rendering, "Rendering · 4 of 9 files done");
  assert.equal(row.done, null);
  assert.equal(row.noUndo, "No Undo: rendered files stay in the event’s Drive folder.");
  assert.ok(!JSON.stringify(row).includes("Approve "), "no Approve");
  assert.ok(!JSON.stringify(row).includes("Reject"), "no Reject");
});

test("RY2 when done: the done line, one failed in brick with its one-form, Open in the Lab", () => {
  const rows = Array.from({ length: 9 }, (_, i) => file(i, i !== 7));
  const row = todayRow({ ...pkg, status: "done" }, rows);
  assert.equal(row.done, "Done · 9 files rendered and filed in Drive · 8 passed every check");
  assert.equal(row.failed, "1 failed: Format");
  assert.equal(row.openLab?.text, "Open in the Lab");
});

test("refused packages are logged muted with RY2's short reasons", () => {
  assert.equal(refusedTodayRow({ id: "a", eventCode: "P26-BDAY", recipes: ["montage", "roll-call", "top-tracks", "artist-card"], files: 33, refused: "cap", line: "Refused · over the 24-file cap" }).change, "Montage (15 s), roll-call, top tracks, artist card: 33 files");
  assert.equal(refusedTodayRow({ id: "b", eventCode: "X", recipes: ["montage"], files: 9, refused: "no_approval", line: "" }).refused, "Refused · no approval given");
});

test("Today's loader: today's Claude packages and today's logged refusals, newest first; Lab packages and the cost guard's refusals aren't in Claude's log", async () => {
  const now = new Date("2026-11-25T16:00:00Z");
  const db = fakeDb({
    creative_lab_render_packages: [
      { id: "p1", user_id: MATAS, event_id: "ev", recipes: ["montage"], file_count: 9, status: "done", source: "claude", approval_asked: "Q", approval_answer: "yes", approved_at: "2026-11-25T15:10:00Z", created_at: "2026-11-25T15:10:00Z" },
      { id: "p2", user_id: MATAS, event_id: "ev", recipes: ["montage"], file_count: 9, status: "done", source: "lab", approval_asked: null, approval_answer: null, approved_at: null, created_at: "2026-11-25T15:20:00Z" },
      { id: "p0", user_id: MATAS, event_id: "ev", recipes: ["montage"], file_count: 9, status: "done", source: "claude", approval_asked: "Q", approval_answer: "yes", approved_at: "2026-11-24T15:10:00Z", created_at: "2026-11-24T15:10:00Z" },
    ],
    creative_lab_renders: [],
    events: [{ id: "ev", event_code: "P26-BDAY", name: "x" }],
    mcp_actions: [
      { id: "m1", user_id: MATAS, tool: "render_package", status: "failed", result: { refused: "promoter", code: "ES27-ENZOSIRAGUSA", recipes: ["montage"], files: 9, line: "Refused · Puzzle’s footage in the picks" }, created_at: "2026-11-25T15:30:00Z" },
      { id: "m2", user_id: MATAS, tool: "render_package", status: "failed", result: { refused: "busy", code: "P26-BDAY", recipes: ["montage"], files: 9 }, created_at: "2026-11-25T15:31:00Z" },
    ],
  });
  const log = (await loadTodayRenderLog(db, MATAS, now))!;
  assert.equal(log.title, "Claude’s changes");
  assert.equal(log.count, "2 today");
  assert.deepEqual(log.entries.map((e) => e.kind), ["refused", "package"]);
  assert.equal(londonMidnight(new Date("2026-07-01T12:00:00Z")), "2026-06-30T23:00:00.000Z");
  assert.equal(londonMidnight(now), "2026-11-25T00:00:00.000Z");
});
