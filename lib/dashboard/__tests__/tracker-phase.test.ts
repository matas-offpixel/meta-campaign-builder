import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  fmtShortDay,
  presaleBucketLabel,
  presaleBucketNoun,
  previousDay,
  trackerMilestoneDays,
  trackerMilestonesInRange,
} from "../tracker-phase.ts";

/** D.O.D at Electric Brixton, with the dates Matas set by hand:
 *  announce 2 Sept 17:00, community presale 9 Sept 12:00, general
 *  sale 9 Sept 14:00 (BST, so 13:00Z). */
const DOD = {
  announcementAt: "2026-09-02T16:00:00+00:00",
  presaleAt: "2026-09-09T11:00:00+00:00",
  generalSaleAt: "2026-09-09T13:00:00+00:00",
};

describe("trackerMilestoneDays", () => {
  it("maps each milestone to its calendar day", () => {
    const days = trackerMilestoneDays(DOD);
    assert.deepEqual(days.get("2026-09-02"), ["announce"]);
  });

  it("keeps two milestones that share a day, in campaign order", () => {
    const days = trackerMilestoneDays(DOD);
    assert.deepEqual(days.get("2026-09-09"), ["presale", "general_sale"]);
  });

  it("skips unset milestones", () => {
    const days = trackerMilestoneDays({
      announcementAt: null,
      presaleAt: null,
      generalSaleAt: "2026-09-09T13:00:00+00:00",
    });
    assert.equal(days.size, 1);
    assert.deepEqual(days.get("2026-09-09"), ["general_sale"]);
  });

  it("ignores a malformed timestamp rather than inventing a day", () => {
    const days = trackerMilestoneDays({ announcementAt: "soon" });
    assert.equal(days.size, 0);
  });

  it("returns an empty map when there are no milestones at all", () => {
    assert.equal(trackerMilestoneDays(null).size, 0);
  });
});

describe("trackerMilestonesInRange", () => {
  const days = trackerMilestoneDays(DOD);

  it("finds the announce day inside the collapsed bucket's range", () => {
    assert.deepEqual(
      trackerMilestonesInRange(days, "2026-08-27", "2026-09-08"),
      ["announce"],
    );
  });

  it("finds both same-day milestones inside a weekly bucket", () => {
    assert.deepEqual(
      trackerMilestonesInRange(days, "2026-09-07", "2026-09-13"),
      ["presale", "general_sale"],
    );
  });

  it("excludes milestones outside the range", () => {
    assert.deepEqual(
      trackerMilestonesInRange(days, "2026-09-10", "2026-09-16"),
      [],
    );
  });

  it("treats a null bound as open-ended", () => {
    assert.deepEqual(trackerMilestonesInRange(days, null, "2026-09-08"), [
      "announce",
    ]);
  });
});

describe("presaleBucketLabel", () => {
  it("names the signup phase when announce + presale are set", () => {
    assert.equal(
      presaleBucketLabel({
        cutoffDate: "2026-09-09",
        earliestDate: "2026-08-27",
        milestones: DOD,
      }),
      "Signup phase (27 Aug – 8 Sept)",
    );
  });

  it("falls back to the general-sale wording when milestones are unset", () => {
    assert.equal(
      presaleBucketLabel({
        cutoffDate: "2026-09-09",
        earliestDate: "2026-08-27",
        milestones: { generalSaleAt: "2026-09-09T13:00:00+00:00" },
      }),
      "Before general sale (from 27 Aug)",
    );
  });

  it("falls back when only announce is set", () => {
    assert.equal(
      presaleBucketLabel({
        cutoffDate: "2026-09-09",
        earliestDate: "2026-08-27",
        milestones: {
          announcementAt: DOD.announcementAt,
          generalSaleAt: DOD.generalSaleAt,
        },
      }),
      "Before general sale (from 27 Aug)",
    );
  });

  it("falls back when the cutoff is not the general-sale day", () => {
    // A venue report whose siblings disagree, or a cutoff derived from
    // something other than general_sale_at — do not claim a phase we
    // cannot substantiate.
    assert.equal(
      presaleBucketLabel({
        cutoffDate: "2026-09-04",
        earliestDate: "2026-08-27",
        milestones: DOD,
      }),
      "Before general sale (from 27 Aug)",
    );
  });

  it("drops the range when there is no activity date", () => {
    assert.equal(
      presaleBucketLabel({
        cutoffDate: "2026-09-09",
        earliestDate: null,
        milestones: DOD,
      }),
      "Signup phase (to 8 Sept)",
    );
    assert.equal(
      presaleBucketLabel({
        cutoffDate: "2026-09-09",
        earliestDate: null,
        milestones: null,
      }),
      "Before general sale",
    );
  });
});

describe("presaleBucketNoun", () => {
  it("matches whichever label the bucket row carries", () => {
    assert.equal(presaleBucketNoun("2026-09-09", DOD), "Signup phase");
    assert.equal(presaleBucketNoun("2026-09-09", null), "Pre-general-sale");
  });
});

describe("date helpers", () => {
  it("formats a short day without a weekday", () => {
    assert.equal(fmtShortDay("2026-08-27"), "27 Aug");
  });

  it("steps back across a month boundary in UTC", () => {
    assert.equal(previousDay("2026-09-01"), "2026-08-31");
  });

  it("returns null for a malformed date", () => {
    assert.equal(previousDay("nope"), null);
  });
});
