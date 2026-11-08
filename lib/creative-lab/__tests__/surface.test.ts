import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { profile } from "../../../src/remotion/caption-style/profile.ts";

import {
  adPairingName,
  candidateTileState,
  cropWindowBox,
  renderRowWord,
  cantRunReason,
  CAPTION_BOX_WIDTH_PCT,
  captionBoxInsets,
  captionCopy,
  clipStripLines,
  clipStripState,
  clipWindow,
  clipsForEachNew,
  currentRenderError,
  failedCheckSentence,
  feedHeadline,
  captionPreviewClip,
  feedPostClip,
  generateButtonLabel,
  firstPairings,
  groupClips,
  money,
  playableClipSeconds,
  postAge,
  posterTime,
  rankCandidates,
  resultsLabel,
  roundHasRun,
  roundMatrix,
  roundStripState,
  scrubWindow,
  verdictChip,
  whatsWorking,
  type ClipForGroup,
  type WorkingAd,
} from "../surface.ts";

const LUKE: ClipForGroup = {
  id: "luke-clip",
  artistName: "Luke Dean",
  clipNo: 1,
  cleared: false,
  renderError: null,
  judged: null,
};

describe("creative lab surface", () => {
  it("puts a superseded or long clip in New, and a refused render in Can't run", () => {
    const enzo: ClipForGroup = { id: "enzo-1", artistId: "enzo", artistName: "Enzo Siragusa", clipNo: 1, cleared: true, renderError: null, judged: null };
    const kept: ClipForGroup = {
      id: "enzo-2",
      artistId: "enzo",
      artistName: "Enzo Siragusa",
      clipNo: 2,
      cleared: true,
      renderError: null,
      judged: { verdict: "winner", cost: 0.42, results: 812, metric: "complete_registration", roundNo: 1 },
    };
    const refused: ClipForGroup = {
      id: "enzo-bad",
      artistId: "enzo",
      artistName: "Enzo Siragusa",
      clipNo: 5,
      cleared: true,
      renderError: "video renders are 9:16 only",
      judged: null,
    };
    const history: ClipForGroup = { id: "luke-old", artistId: "luke", artistName: "Luke Dean", clipNo: 1, cleared: false, renderError: "superseded: 9:16 only", judged: null };
    const long: ClipForGroup = { id: "long", artistId: "luke", artistName: "Luke Dean", clipNo: 3, cleared: false, renderError: null, durationSeconds: 45, judged: null };
    const groups = groupClips([kept, enzo, LUKE, history, refused, long]);
    assert.deepEqual(groups.keeping.map((clip) => clip.id), ["enzo-2"]);
    assert.deepEqual(groups.fresh.map((clip) => clip.id), ["enzo-1", "luke-clip", "luke-old", "long"]);
    assert.deepEqual(groups.cant.map((clip) => clip.id), ["enzo-bad"]);
    assert.equal(cantRunReason(history), null);
    assert.equal(cantRunReason(long), null);
    assert.equal(cantRunReason(refused), "This clip isn't vertical — use a 9:16 file.");
    assert.equal(cantRunReason(refused)?.includes("9:16 only"), false);
    assert.equal(playableClipSeconds({ fileSeconds: 45, inS: null, outS: null }), 30);
    assert.equal(playableClipSeconds({ fileSeconds: 45, inS: 0, outS: 30 }), 30);
    assert.equal(playableClipSeconds({ fileSeconds: 12, inS: null, outS: null }), 12);
    assert.deepEqual(clipWindow({ fileSeconds: 34.06, inS: null, outS: null }), { inS: 0, outS: 30 });
    assert.deepEqual(clipWindow({ fileSeconds: 34.06, inS: 2, outS: 12 }), { inS: 2, outS: 12 });
    assert.equal(currentRenderError([
      { status: "failed", error: "superseded: 9:16 only", createdAt: "2026-11-06T12:00:00Z" },
      { status: "done", error: null, createdAt: "2026-11-05T12:00:00Z" },
    ]), null);
    const lukeLandscape = { ...LUKE, artistId: "luke", sourceWidth: 956, sourceHeight: 718, billingOrder: 1, isHeadliner: true };
    const enzoVertical = { ...enzo, sourceWidth: 1080, sourceHeight: 1920, billingOrder: 0, isHeadliner: true };
    const tinyVertical = { ...enzo, id: "tiny", sourceWidth: 480, sourceHeight: 854, billingOrder: 0, isHeadliner: true };
    const widerCrop = { ...enzo, id: "square", sourceWidth: 1080, sourceHeight: 1080, billingOrder: 0, isHeadliner: true };
    const laterTwin = { ...enzoVertical, id: "later", billingOrder: 3 };
    assert.equal(feedPostClip([refused, long, lukeLandscape, enzoVertical])?.id, "enzo-1");
    assert.equal(feedPostClip([widerCrop, { ...enzoVertical, id: "enzo-720", sourceWidth: 720, sourceHeight: 1280, billingOrder: 2 }])?.id, "enzo-720");
    assert.equal(feedPostClip([laterTwin, enzoVertical])?.id, "enzo-1");
    assert.equal(feedPostClip([lukeLandscape, tinyVertical]), null);
    assert.equal(feedPostClip([refused]), null);
    assert.equal(captionPreviewClip([enzoVertical, lukeLandscape], "missing"), null);
    assert.equal(captionPreviewClip([enzoVertical, lukeLandscape], "enzo-1")?.id, "enzo-1");
    assert.equal(captionPreviewClip([enzoVertical, lukeLandscape], null)?.id, "enzo-1");
    assert.equal(generateButtonLabel(false, 3), "Write 3");
    assert.equal(generateButtonLabel(true, 3), "Writing…");
    assert.equal(feedHeadline({ eventName: "Puzzle 4th Birthday", eventDate: "2026-12-27", venue: "Circuit & Engine Rooms" }), "Puzzle 4th Birthday · 27 December · Circuit & Engine Rooms");
    assert.deepEqual(clipStripLines(1), { line: "1 blocked", short: "1 blocked" });
    assert.deepEqual(clipStripLines(0), { line: "ready", short: "ready" });
  });

  it("renders caption lines as breaks and never a slash", () => {
    const copy = captionCopy(["POV: Enzo Siragusa on one bill / 27 December at Circuit", "Tag who you're bringing"]);
    assert.match(copy, /bill\n27 December/);
    assert.match(copy, /Circuit\nTag who/);
    assert.equal(copy.includes("/"), false);
  });

  it("turns a failed check into one sentence and draws nothing when it passed", () => {
    assert.equal(failedCheckSentence(true, ["Needs an artist and a city they've played."]), null);
    assert.equal(
      failedCheckSentence(false, ["Needs an artist and a city they've played.", "A second problem."]),
      "Needs an artist and a city they've played.",
    );
  });

  it("counts the round matrix after cells are turned off", () => {
    const matrix = roundMatrix({
      clips: [{ id: "c1" }, { id: "c2" }, { id: "c3" }],
      captions: [{ id: "a" }, { id: "b" }],
      excluded: new Set(["c3:b"]),
    });
    assert.equal(matrix.cells.length, 6);
    assert.equal(matrix.on, 5);
    assert.equal(matrix.off, 1);
    assert.equal(matrix.line, "5 ads · 3 × 2, 1 left out");
    const narrow = firstPairings(matrix.cells);
    assert.equal(narrow.shown.length, 3);
    assert.equal(narrow.more, 3);
  });

  it("hides what's working until a verdict exists, then compares angles", () => {
    assert.equal(whatsWorking([], { clientName: "Puzzle", eventId: "evt" }), null);
    const quiet: WorkingAd[] = [{
      style: "lineup",
      roundId: "r1",
      eventId: "evt",
      verdict: null,
      cost: 0.4,
      results: 10,
      clipNo: 1,
      artistName: "Enzo Siragusa",
      roundNo: 1,
    }];
    assert.equal(whatsWorking(quiet, { clientName: "Puzzle", eventId: "evt" }), null);
    const ads: WorkingAd[] = [
      { style: "lineup", roundId: "r1", eventId: "evt", verdict: "winner", cost: 0.44, results: 1020, clipNo: 2, artistName: "Enzo Siragusa", roundNo: 1 },
      { style: "pov", roundId: "r1", eventId: "evt", verdict: "loser", cost: 0.64, results: 136, clipNo: 4, artistName: "Enzo Siragusa", roundNo: 1 },
    ];
    const working = whatsWorking(ads, { clientName: "Puzzle", eventId: "evt" });
    assert.equal(working?.angle, "Lineup captions beat POV by 31% on Puzzle");
    assert.equal(working?.clip, "Enzo Siragusa clip #2 is the current winner");
  });

  it("maps stored verdicts onto the chips", () => {
    assert.equal(verdictChip("winner").label, "Winner");
    assert.equal(verdictChip("loser").label, "Loser");
    assert.equal(verdictChip("flagged").label, "cost 1.5× the usual");
    assert.equal(verdictChip(null).label, "Holding");
    assert.equal(verdictChip("thin").label, "Untested");
    assert.equal(verdictChip("untested").label, "Untested");
    assert.equal(money(null), "—");
    assert.equal(money(0), "—");
    assert.equal(money(0.42), "£0.42");
  });

  it("names the Clips and Round cells in long and short forms of one state", () => {
    assert.deepEqual(clipStripState(0, 0), { line: "none yet", short: "none" });
    assert.deepEqual(clipStripState(3, 0), { line: "ready", short: "ready" });
    assert.deepEqual(roundStripState(undefined), { line: "not started", short: "none" });
    assert.deepEqual(roundStripState("draft"), { line: "draft", short: "draft" });
    assert.deepEqual(roundStripState("judged"), { line: "judged", short: "judged" });
    for (const status of [undefined, "draft", "approved", "launched", "judged"]) {
      assert.notEqual(roundStripState(status).short, "open");
    }
  });

  it("gives tile numbers a unit and names pairings by artist, clip and angle", () => {
    assert.equal(resultsLabel(40, "complete_registration"), "40 signups");
    assert.equal(resultsLabel(1, "complete_registration"), "1 signup");
    assert.equal(adPairingName({ artistName: "Ada North", clipNo: 1 }, "pov"), "Ada North #1 × POV");
  });

  it("only launched or judged rounds have run", () => {
    assert.equal(roundHasRun("draft"), false);
    assert.equal(roundHasRun("approved"), false);
    assert.equal(roundHasRun("launched"), true);
    assert.equal(roundHasRun("judged"), true);
  });

  it("scrubs in_s to the out point or the file's end, 30 s at most", () => {
    assert.deepEqual(scrubWindow(0, null, 18), { start: 0, end: 18 });
    assert.deepEqual(scrubWindow(0, null, 95), { start: 0, end: 30 });
    assert.deepEqual(scrubWindow(5, 12, 95), { start: 5, end: 12 });
    assert.deepEqual(scrubWindow(10, null, 95), { start: 10, end: 40 });
    assert.deepEqual(scrubWindow(0, null, null), { start: 0, end: null });
    assert.equal(posterTime(0, null), 0.5);
    assert.equal(posterTime(4, 9), 4);
  });

  it("candidate tiles: rank, age, one action or one status line", () => {
    const rows = rankCandidates([
      { igMediaId: "b", postedAt: "2026-10-21", likes: 1, comments: 0, score: 0.6, aspect: "4:5", hasFile: false, status: "skipped", reason: "text overlay" },
      { igMediaId: "a", postedAt: "2026-10-29", likes: 1, comments: 0, score: 0.9, aspect: "9:16", hasFile: false, status: "candidate" },
    ]);
    assert.deepEqual(rows.map((row) => [row.igMediaId, row.rank]), [["a", 1], ["b", 2]]);
    assert.equal(postAge("2026-10-29", "2026-11-06T12:00:00Z"), "8 days ago");
    assert.equal(postAge("2026-11-05", "2026-11-06T12:00:00Z"), "1 day ago");
    assert.equal(postAge("2026-10-12", "2026-11-06T12:00:00Z"), "4 weeks ago");
    assert.deepEqual(candidateTileState(rows[0]!), { action: "request", status: null, see: false });
    assert.deepEqual(candidateTileState({ ...rows[0]!, hasFile: true }), { action: "add", status: null, see: false });
    assert.deepEqual(candidateTileState({ ...rows[1]!, overlay: { verdict: "text_overlay", flagged: 3 } }), { action: null, status: "Skipped — text in 3 of 8 frames", see: true });
    assert.deepEqual(candidateTileState({ ...rows[0]!, status: "requested" }), { action: null, status: "Requested", see: false });
    assert.deepEqual(
      candidateTileState({ ...rows[0]!, overlay: { verdict: "check_by_eye", flagged: 0 } }),
      { action: "import", status: "Couldn't check for text — look before you import", see: false },
    );
  });

  it("puts the 9:16 window at the focus point and still names a render with no estimate", () => {
    const box = cropWindowBox(0.5, 1920, 1080);
    assert.equal(box.label, "16:9 → 9:16");
    assert.ok(Math.abs(box.width - (9 / 16) / (16 / 9)) < 1e-9);
    assert.ok(Math.abs(box.left - (1 - box.width) * 0.5) < 1e-9);
    assert.equal(box.top, 0);
    assert.equal(box.height, 1);
    const rendering = { id: "a", status: "rendering", renderMs: null, updatedAt: "", error: null };
    assert.equal(renderRowWord(rendering, [rendering], "2026-11-06T12:00:00.000Z"), "rendering");
    const queued = { id: "b", status: "queued", renderMs: null, updatedAt: "", error: null };
    assert.equal(renderRowWord(queued, [rendering, queued], "2026-11-06T12:00:00.000Z"), "queued · 2nd");
  });

  it("builds the caption box from the profile's centre, so a profile change moves the preview with the render", () => {
    assert.deepEqual(captionBoxInsets(0.493), { left: 7.3, right: 8.7 });
    assert.deepEqual(captionBoxInsets(profile.horizontalCenterPctOfWidth), { left: 7.3, right: 8.7 });
    assert.deepEqual(captionBoxInsets(0.5), { left: 8, right: 8 });
    const moved = captionBoxInsets(0.52);
    assert.deepEqual(moved, { left: 10, right: 6 });
    assert.equal(Math.round((100 - moved.left - moved.right) * 1000) / 1000, CAPTION_BOX_WIDTH_PCT);
    const overlay = readFileSync(new URL("../../../components/dashboard/events/creative-lab/caption-overlay.tsx", import.meta.url), "utf8");
    assert.match(overlay, /captionBoxInsets\(profile\.horizontalCenterPctOfWidth\)/);
    assert.equal((overlay.match(/left: `\$\{box\.left\}%`/g) ?? []).length, 2, "text box and compact marker both use the profile box");
    assert.doesNotMatch(overlay, /(left|right)-\[\d+%\]/, "no typed insets");
    const lambda = readFileSync(new URL("../../../src/remotion/caption-style/profile.ts", import.meta.url), "utf8");
    assert.match(lambda, /profile\.horizontalCenterPctOfWidth/);
  });

  it("gives every usable Untested clip one preview and leaves a clip over 30s out", () => {
    const fresh = (id: string, clipNo: number, seconds: number | null, verdict: string | null): ClipForGroup => ({
      id,
      artistName: "Enzo Siragusa",
      clipNo,
      cleared: true,
      renderError: null,
      durationSeconds: seconds,
      judged: verdict == null ? null : { verdict, cost: null, results: null, metric: null, roundNo: 1 },
    });
    const imported = playableClipSeconds({ fileSeconds: 31.625, inS: null, outS: null });
    assert.equal(imported, 30);
    const clips = [
      fresh("c1", 1, 21.7, null),
      fresh("c4", 4, 21.7, "untested"),
      fresh("c5", 5, imported, "untested"),
      fresh("over", 7, 31.625, "untested"),
      fresh("win", 2, 21.7, "winner"),
      { ...fresh("bad", 6, 12, null), renderError: "video renders are 9:16 only" },
    ];
    assert.deepEqual(clipsForEachNew(clips, new Set()).map((clip) => clip.id), ["c1", "c4", "c5"]);
    assert.deepEqual(clipsForEachNew(clips, new Set(["c1"])).map((clip) => clip.id), ["c4", "c5"]);
    assert.deepEqual(clipsForEachNew(clips, new Set(["c1", "c4", "c5"])).map((clip) => clip.id), []);
  });
});
