import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const ui = readFileSync("components/library/adset-audience-push.tsx", "utf8");

function between(start: string, end: string): string {
  const from = ui.indexOf(start);
  const to = ui.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing ${start} .. ${end}`);
  return ui.slice(from, to);
}

describe("ad set audience push applies on one click", () => {
  it("posts commit true from the only request and does not plan", () => {
    const fetches = ui.match(/fetch\(\s*"\/api\/meta\/adset-audience"/g) ?? [];
    assert.equal(fetches.length, 1);
    assert.equal((ui.match(/commit:\s*true/g) ?? []).length, 1);
    assert.equal(ui.includes("commit: false"), false);
    assert.equal(ui.includes("Show diff"), false);
    assert.equal(ui.includes("planAdSetAudienceChanges"), false);
    assert.equal(ui.includes("setPreview"), false);
  });

  it("keeps the learning-phase sentence under Apply", () => {
    const applyButton = between('disabled={!canWrite || !audience', "{LEARNING_PHASE_WARNING}");
    assert.match(applyButton, /"Apply"/);
    assert.equal(applyButton.includes("preview"), false);
    assert.equal(applyButton.includes("applied"), false);
    assert.equal(ui.includes("<details"), false);
  });

  it("renders each outcome kind with its reason and diff", () => {
    assert.match(ui, /outcome: "written" \| "noop" \| "refused" \| "failed"/);
    const row = between("{applied.map((row) =>", "</ul>");
    assert.match(row, /\{row\.outcome\}/);
    assert.match(row, /\{row\.reason/);
    assert.match(row, /\{row\.diff/);
    assert.equal(row.includes("<details"), false);
    assert.equal(row.includes("hidden"), false);
  });

  it("removes the same audience from that written ad set only", () => {
    const row = between('row.outcome === "written"', "Removing…");
    assert.match(row, /row\.appliedAction === "add"/);
    assert.match(row, /audienceId: row\.audienceId/);
    assert.match(row, /direction: row\.direction/);
    assert.match(row, /void apply\(/);
    assert.match(row, /action: "remove"/);
    assert.match(row, /adSetIds: \[row\.adSetId\]/);
    assert.equal(row.includes("selected.map"), false);
    assert.equal(row.includes("commit: false"), false);
    const applyBody = between("async function apply", "return (");
    assert.match(applyBody, /commit: true/);
  });

  it("disables the control when the gate is off and returns before fetch", () => {
    assert.match(ui, /disabled=\{!canWrite\}/);
    assert.match(ui, /ADSET_TARGETING_WRITES_DISABLED_MESSAGE/);
    assert.match(ui, /writesEnabled === false/);
    const applyFn = ui.indexOf("async function apply");
    const fetchAt = ui.indexOf('fetch("/api/meta/adset-audience"');
    const guard = ui.indexOf("if (!canWrite) return", applyFn);
    assert.ok(applyFn > 0 && guard > applyFn && guard < fetchAt);
    assert.match(ui, /disabled=\{!canWrite \|\| !audience/);
  });
});
