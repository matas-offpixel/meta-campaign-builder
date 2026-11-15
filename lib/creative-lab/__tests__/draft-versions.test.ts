import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { WATERMARK, fixtureRelease as r, type WarningRow } from "../claim-approval.ts";
import { draftVersions, releaseFromRow } from "../draft-versions.ts";

/** Puzzle 4th Birthday's tiers on 10 Nov. */
const puzzle = [r(1, "Early bird", "sold_out"), r(2, "1st release", "sold_out"), r(3, "2nd release", "sold_out"), r(4, "3rd release", "selling_fast")];
const CLAIM = "EARLY BIRD, 1ST & 2ND RELEASE SOLD OUT\n3RD RELEASE SELLING FAST";
const row = (o: Partial<WarningRow>): WarningRow => ({ id: "w1", claim: CLAIM, format: "9:16", state: "held", approved_by: null, approved_at: null, runs_from: null, runs_to: null, ...o });

describe("Puzzle's draft rounds carry two versions (Matas, 10 Nov)", () => {
  it("exactly two: no CTA, then the selling-fast roll-call from the live tiers", () => {
    const v = draftVersions(puzzle, []);
    assert.deepEqual(v.map((x) => x.id), ["v1-no-cta", "v2-roll-call"]);
    assert.equal(v[0]!.claim, null);
    assert.equal(v[0]!.watermark, null);
    assert.equal(v[1]!.claim, CLAIM);
  });

  it("the roll-call is stamped by its ticket_warnings row: held → not approved; approved and in force → none; no row → sample", () => {
    assert.equal(draftVersions(puzzle, [row({})])[1]!.watermark, WATERMARK.notApproved);
    assert.equal(draftVersions(puzzle, [row({ state: "live", approved_by: "matas", approved_at: "2026-11-10T10:00:00Z" })], new Date("2026-11-10T12:00:00Z"))[1]!.watermark, null);
    assert.equal(draftVersions(puzzle, [])[1]!.watermark, WATERMARK.sample);
    // A held row with other words isn't this claim.
    assert.equal(draftVersions(puzzle, [row({ claim: "General sale live" })])[1]!.watermark, WATERMARK.sample);
  });

  it("no version says \"General sale live\", and tiers that make no roll-call stop the round", () => {
    assert.ok(draftVersions(puzzle, []).every((x) => !/general sale live/i.test(x.claim ?? "")));
    assert.throws(() => draftVersions([r(1, "General sale", "on_sale")], []), /don't make a roll-call/);
  });

  it("an event_releases row reads as the generator's Release", () => {
    const rel = releaseFromRow({ id: "x", event_id: "e", position: 4, name: "3rd release", state: "selling_fast", capacity: 400, sold: null, remaining: null });
    assert.deepEqual([rel.position, rel.name, rel.state, rel.capacity], [4, "3rd release", "selling_fast", 400]);
  });

  it("the draft scripts draw the two versions only: no \"General sale live\" job and no stress fixture on a sheet", () => {
    for (const f of ["t1-video-drafts.mts", "t2-claim-drafts.mts", "cta-drafts.mts"]) {
      const src = readFileSync(new URL(`../../../scripts/${f}`, import.meta.url), "utf8");
      assert.match(src, /draftVersions\(/, f);
      assert.doesNotMatch(src, /a-general-sale-live|RECORD_RUNG1|LONGEST|OVERLONG|SIX_RELEASES|b-sample-roll-call|bands-off/, f);
    }
  });
});
