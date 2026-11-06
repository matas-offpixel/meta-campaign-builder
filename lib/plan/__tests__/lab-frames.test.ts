import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { isPublicPath } from "../../auth/public-routes.ts";
import { LAB_FRAME_IDS, LAB_FRAME_WIDTHS } from "../../../scripts/plan-frames/lab-ids.ts";
import { LAB_CLIP_169, LAB_CLIP_916, LAB_FRAME_FIXTURES, getLabFrame } from "../../../scripts/plan-frames/lab-fixtures.ts";
import { LAB_FRAME_IDS as SHOT_IDS, LAB_SHOTS, LAB_WIDTHS } from "../../../scripts/plan-frames/lab-shots.mjs";
import { evidenceIndex } from "../../../scripts/plan-frames/evidence.mjs";
import { changedBaselines, guardLine } from "../../../scripts/ci/design-pass-guard.mjs";
import { roundMatrix } from "../../creative-lab/surface.ts";

describe("Creative Lab frame catalog (CL)", () => {
  it("the runner shoots every CL id at 1280 and 393", () => {
    assert.deepEqual([...SHOT_IDS], [...LAB_FRAME_IDS]);
    assert.deepEqual([...LAB_WIDTHS], [...LAB_FRAME_WIDTHS]);
    assert.equal(LAB_SHOTS.length, 14);
    assert.ok(LAB_SHOTS.every((shot: { id: string; frame: string; width: number }) => shot.id === `${shot.frame}-${shot.width}`));
  });

  it("every id has a lab fixture with launches off", () => {
    for (const id of LAB_FRAME_IDS) {
      const fixture = getLabFrame(id);
      assert.ok(fixture, id);
      assert.equal(fixture.id, id);
      assert.equal(fixture.kind, "lab");
      assert.equal(fixture.lab.launchesEnabled, false, id);
    }
  });

  it("fixtures reach no network: every clip is a committed local file", () => {
    for (const fixture of Object.values(LAB_FRAME_FIXTURES)) {
      for (const clip of fixture.lab.clips) {
        assert.ok(clip.previewUrl === LAB_CLIP_916 || clip.previewUrl === LAB_CLIP_169, clip.id);
      }
      const text = JSON.stringify(fixture.lab);
      assert.doesNotMatch(text, /https?:\/\//, fixture.id);
    }
    for (const url of [LAB_CLIP_916, LAB_CLIP_169]) {
      assert.ok(existsSync(new URL(`../../../public${url}`, import.meta.url)), url);
      assert.equal(isPublicPath(url), true, url);
    }
  });

  it("CL1 is an empty event; CL2 is 5 artists, 3 starred, 1 cleared", () => {
    assert.equal(LAB_FRAME_FIXTURES.CL1.lab.lineupRows.length, 0);
    const rows = LAB_FRAME_FIXTURES.CL2.lab.lineupRows;
    assert.equal(rows.length, 5);
    assert.equal(rows.filter((row) => row.isHeadliner).length, 3);
    assert.equal(rows.filter((row) => row.clearedAt).length, 1);
    const artists = LAB_FRAME_FIXTURES.CL2.lab.artists;
    assert.deepEqual(artists.map((artist) => artist.rights), ["approved", "missing"]);
  });

  it("CL3 has primary text; CL4 has none", () => {
    assert.ok(LAB_FRAME_FIXTURES.CL3.lab.captions[0]!.primaryText.trim());
    assert.equal(LAB_FRAME_FIXTURES.CL4.lab.captions[0]!.primaryText, "");
  });

  it("CL5 is 2 captions × 3 clips; with one off, 5 are on and the draft holds 5", () => {
    const lab = LAB_FRAME_FIXTURES.CL5.lab;
    const captions = lab.captions.filter((caption) => caption.status === "approved");
    assert.equal(captions.length, 2);
    assert.equal(lab.clips.length, 3);
    const off = new Set([`${lab.clips[0]!.id}:${captions[1]!.id}`]);
    const matrix = roundMatrix({ clips: lab.clips, captions, excluded: off });
    assert.equal(matrix.on, 5);
    assert.equal(matrix.off, 1);
    assert.equal(lab.rounds[0]!.ads.length, 5);
  });

  it("CL6 numbers: £0.50 × 40 = £20, £0.75 × 20 = £15, POV 1.5× Lineup, Lineup beats POV by 33%", () => {
    const lab = LAB_FRAME_FIXTURES.CL6.lab;
    const [win, flag] = lab.rounds[0]!.ads;
    assert.equal(win!.cost! * win!.results!, 20);
    assert.equal(flag!.cost! * flag!.results!, 15);
    assert.equal(flag!.cost! / win!.cost!, 1.5);
    assert.equal(lab.working?.angle, "Lineup captions beat POV by 33% on Off Pixel Fixtures");
    assert.equal(lab.working?.clip, "Ada North clip #1 is the current winner");
  });

  it("CL7 has three ranked candidates: one to request, one skipped, one requested", () => {
    const candidates = LAB_FRAME_FIXTURES.CL7.lab.artists[0]!.igCandidates;
    assert.deepEqual(candidates.map((row) => row.status), ["candidate", "skipped", "requested"]);
    const scores = candidates.map((row) => row.score ?? 0);
    assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  });

  it("the frames page mounts lab fixtures", () => {
    const page = readFileSync(new URL("../../../app/(dev)/frames/[id]/page.tsx", import.meta.url), "utf8");
    assert.match(page, /LAB_FRAME_IDS/);
    assert.match(page, /getLabFrame/);
  });
});

describe("frames evidence index", () => {
  it("maps each shot to its frame and width, and points at the diff files", () => {
    const index = evidenceIndex(
      [
        { id: "CL1-393", frame: "CL1", width: 393, shot: "shots/CL1-393.png", status: "ok", diffPct: null, diff: null },
        {
          id: "CL5-1280",
          frame: "CL5",
          width: 1280,
          shot: "shots/CL5-1280.png",
          status: "diff",
          diffPct: 1.25,
          diff: { dir: "diff/CL5-1280", expected: "1280×3769", actual: "1280×3769", hasDiffImage: true },
        },
      ],
      { tolerance: 0.002, sha: "abc" },
    );
    assert.equal(index.json.shots[0]!.frame, "CL1");
    assert.equal(index.json.shots[1]!.diff!.diff, "diff/CL5-1280/diff.png");
    assert.match(index.markdown, /\| `shots\/CL5-1280\.png` \| CL5 \| 1280 \| over tolerance 1\.25% — `diff\/CL5-1280\/` \|/);
    assert.match(index.markdown, /2 shots, 1 over the 0\.2% tolerance/);
  });
});

describe("design-pass guard", () => {
  it("counts committed baselines only", () => {
    assert.deepEqual(changedBaselines(["docs/frames/CL1-393.png", "docs/frames/local/CL1-393.png", "docs/frames/README.md", "app/x.png"]), ["docs/frames/CL1-393.png"]);
  });

  it("fails a baseline change without the label and passes it with the label", () => {
    const files = ["docs/frames/CL1-393.png", "scripts/plan-frames/run.mjs"];
    assert.equal(guardLine({ files, labels: [] }).ok, false);
    assert.match(guardLine({ files, labels: [] }).line, /docs\/frames\/CL1-393\.png/);
    assert.equal(guardLine({ files, labels: ["design-pass"] }).ok, true);
    assert.equal(guardLine({ files: ["scripts/plan-frames/run.mjs"], labels: [] }).ok, true);
  });
});
