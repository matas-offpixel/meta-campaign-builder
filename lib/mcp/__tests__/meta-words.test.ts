/**
 * M3a's words, word for word from design's list (record
 * 2026-11-25-mcp-full-control, FC2 and FC4): a copy of
 * scratch/mcp/words-mcp-today-2026-11-25.tsv (143 rows, sha256 below) is the
 * fixture. Every row M3a shows or tells Claude is rendered here and compared
 * with the row, placeholders filled.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { LAUNCH_UPLOAD_WORDS, storedSendSteps } from "../../creatives/stored-at-launch.ts";
import { MCP_WORDS, RESULT_WORDS, THINGS } from "../meta/words.ts";
import { APPROVAL_WORDS } from "../meta/approval.ts";
import { CEILING_WORDS } from "../meta/ceiling.ts";

const FIXTURE = new URL("./fixtures/words-mcp-today-2026-11-25.tsv", import.meta.url);
const SHA256 = "5aeca085a051cc358091bf0861ebe908e08174030241792f865325fb3f6d1980";

const raw = readFileSync(FIXTURE);
const rows = new Map(
  raw
    .toString("utf8")
    .split("\n")
    .slice(1)
    .filter(Boolean)
    .map((line) => {
      const [key, , words] = line.split("\t");
      return [key!, words!] as const;
    }),
);

/** A row with its placeholders filled. */
function row(key: string, vars: Record<string, string | number> = {}): string {
  const words = rows.get(key);
  assert.ok(words, `${key} is in the list`);
  return words!.replace(/\{([a-z, ]+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

test("the fixture is design's list: header + 143 rows, sha256 5aeca085…", () => {
  assert.equal(createHash("sha256").update(raw).digest("hex"), SHA256);
  assert.equal(rows.size, 143);
});

test("FC2: what the meta tools tell Claude", () => {
  assert.equal(MCP_WORDS.refusedNoApproval, row("claude.mcp.refused.no_approval"));
  assert.equal(APPROVAL_WORDS.missing, row("claude.mcp.refused.no_approval"));
  assert.equal(APPROVAL_WORDS.tooLong, row("claude.mcp.refused.no_approval"));
  assert.equal(MCP_WORDS.refusedOverCeiling("Electric Brixton", 162, 150), row("claude.mcp.refused", { client: "Electric Brixton", x: "162.00", c: "150.00" }));
  assert.equal(CEILING_WORDS.over("Electric Brixton", 162, 150), row("claude.mcp.refused", { client: "Electric Brixton", x: "162.00", c: "150.00" }));
  assert.equal(MCP_WORDS.refusedNoCeiling("Puzzle"), row("claude.mcp.refused.none", { client: "Puzzle" }));
  assert.equal(CEILING_WORDS.none("Puzzle"), row("claude.mcp.refused.none", { client: "Puzzle" }));
  assert.equal(MCP_WORDS.refusedChecks(3), row("claude.mcp.refused.checks", { n: 3 }));
  assert.equal(MCP_WORDS.refusedChecks(1), row("claude.mcp.refused.checks.one"));
  assert.equal(MCP_WORDS.done("1 campaign launched · 120252911804750755"), row("claude.mcp.done", { result: "1 campaign launched · 120252911804750755" }));
  assert.equal(MCP_WORDS.undoNote, row("claude.mcp.undo_note"));
});

test("the results in claude.mcp.done: launched, added and changed, with their one-forms", () => {
  assert.equal(RESULT_WORDS.launched(THINGS.campaign, ["1"]), row("today.mcp.result.launched.one", { thing: "campaign", id: "1" }));
  assert.equal(RESULT_WORDS.launched(THINGS.campaign, ["1", "2"]), row("today.mcp.result.launched", { n: 2, things: "campaigns", ids: "1, 2" }));
  assert.equal(RESULT_WORDS.added(THINGS.file, ["v1"]), row("today.mcp.result.added.one", { thing: "file", id: "v1" }));
  assert.equal(RESULT_WORDS.added(THINGS.file, ["v1", "v2"]), row("today.mcp.result.added", { n: 2, things: "files", ids: "v1, v2" }));
  assert.equal(RESULT_WORDS.changed(THINGS.event, ["e1"]), row("today.mcp.result.one", { thing: "event", id: "e1" }));
  assert.equal(RESULT_WORDS.changed(THINGS.event, ["e1", "e2"]), row("today.mcp.result", { n: 2, things: "events", ids: "e1, e2" }));
});

test("FC4: Review's line, the two launch steps and their entity, and the stopped line", () => {
  assert.equal(LAUNCH_UPLOAD_WORDS.review(14), row("launch.upload.review", { n: 14 }));
  assert.equal(LAUNCH_UPLOAD_WORDS.review(1), row("launch.upload.review.one"));
  assert.equal(LAUNCH_UPLOAD_WORDS.progress(14), row("launch.upload.progress", { n: 14 }));
  assert.equal(LAUNCH_UPLOAD_WORDS.progress(1), row("launch.upload.progress.one"));
  assert.equal(LAUNCH_UPLOAD_WORDS.entity, row("launch.upload.entity"));
  assert.equal(LAUNCH_UPLOAD_WORDS.video(4), row("launch.upload.video", { n: 4 }));
  assert.equal(LAUNCH_UPLOAD_WORDS.video(1), row("launch.upload.video.one"));
  assert.equal(LAUNCH_UPLOAD_WORDS.stopped(2), row("launch.upload.stopped", { n: 2 }));
  assert.equal(LAUNCH_UPLOAD_WORDS.stopped(1), row("launch.upload.stopped.one"));
});

test("FC4's steps: files, then videos when any, each done once the next phase starts", () => {
  assert.deepEqual(storedSendSteps({ phase: "files", files: 14, videos: 4 }).map((s) => [s.entity, s.label, s.done]), [
    ["Files", "Sending 14 files to Meta…", false],
    ["Files", "Waiting for Meta to finish 4 videos…", false],
  ]);
  assert.deepEqual(storedSendSteps({ phase: "videos", files: 14, videos: 4 }).map((s) => s.done), [true, false]);
  assert.deepEqual(storedSendSteps({ phase: "launch", files: 14, videos: 4 }).map((s) => s.done), [true, true]);
  assert.deepEqual(storedSendSteps({ phase: "files", files: 1, videos: 0 }).map((s) => s.label), ["Sending 1 file to Meta…"]);
});
