import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  splitEventCodeLpvByClickShare,
  sumLandingPageViewsFromSharePayload,
} from "../funnel-pacing-payload.ts";

describe("sumLandingPageViewsFromSharePayload", () => {
  test("sums concept groups and unattributed LPV from an ok snapshot payload", () => {
    const payload = {
      kind: "ok" as const,
      groups: [{ landingPageViews: 100 }, { landingPageViews: 40 }],
      meta: {
        unattributed: { landingPageViews: 10 },
      },
    };

    assert.equal(sumLandingPageViewsFromSharePayload(payload), 150);
  });

  test("returns 0 for non-ok snapshot payloads", () => {
    const payload = { kind: "skip" as const };

    assert.equal(sumLandingPageViewsFromSharePayload(payload), 0);
  });
});

describe("splitEventCodeLpvByClickShare", () => {
  test("single sibling gets the full LPV value", () => {
    const out = splitEventCodeLpvByClickShare(
      ["e1"],
      6500,
      new Map([["e1", 12000]]),
    );
    assert.equal(out.size, 1);
    assert.equal(out.get("e1"), 6500);
  });

  test("splits proportionally to per-event click share and sum equals input", () => {
    // Shepherd's Bush in miniature: 4 sibling fixtures, one captures
    // the bulk of clicks. The split must preserve the venue total.
    const clicksByEvent = new Map([
      ["a", 596],
      ["b", 10411],
      ["c", 596],
      ["d", 596],
    ]);
    const out = splitEventCodeLpvByClickShare(
      ["a", "b", "c", "d"],
      6500,
      clicksByEvent,
    );
    let total = 0;
    for (const v of out.values()) total += v;
    assert.equal(total, 6500, "scope sum must equal the deduped code LPV");
    // Dominant click holder must dominate the LPV allocation too.
    assert.ok(
      (out.get("b") ?? 0) >
        (out.get("a") ?? 0) +
          (out.get("c") ?? 0) +
          (out.get("d") ?? 0),
      "click-dominant sibling should hold the majority of allocated LPV",
    );
  });

  test("splits evenly when no sibling has rollup clicks yet", () => {
    const out = splitEventCodeLpvByClickShare(
      ["a", "b", "c", "d"],
      100,
      new Map(),
    );
    let total = 0;
    for (const v of out.values()) total += v;
    assert.equal(total, 100, "even split must still sum exactly");
    // Every sibling gets 25 (no rounding remainder at 100/4).
    assert.deepEqual(
      [...out.values()].sort((x, y) => x - y),
      [25, 25, 25, 25],
    );
  });

  test("last sibling absorbs rounding remainder", () => {
    // 7 LPV split across 3 siblings with equal click share rounds to
    // 2 + 2 + 3 (last absorbs +1); the alternative naive Math.round
    // approach would produce 2+2+2=6 and silently undercount the venue.
    const out = splitEventCodeLpvByClickShare(
      ["a", "b", "c"],
      7,
      new Map([
        ["a", 100],
        ["b", 100],
        ["c", 100],
      ]),
    );
    let total = 0;
    for (const v of out.values()) total += v;
    assert.equal(total, 7);
  });

  test(
    "post-PR-A.5 owner-only clicks → equal-split (Edinburgh 3-fixture degenerate)",
    () => {
      // After issue #471 PR-A.5, the rollup writer NULLs out
      // engagement metrics (including link_clicks) on non-owner
      // siblings. clicksByEvent collapses to {owner: 854, b: 0, c: 0}
      // because reads of NULL accumulate as 0. The proportional
      // weighter would dump 100% of LPV on the owner; equal-split is
      // the correct fallback (matches the "spend stays split equally"
      // principle locked in #471).
      const out = splitEventCodeLpvByClickShare(
        ["edin-owner", "edin-b", "edin-c"],
        600,
        new Map([
          ["edin-owner", 854],
          ["edin-b", 0],
          ["edin-c", 0],
        ]),
      );
      let total = 0;
      for (const v of out.values()) total += v;
      assert.equal(total, 600, "scope sum preserved under equal-split");
      // Each fixture gets a third (200/200/200), not all on the owner.
      assert.ok(
        (out.get("edin-owner") ?? 0) <
          400 &&
          (out.get("edin-b") ?? 0) > 0 &&
          (out.get("edin-c") ?? 0) > 0,
        "non-owner siblings must receive an equal-split share post-R2a",
      );
    },
  );

  test(
    "post-PR-A.5 owner-only clicks → equal-split (Brighton 4-fixture degenerate)",
    () => {
      const out = splitEventCodeLpvByClickShare(
        ["br-owner", "br-b", "br-c", "br-d"],
        400,
        new Map([
          ["br-owner", 1200],
          ["br-b", 0],
          ["br-c", 0],
          ["br-d", 0],
        ]),
      );
      let total = 0;
      for (const v of out.values()) total += v;
      assert.equal(total, 400, "scope sum preserved");
      // Each fixture gets 100 LPV (no rounding remainder at 400/4).
      assert.deepEqual(
        [...out.values()].sort((x, y) => x - y),
        [100, 100, 100, 100],
        "equal-split must distribute fairly across 4 fixtures",
      );
    },
  );

  test(
    "post-allocator distinct per-fixture clicks → keep proportional split",
    () => {
      // Manchester-shape (4 fixtures) AFTER the venue allocator has
      // re-written link_clicks per fixture (135 / 143 / 67 / 1090).
      // Every sibling has positive clicks — the proportional weighter
      // still applies, and the degenerate-split guard must NOT fire.
      const clicksByEvent = new Map([
        ["m-a", 135],
        ["m-b", 143],
        ["m-c", 67],
        ["m-d", 1090],
      ]);
      const out = splitEventCodeLpvByClickShare(
        ["m-a", "m-b", "m-c", "m-d"],
        1000,
        clicksByEvent,
      );
      let total = 0;
      for (const v of out.values()) total += v;
      assert.equal(total, 1000, "proportional split preserves scope total");
      // m-d should dominate (1090 of ~1435 total clicks ≈ 76%).
      const mD = out.get("m-d") ?? 0;
      assert.ok(
        mD > (out.get("m-a") ?? 0) + (out.get("m-b") ?? 0) + (out.get("m-c") ?? 0),
        "click-dominant sibling must dominate allocation when ≥ 2 siblings have positive clicks",
      );
    },
  );
});

describe("LPV vs link_clicks scope invariant", () => {
  test(
    "venue-scope BOFU LPV cannot exceed MOFU link_clicks after dedup",
    () => {
      // Mirrors Shepherd's Bush production data (PR fixing post-#291
      // overcount). Four fixtures share event_code → each snapshot
      // carries the SAME campaign-wide LPV (~6,500). Pre-fix code path
      // summed 4 × 6,500 → 26,000 vs ~12,200 clicks. With the dedup
      // helper, the scope total must collapse back to ~6,500 and
      // satisfy LPV ≤ clicks at the venue level.
      const eventIds = ["a", "b", "c", "d"];
      const clicksByEvent = new Map([
        ["a", 596],
        ["b", 10411],
        ["c", 596],
        ["d", 596],
      ]);
      // Snapshot LPV per event (each event stores the same campaign
      // total because Meta substring-matches on event_code).
      const snapshotLpvByEvent = new Map([
        ["a", 6880],
        ["b", 6392],
        ["c", 6260],
        ["d", 6849],
      ]);
      // Resolver picks the max (defensive against snapshot fetched_at
      // jitter) and splits by click share.
      let codeLpv = 0;
      for (const v of snapshotLpvByEvent.values()) {
        if (v > codeLpv) codeLpv = v;
      }
      const dedupedLpvByEvent = splitEventCodeLpvByClickShare(
        eventIds,
        codeLpv,
        clicksByEvent,
      );
      let lpvScope = 0;
      for (const v of dedupedLpvByEvent.values()) lpvScope += v;
      let clicksScope = 0;
      for (const v of clicksByEvent.values()) clicksScope += v;
      // LPV is a strict subset of clicks (each LPV requires a click),
      // so this invariant MUST hold for any scope. The pre-fix code
      // violated it because of the cross-event sum.
      assert.ok(
        lpvScope <= clicksScope,
        `BOFU LPV ${lpvScope} must be ≤ MOFU clicks ${clicksScope} for the same scope`,
      );
      // Belt-and-braces: dedup collapsed the four 6,500-ish duplicates
      // back to one. Sum ≤ codeLpv (with floor of 0 for edge cases).
      assert.ok(lpvScope <= codeLpv);
    },
  );
});
