import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { ServiceRoleDb } from "../load.ts";
import { saveClipSelection } from "../selection-store.ts";
import {
  bestOfSelected,
  captionsNote,
  CLIPS_NOTE,
  clipSelectionStrip,
  effectiveSelection,
  eachPreviewClips,
  eachPreviewLine,
  newUnselectedCount,
  noSelectedClipsSentence,
  notSelectedNames,
  OFF_CARD_CLIP,
  previewPlate,
  renderPairs,
  selectionAfterAll,
  selectionAfterNone,
  selectionAfterToggle,
  spreadClipIds,
  winnerNotSelected,
  type ClipSelection,
} from "../selection.ts";
import { roundMatrix } from "../surface.ts";
import { fakeDb } from "./fake-db.ts";

type Clip = {
  id: string;
  artistName: string;
  clipNo: number;
  cleared: boolean;
  renderError: string | null;
  durationSeconds: number | null;
  judged: { verdict: string | null; cost: number | null; results: number | null; metric: string | null; roundNo: number } | null;
};

function clip(id: string, clipNo: number, extra: Partial<Clip> = {}): Clip {
  return {
    id,
    artistName: "Enzo Siragusa",
    clipNo,
    cleared: true,
    renderError: null,
    durationSeconds: 18,
    judged: null,
    ...extra,
  };
}

const nine = [1, 2, 3, 4, 5, 6, 7].map((n) => clip(`e${n}`, n));

describe("clip selection", () => {
  it("starts with every usable clip selected, and a can't-run clip is not in the count", () => {
    const cant = clip("benji", 1, { artistName: "Benji King", renderError: "Too low after the crop — 540 px wide" });
    const clips = [...nine, cant];
    const selected = effectiveSelection({ mode: "all", rows: [] }, clips);
    assert.deepEqual(selected.map((row) => row.id), nine.map((row) => row.id));
    assert.equal(clipSelectionStrip("all", 9, 1, 9).line, "1 blocked");
    assert.equal(clipSelectionStrip("all", 9, 0, 9).line, "ready");
  });

  it("persists select all, none, and a subset", async () => {
    const ids = nine.map((row) => row.id);
    const subset = selectionAfterToggle({ mode: "all", rows: [] }, ids, "e3");
    assert.equal(subset.mode, "chosen");
    assert.equal(subset.rows.find((row) => row.clipId === "e3")?.selected, false);
    assert.equal(subset.rows.filter((row) => row.selected).length, 6);
    assert.deepEqual(selectionAfterAll(), { mode: "all", rows: [] });
    const none = selectionAfterNone(ids);
    assert.equal(none.rows.every((row) => !row.selected), true);
    assert.equal(effectiveSelection(none, nine).length, 0);
    assert.equal(newUnselectedCount(subset, [...ids, "e8"]), 1);

    const fake = fakeDb({ events: [{ id: "event-1", clip_selection_mode: "all" }], creative_lab_clip_selections: [] });
    await saveClipSelection(fake as unknown as ServiceRoleDb, { userId: "op", eventId: "event-1", selection: subset });
    assert.equal(fake.tables.events[0]?.clip_selection_mode, "chosen");
    assert.equal(fake.tables.creative_lab_clip_selections.length, 7);
    await saveClipSelection(fake as unknown as ServiceRoleDb, { userId: "op", eventId: "event-1", selection: selectionAfterAll() });
    assert.equal(fake.tables.events[0]?.clip_selection_mode, "all");
  });

  it("spreads captions across the selected clips and picks the cheapest selected clip", () => {
    assert.deepEqual(spreadClipIds(3, ["e1", "e2", "e5", "e7"]), ["e1", "e2", "e5"]);
    const priced = [
      clip("e1", 1, { judged: { verdict: "winner", cost: 4, results: 10, metric: "purchase", roundNo: 1 } }),
      clip("e2", 2, { judged: { verdict: "winner", cost: 1.5, results: 10, metric: "purchase", roundNo: 1 } }),
    ];
    assert.equal(bestOfSelected(priced)?.id, "e2");
    assert.equal(bestOfSelected([clip("e1", 1), clip("e5", 5)])?.id, "e1");
    assert.equal(eachPreviewLine(3, 4), "3 captions × 4 clips = 12 previews");
    const four = ["e1", "e2", "e5", "e7"].map((id) => ({ id }));
    assert.equal(eachPreviewLine(3, eachPreviewClips(four).length), "3 captions × 4 clips = 12 previews");
    assert.equal(eachPreviewLine(3, eachPreviewClips(four, new Set(["e7"])).length), "3 captions × 3 clips = 9 previews");
  });

  it("narrows the matrix to the selection and still knocks a pairing out", () => {
    const chosen: ClipSelection = {
      mode: "chosen",
      rows: ["e1", "e2", "e5", "e7"].map((clipId) => ({ clipId, selected: true })),
    };
    const rows = effectiveSelection(chosen, nine);
    const matrix = roundMatrix({
      clips: rows,
      captions: [{ id: "a" }, { id: "b" }, { id: "c" }],
      excluded: new Set(["e2:c"]),
    });
    assert.equal(matrix.cells.some((cell) => cell.clipId === "e3"), false);
    assert.equal(matrix.on, 11);
    assert.equal(matrix.off, 1);
    assert.equal(renderPairs(matrix.cells).length, 11);
    assert.equal(renderPairs(matrix.cells).some((cell) => cell.clipId === "e2" && cell.captionId === "c"), false);
    assert.equal(notSelectedNames(["Enzo #3", "Enzo #4", "Enzo #6"]), "Not selected: Enzo #3, Enzo #4, Enzo #6 · change on Clips");
    assert.equal(winnerNotSelected("Enzo #2", 1), "Enzo #2, round 1's winner, is not selected");
    assert.equal(noSelectedClipsSentence(1), "Select at least 1 clip to propose round 1.");
  });

  it("says when a preview's clip is gone, and when nothing is selected", () => {
    assert.equal(previewPlate("missing", [{ id: "e1" }], 1), "missing");
    assert.equal(previewPlate(null, [{ id: "e1" }], 0), "none");
    assert.equal(previewPlate(null, [{ id: "e1" }], 1), "clip");
    assert.equal(OFF_CARD_CLIP, "This preview's clip isn't on the event any more — write it again on a clip that is.");
    assert.equal(CLIPS_NOTE, "Selected clips become ads when a round pairs them with an approved caption");
    assert.equal(captionsNote(1), "✓ a caption, then Propose round 1 renders it on the selected clips");
    assert.equal(clipSelectionStrip("chosen", 4, 1, 9).line, "4 selected");
  });

  it("wires the artist picker and the off-card sentence into the generator", () => {
    const source = readFileSync(new URL("../../../components/dashboard/events/creative-lab/captions.tsx", import.meta.url), "utf8");
    assert.match(source, /angle === "artist_first_person"/);
    assert.match(source, /Artist/);
    assert.match(source, /✓ artist channels/);
    assert.match(source, /Promoter page only/);
    assert.match(source, /bg-foreground text-background/);
    assert.match(source, /OFF_CARD_CLIP/);
    assert.match(source, /Each selected/);
    assert.match(source, /eachPreviewClips\(selected\)/);
    assert.match(source, /eachPreviewLine\(crossed\.length, plates\.length\)/);
    assert.match(source, /actions=\{index === 0\}/);
    assert.match(source, /writtenCaptionIds/);
    const clips = readFileSync(new URL("../../../components/dashboard/events/creative-lab/clips.tsx", import.meta.url), "utf8");
    assert.match(clips, /disabled=\{finding \|\| findable\.length === 0\}/);
    assert.match(clips, /text-on-media/);
    assert.match(clips, /border-on-media/);
    assert.equal(clips.includes("#ffffff"), false);
    const css = readFileSync(new URL("../../../app/globals.css", import.meta.url), "utf8");
    const reset = css.indexOf("* {\n  border-color: var(--border);");
    const ring = css.indexOf(".border-on-media {\n  border-color: var(--on-media);");
    assert.ok(reset !== -1 && ring > reset);
    const round = readFileSync(new URL("../../../components/dashboard/events/creative-lab/round.tsx", import.meta.url), "utf8");
    assert.match(round, /renderPairs\(matrix\.cells\)/);
    assert.match(round, /href="#lab-clips"/);
  });
});

