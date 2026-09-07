import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  applyShot,
  classifyShot,
  foldShots,
  missingBaselineLine,
} from "../../../scripts/plan-frames/baseline.mjs";

const PNG = Buffer.from("png");

describe("frames baseline check vs write", () => {
  it("check mode fails a missing PNG, prints MISSING, and does not write", async () => {
    const dir = mkdtempSync(join(tmpdir(), "frames-check-"));
    const dest = join(dir, "A0.png");
    const result = await applyShot({ dest, png: PNG, update: false, id: "A0" });
    assert.equal(classifyShot({ destExists: false, update: false }), "missing");
    assert.equal(result.failed, true);
    assert.equal(result.wrote, false);
    assert.equal(
      result.line,
      "MISSING A0 — no baseline committed; run frames-baselines.yml and commit docs/frames/A0.png",
    );
    assert.equal(missingBaselineLine("A0"), result.line);
    assert.equal(existsSync(dest), false);
    assert.equal(foldShots([result]).exitCode, 1);
  });

  it("UPDATE writes a missing PNG and exits zero", async () => {
    const dir = mkdtempSync(join(tmpdir(), "frames-update-"));
    const dest = join(dir, "A0.png");
    const result = await applyShot({ dest, png: PNG, update: true, id: "A0" });
    assert.equal(classifyShot({ destExists: false, update: true }), "write");
    assert.equal(result.failed, false);
    assert.equal(result.wrote, true);
    assert.equal(existsSync(dest), true);
    assert.deepEqual(readFileSync(dest), PNG);
    assert.equal(foldShots([result]).exitCode, 0);
  });

  it("one check run reports every missing baseline, not just the first", async () => {
    const dir = mkdtempSync(join(tmpdir(), "frames-many-"));
    const results = [];
    for (const id of ["A0", "Z9"]) {
      results.push(
        await applyShot({
          dest: join(dir, `${id}.png`),
          png: PNG,
          update: false,
          id,
        }),
      );
    }
    assert.equal(results[0].line, missingBaselineLine("A0"));
    assert.equal(results[1].line, missingBaselineLine("Z9"));
    assert.equal(foldShots(results).exitCode, 1);
    assert.equal(existsSync(join(dir, "A0.png")), false);
    assert.equal(existsSync(join(dir, "Z9.png")), false);
  });

  it("the runner uses classifyShot and never auto-writes on a miss", () => {
    const runner = readFileSync("scripts/plan-frames/run.mjs", "utf8");
    assert.match(runner, /classifyShot/);
    assert.match(runner, /missingBaselineLine/);
    assert.doesNotMatch(runner, /UPDATE \|\| !existsSync/);
  });
});
