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
import { APPROVAL_FIELD_WORDS, ATTACH_WORDS, EVENT_WORDS, LAUNCH_WORDS, MCP_WORDS, NAME_WORDS, RESULT_WORDS, THINGS, UPLOAD_WORDS } from "../meta/words.ts";
import { CONSENT_WORDS, consentContent } from "../oauth/consent-words.ts";
import { CLAUDE_CALLBACK } from "../config.ts";
import { APPROVAL_WORDS } from "../meta/approval.ts";
import { CEILING_WORDS } from "../meta/ceiling.ts";

const FIXTURE = new URL("./fixtures/words-mcp-today-2026-11-25.tsv", import.meta.url);
// Design's list (sha256 e2df1a10…) re-rules #1397's ceiling rows too; until #1397 merges, this copy carries
// #1400's part only: the 12 rows ruled 27 Nov with #1400 and consent.line2.meta with the audiences clause.
const SHA256 = "b77da000099d6ed433911fca621ebb73664ff212e64af0e2fd5fc29f1d0952f8";

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
  return words!.replace(/\{([a-z_, ]+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

test("the fixture is design's list: header + 261 rows (consent.line2.meta and settings.claude.scope.drafts re-ruled 26 Nov; record 2026-11-26-mcp-m3b-today adds 32; #1400 adds 12 and the consent audiences clause, 27 Nov), sha256 b77da000…", () => {
  assert.equal(createHash("sha256").update(raw).digest("hex"), SHA256);
  assert.equal(rows.size, 261);
});

test("the last six (MW2's rules): the draft refusals, the changed draft, the thrown upload, the event code", () => {
  assert.equal(MCP_WORDS.refusedDraftUnknown("3f2c"), row("claude.mcp.refused.draft_unknown", { id: "3f2c" }));
  assert.equal(MCP_WORDS.refusedDraftOtherAccount, row("claude.mcp.refused.draft_other_account"));
  assert.equal(MCP_WORDS.draftChanged, row("claude.mcp.draft_changed"));
  assert.equal(MCP_WORDS.refusedDraftId, row("claude.mcp.refused.draft_id"));
  assert.equal(MCP_WORDS.uploadThrew, row("claude.mcp.upload.threw"));
  assert.equal(EVENT_WORDS.refusedCode, row("claude.mcp.event.refused.code"));
  // Curly apostrophes, as the list has them.
  for (const w of [MCP_WORDS.refusedDraftOtherAccount, MCP_WORDS.draftChanged, MCP_WORDS.uploadThrew]) assert.doesNotMatch(w, /'/);
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

test("MW1: the consent page's Meta line, and the Meta upgrade's title and note", () => {
  assert.equal(CONSENT_WORDS.meta, row("consent.line2.meta"));
  assert.equal(CONSENT_WORDS.titleUpgradeMeta, row("consent.title.upgrade.meta"));
  assert.equal(CONSENT_WORDS.titleUpgradeMetaLoopback, row("consent.title.upgrade.meta.loopback"));
  assert.equal(CONSENT_WORDS.upgradeCancelNoteMeta, row("consent.upgrade.cancel_note.meta"));
  const META = "mcp:read mcp:draft mcp:meta";
  const page = (upgradeFrom?: "read" | "drafts") => consentContent({ redirectUri: CLAUDE_CALLBACK, clientName: "Claude", email: null, returnHost: "claude.ai", scope: META, upgradeFrom });
  assert.equal(page().lines[1], row("consent.line2.meta"));
  assert.equal(page().title, "Connect Claude to Off/Pixel");
  assert.equal(page().cancelNote, undefined);
  assert.deepEqual([page("drafts").title, page("drafts").cancelNote], [row("consent.title.upgrade.meta"), row("consent.upgrade.cancel_note.meta")]);
  // A read-only grant adding Meta keeps M2's note.
  assert.deepEqual([page("read").title, page("read").cancelNote], [row("consent.title.upgrade.meta"), "If you cancel, it keeps the read-only access it has now."]);
});

test("MW2: the refusals, each ending with what didn't happen", () => {
  assert.equal(MCP_WORDS.refusedScope, row("claude.mcp.refused.scope"));
  assert.equal(MCP_WORDS.refusedNoClient, row("claude.mcp.refused.no_client"));
  assert.equal(MCP_WORDS.refusedCurrency("EUR"), row("claude.mcp.refused.currency", { currency: "EUR" }));
  assert.equal(MCP_WORDS.refusedCeilingUnread, row("claude.mcp.refused.ceiling_unread"));
  assert.equal(MCP_WORDS.refusedNotDraft("published"), row("claude.mcp.refused.not_draft", { status: "published" }));
  assert.equal(MCP_WORDS.refusedChecksUnavailable, row("claude.mcp.refused.checks_unavailable"));
  assert.equal(APPROVAL_FIELD_WORDS.approval, row("claude.mcp.approval"));
  assert.equal(APPROVAL_FIELD_WORDS.asked, row("claude.mcp.approval.asked"));
  assert.equal(APPROVAL_FIELD_WORDS.answer, row("claude.mcp.approval.answer"));
});

test("MW2: launch_draft's answers, paused, live, failed and part way", () => {
  const link = "https://adsmanager.facebook.com/x";
  assert.equal(LAUNCH_WORDS.paused, row("claude.mcp.launch.mode.paused"));
  assert.equal(LAUNCH_WORDS.live(45), row("claude.mcp.launch.mode.live", { x: "45.00" }));
  assert.equal(LAUNCH_WORDS.link(link), row("claude.mcp.launch.link", { link }));
  assert.equal(LAUNCH_WORDS.failed, row("claude.mcp.launch.failed"));
  assert.equal(LAUNCH_WORDS.partialPaused("120", 1, 3, link), row("claude.mcp.launch.partial.paused", { id: "120", a: 1, adsets: "3 ad sets", link }));
  assert.equal(LAUNCH_WORDS.partialLive("120", 0, 1, link), row("claude.mcp.launch.partial.live", { id: "120", a: 0, adsets: "1 ad set", link }));
});

test("MW2: the send step's answers, with one-forms", () => {
  assert.equal(UPLOAD_WORDS.failedLaunch(2, 9), row("claude.mcp.upload.failed.launch", { f: 2, files: "9 files" }));
  assert.equal(UPLOAD_WORDS.failedLaunch(1, 9), row("claude.mcp.upload.failed.launch.one", { files: "9 files" }));
  assert.equal(UPLOAD_WORDS.failed(2, 9), row("claude.mcp.upload.failed", { f: 2, files: "9 files" }));
  assert.equal(UPLOAD_WORDS.failed(1, 1), row("claude.mcp.upload.failed.one", { files: "1 file" }));
  assert.equal(UPLOAD_WORDS.fileFailed("a.mp4"), row("claude.mcp.upload.file_failed", { "file name": "a.mp4" }));
  assert.equal(UPLOAD_WORDS.videoFailed("a.mp4"), row("claude.mcp.upload.video_failed", { "file name": "a.mp4" }));
  assert.equal(UPLOAD_WORDS.done(2), row("claude.mcp.upload.done", { files: "2 files" }));
  assert.equal(UPLOAD_WORDS.already(3), row("claude.mcp.upload.already", { n: 3 }));
  assert.equal(UPLOAD_WORDS.already(1), row("claude.mcp.upload.already.one"));
  assert.equal(UPLOAD_WORDS.none, row("claude.mcp.upload.none"));
  assert.equal(UPLOAD_WORDS.noLaunch, row("claude.mcp.upload.no_launch"));
});

test("MW2: update_event's answers and refusals", () => {
  assert.equal(EVENT_WORDS.done("NX27-X", "Announcement: not set → 2026"), row("claude.mcp.event.done", { code: "NX27-X", changes: "Announcement: not set → 2026" }));
  assert.equal(EVENT_WORDS.change("Presale", "a", "b"), row("claude.mcp.event.change", { field: "Presale", before: "a", after: "b" }));
  assert.equal(EVENT_WORDS.cleared, row("claude.mcp.event.cleared"));
  assert.equal(EVENT_WORDS.notSet, row("claude.mcp.event.not_set"));
  for (const [f, key] of [["announcement_at", "announcement"], ["presale_at", "presale"], ["general_sale_at", "general_sale"], ["signup_url", "signup_url"], ["ticket_url", "ticket_url"]]) {
    assert.equal(EVENT_WORDS.field[f!], row(`claude.mcp.event.field.${key}`));
  }
  assert.equal(EVENT_WORDS.refusedEmpty("a, b"), row("claude.mcp.event.refused.empty", { fields: "a, b" }));
  assert.equal(EVENT_WORDS.refusedUnknown("NX27-X"), row("claude.mcp.event.refused.unknown", { code: "NX27-X" }));
  assert.equal(EVENT_WORDS.refusedOtherAccount, row("claude.mcp.event.refused.other_account"));
  assert.equal(EVENT_WORDS.refusedTimeFormat("Presale"), row("claude.mcp.event.refused.time_format", { field: "Presale" }));
  assert.equal(EVENT_WORDS.refusedTime("Presale"), row("claude.mcp.event.refused.time", { field: "Presale" }));
  assert.equal(EVENT_WORDS.refusedLink("Ticket link"), row("claude.mcp.event.refused.link", { field: "Ticket link" }));
  assert.equal(EVENT_WORDS.failed, row("claude.mcp.event.failed"));
});

test("MW2: set_draft_name and the attach refusals", () => {
  assert.equal(NAME_WORDS.done("A", "B"), row("claude.mcp.name.done", { old: "A", new: "B" }));
  assert.equal(NAME_WORDS.same, row("claude.mcp.name.same"));
  assert.equal(NAME_WORDS.tooLong(400), row("claude.mcp.name.too_long", { max: 400 }));
  assert.equal(ATTACH_WORDS.outside, row("claude.mcp.attach.outside"));
  assert.equal(ATTACH_WORDS.fileOutside("1x"), row("claude.mcp.attach.file_outside", { id: "1x" }));
  assert.equal(ATTACH_WORDS.notMedia("1x"), row("claude.mcp.attach.not_media", { id: "1x" }));
  assert.equal(ATTACH_WORDS.singleRatio("a.jpg", "4:5"), row("claude.mcp.attach.single_ratio", { name: "a.jpg", ratio: "4:5" }));
  assert.equal(ATTACH_WORDS.pairFeed("a.jpg", "9:16"), row("claude.mcp.attach.pair.feed", { name: "a.jpg", ratio: "9:16" }));
  assert.equal(ATTACH_WORDS.pairVertical("a.jpg", "4:5"), row("claude.mcp.attach.pair.vertical", { name: "a.jpg", ratio: "4:5" }));
  assert.equal(
    ATTACH_WORDS.pairKinds("a.jpg", ATTACH_WORDS.kind.image!, "b.mp4", ATTACH_WORDS.kind.video!),
    row("claude.mcp.attach.pair.kinds", { "name a": "a.jpg", "kind a": row("claude.mcp.attach.kind.static"), "name b": "b.mp4", "kind b": row("claude.mcp.attach.kind.video") }),
  );
  assert.equal(ATTACH_WORDS.pairSame, row("claude.mcp.attach.pair.same"));
  assert.equal(ATTACH_WORDS.empty, row("claude.mcp.attach.empty"));
  assert.equal(ATTACH_WORDS.ratioUnknown, row("claude.mcp.attach.ratio_unknown"));
  assert.equal(ATTACH_WORDS.pickerReason("a.mp4", "Over 200 MB"), row("claude.mcp.attach.picker_reason", { name: "a.mp4", reason: "Over 200 MB" }));
  assert.equal(ATTACH_WORDS.failed, row("claude.mcp.attach.failed"));
  assert.equal(ATTACH_WORDS.waiting, row("claude.mcp.attach.waiting"));
  assert.equal(ATTACH_WORDS.pairsOff, row("claude.mcp.attach.pairs_off"));
  // The attach refusals (MW2's rules, 25 Nov): another client's folders, named or not, and an owner that can't be told.
  assert.equal(ATTACH_WORDS.otherClient("a.mp4", "Electric"), row("claude.mcp.attach.other_client", { name: "a.mp4", client: "Electric" }));
  assert.equal(ATTACH_WORDS.otherClientUnnamed("a.mp4"), row("claude.mcp.attach.other_client.unnamed", { name: "a.mp4" }));
  assert.equal(ATTACH_WORDS.ownerUnknown("a.mp4"), row("claude.mcp.attach.owner_unknown", { name: "a.mp4" }));
});
