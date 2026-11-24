import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { launchChecksFrame } from "../../../scripts/plan-frames/launch-checks-fixtures.ts";
import { blockedLaunchLabel, cleanLine, countLine } from "../check.ts";

/** What RC-C and RC-C-clean draw, from the real check on the fixtures. */
describe("RC-C frames", () => {
  it("RC-C: five blockers in check order, then two warnings", () => {
    const result = launchChecksFrame("RC-C");
    assert.deepEqual(countLine(result), ["● 5 to fix before launch", "● 2 to check"]);
    assert.equal(blockedLaunchLabel(result.blockers), "Launch · 5 to fix");
    assert.deepEqual(
      result.checks.map((check) => [check.label, check.sentence, check.evidence, check.fixes.map((fix) => fix.label)]),
      [
        ["Pixel", "Pixel …4093 is Electric Bristol’s. NX27-GLITTERBOX is at NX Newcastle (…2763).", "Ad sets: all 18", ["Use …2763"]],
        [
          "Account",
          "Account Electric Bristol Live isn’t NX Newcastle’s. NX27-GLITTERBOX runs on NX Promoter.",
          "Campaign: [EBR27-GLITTERBOX] SIGNUP",
          ["Use NX Promoter"],
        ],
        [
          "Another show",
          "Still points to Paul Van Dyk: paulvandyk-newcastle.com in 6 ads.",
          "Links in: Lineup Adv+ · Static 1, Static 2, Video 1, Video 2 … and 2 more",
          ["Show the 6 ads"],
        ],
        [
          "Name",
          "The campaign name says EBR27-GLITTERBOX. This event is NX27-GLITTERBOX.",
          "[EBR27-GLITTERBOX] SIGNUP",
          ["Rename to [NX27-GLITTERBOX] SIGNUP"],
        ],
        [
          "Artist caption",
          "Artist-voice caption with no OK from Glitterbox’s team: 4 ads.",
          "Primary text in: Artist · teaser 1–4",
          ["Open captions"],
        ],
        [
          "Link",
          "Link isn’t this event’s page: skiddle.com/e/41877 in 12 ads. The event’s page is crqln.com/l/glitterbox-newcastle.",
          "Set by hand? Mark it in creative setup and this goes.",
          ["Use the event’s page", "Keep this link"],
        ],
        [
          "Link",
          "Link isn’t this event’s page: paulvandyk-newcastle.com in 6 ads. The event’s page is crqln.com/l/glitterbox-newcastle.",
          "Set by hand? Mark it in creative setup and this goes.",
          ["Use the event’s page", "Keep this link"],
        ],
      ],
    );
  });

  it("RC-C-clean: nothing to fix, the match line, Launch on", () => {
    const result = launchChecksFrame("RC-C-clean");
    assert.deepEqual(result.checks, []);
    assert.deepEqual(countLine(result), ["● Nothing to fix"]);
    assert.equal(cleanLine(result.eventCode), "Account, pixel, link and names match NX27-GLITTERBOX.");
    assert.equal(blockedLaunchLabel(result.blockers), null);
  });
});
