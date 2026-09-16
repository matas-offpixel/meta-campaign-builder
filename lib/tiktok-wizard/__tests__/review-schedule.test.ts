import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  applyReviewScheduleChange,
  reviewScheduleFieldDisabled,
  shouldPersistReviewSchedule,
} from "../review-schedule.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("Review schedule persist (task #139)", () => {
  it("N change events produce one write and never disable the field mid-edit", () => {
    const writes: string[] = [];
    const persist = (value: string) => {
      writes.push(value);
    };
    const segments = [
      "2026-09-17",
      "2026-09-17T",
      "2026-09-17T12",
      "2026-09-17T12:0",
      "2026-09-17T12:00",
    ];
    for (const value of segments) {
      applyReviewScheduleChange({ persist }, "change", value);
      assert.equal(
        reviewScheduleFieldDisabled({ alreadyLaunched: false, smartPlus: false }),
        false,
      );
    }
    applyReviewScheduleChange({ persist }, "blur", "2026-09-17T12:00");
    assert.deepEqual(writes, ["2026-09-17T12:00"]);
    assert.equal(shouldPersistReviewSchedule("change"), false);
    assert.equal(shouldPersistReviewSchedule("blur"), true);
  });

  it("Review start/end keep local state, persist on blur, and stay enabled while saving", () => {
    const review = readFileSync(
      join(HERE, "../../../components/tiktok-wizard/steps/review-launch.tsx"),
      "utf8",
    );
    assert.match(review, /value=\{startDraft\}/);
    assert.match(review, /value=\{endDraft\}/);
    assert.match(review, /onBlur=/);
    assert.match(review, /shouldPersistReviewSchedule\("blur"\)/);
    assert.match(review, /disabled=\{scheduleDisabled\}/);
    assert.equal(review.includes("disabled={saving || alreadyLaunched"), false);
  });
});
