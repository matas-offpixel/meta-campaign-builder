import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { launchChecksFrame, launchChecksFrameView } from "../../../scripts/plan-frames/launch-checks-fixtures.ts";
import { blockedLaunchLabel, cleanLine, countLine } from "../check.ts";

/** What the RC-C frames draw, from the real check on the fixtures. */
describe("RC-C frames", () => {
  it("RC-C: five blockers in check order, then the link warning", () => {
    const result = launchChecksFrame("RC-C");
    assert.deepEqual(countLine(result), ["● 5 to fix before launch", "● 1 to check"]);
    assert.equal(blockedLaunchLabel(result.blockers), "Launch · 5 to fix");
    assert.deepEqual(
      result.checks.map((check) => [check.label, check.sentence, check.evidence, check.fixes.map((fix) => fix.label)]),
      [
        ["Pixel", "Pixel …4093 is Electric Bristol’s. NX27-GLITTERBOX is at NX Newcastle (…2763).", "Ad sets: all 18", ["Use …2763"]],
        [
          "Account",
          "Account Electric Bristol Live (Electric Bristol) isn’t NX Newcastle’s. NX27-GLITTERBOX runs on NX Promoter (NX Newcastle).",
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

describe("RC-C2 (page_other_client)", () => {
  it("NX26-DOD: LWE's page and Puzzle's Instagram, two blockers", () => {
    const result = launchChecksFrame("RC-C2");
    assert.deepEqual(countLine(result), ["● 2 to fix before launch"]);
    assert.equal(blockedLaunchLabel(result.blockers), "Launch · 2 to fix");
    assert.deepEqual(
      result.checks.map((check) => [check.label, check.sentence, check.evidence, check.fixes.map((fix) => fix.label)]),
      [
        [
          "Page",
          "Ads run from Ironworks London, which is IRONWORKS’s page. NX26-DOD is Electric Brixton’s show.",
          "Ads: all 9",
          ["Change the page"],
        ],
        [
          "Instagram",
          "Ads run on Instagram as @puzzleofficialuk, Puzzle’s account. NX26-DOD is Electric Brixton’s show.",
          "Ads: all 9",
          ["Change the Instagram account"],
        ],
      ],
    );
  });
});

describe("RC-C-venue (ops' rulings 3 and 4)", () => {
  it("two warnings, no blocker, Launch on", () => {
    const result = launchChecksFrame("RC-C-venue");
    assert.deepEqual(result.checks.map((check) => [check.key, check.severity]), [
      ["venue_not_set", "warning"],
      ["link_not_event", "warning"],
    ]);
    assert.deepEqual(countLine(result), ["● 2 to check"]);
    assert.equal(blockedLaunchLabel(result.blockers), null);
    assert.equal(result.checks[1]!.findings.length, 1);
    assert.equal(
      result.checks[0]!.sentence,
      "Electric Brixton has no account or pixel stored, so this draft’s account and pixel can’t be checked. Set them on the venue card.",
    );
    assert.equal(
      result.checks[1]!.sentence,
      "Link isn’t this event’s page: skiddle.com/e/41877 in 1 ad. The event’s page is crqln.com/l/fixture-brixton.",
    );
    assert.deepEqual(launchChecksFrameView("RC-C-venue").keptLines, [
      "Link kept by Matas, 24 Nov, 16:40: ra.co/events/2210442",
    ]);
  });
});
