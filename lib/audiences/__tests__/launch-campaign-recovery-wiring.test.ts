import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { EVENT_SOURCE_PERMISSION_SUBCODE } from "../event-source-permission.ts";
import { createWithEventSourceRecovery } from "../event-source-recovery.ts";

/**
 * Regression coverage for wiring the PR #729 recovery ladder into
 * `app/api/meta/launch-campaign/route.ts`.
 *
 * Reproducer: Modern Funktion Newcastle launch on NX Promoter
 * (act_606252931141334), 2026-07-29 — every "Similar Pages" (SPLAL) IG
 * engagement audience failed with 2654/1713140, because
 * `createEngagementAudience` was called in a plain try/catch with no
 * grant-and-retry. A page the operator held no role on killed that page's
 * audience outright instead of being fixed, the same failure mode #729 already
 * fixed for the audience-builder write path but had not reached this route.
 *
 * The route handler itself cannot be imported here (`next/server` /
 * `next/headers` don't resolve under the strip-types test runner — see
 * `seed-remediation-wiring.test.ts` for the same constraint), so this file is
 * two things:
 *   1. Source assertions that the route calls the recovery-wrapped helper at
 *      BOTH engagement-audience call sites, not raw `createEngagementAudience`.
 *   2. A behavioural run of the REAL (already-imported, dependency-free) ladder
 *      against the exact shape the route now uses it with — single-source,
 *      `requested: [spec.sourceId]` — reproducing the Modern Funktion failure
 *      and proving the fix stage clears it.
 */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const ROUTE = code("app/api/meta/launch-campaign/route.ts");
const TYPES = code("lib/types.ts");
const REVIEW = code("components/steps/review-launch.tsx");

describe("launch-campaign route: 1713140 recovery wiring", () => {
  it("defines one recovery-wrapped helper over createEngagementAudience", () => {
    assert.match(ROUTE, /async function createEngagementAudienceWithRecovery/);
    const helper = ROUTE.slice(ROUTE.indexOf("async function createEngagementAudienceWithRecovery"));
    assert.match(helper, /createWithEventSourceRecovery/);
    assert.match(helper, /remediateAudienceSeeds/);
    // Single-source: an engagement audience always has exactly one event
    // source, so the ladder is given exactly one requested id, matching the
    // shape createWithEventSourceRecovery's salvage stage expects.
    assert.match(helper, /requested:\s*\[spec\.sourceId\]/);
  });

  it("Phase 1.5, Phase 1.5b (SPLAL), and the task #124 recreate-from-scratch fallback all use the wrapped helper", () => {
    const calls = ROUTE.match(/await createEngagementAudienceWithRecovery\(/g);
    assert.equal(
      calls?.length,
      3,
      "expected the page-group loop, the SPLAL loop, AND recreateEngagementAudiencesForGroup's forced-fresh " +
        "loop (task #124 — the 'Similar Pages' third-tier fallback when Meta's ad-set-create validator " +
        "disagrees with its own availability read endpoint) to all call the recovery-wrapped helper",
    );
    // The raw function must no longer be awaited directly from inside either
    // try-block — that was the bug: no auto-grant, no salvage. The only
    // remaining call is inside the helper's `create` callback, which is NOT
    // itself awaited at its definition site (the ladder awaits it internally).
    const awaitedDirectCalls = ROUTE.match(/await createEngagementAudience\(adAccountId/g);
    assert.equal(
      awaitedDirectCalls,
      null,
      "createEngagementAudience must not be awaited directly at either call site — " +
        "that bypasses the recovery ladder entirely",
    );
    const allCalls = ROUTE.match(/createEngagementAudience\(adAccountId/g);
    assert.equal(
      allCalls?.length,
      1,
      "createEngagementAudience should be referenced exactly once, inside the recovery helper",
    );
  });

  it("records the recovery note onto engagementAudiencesCreated at both call sites", () => {
    const pushes = ROUTE.match(/engagementAudiencesCreated\.push\(\{[\s\S]*?\}\);/g) ?? [];
    const withNote = pushes.filter((p) => /\.\.\.\(note \? \{ note \} : \{\}\)/.test(p));
    assert.equal(
      withNote.length,
      2,
      "both engagement-audience creation sites should conditionally attach the recovery note",
    );
  });

  it("engagementAudiencesCreated.note is a typed, optional field, not a silent any", () => {
    const field = TYPES.slice(TYPES.indexOf("engagementAudiencesCreated?:"));
    assert.match(field.slice(0, field.indexOf("[]")), /note\?:\s*string/);
  });

  it("the review UI surfaces the note as a warning, not silently", () => {
    const block = REVIEW.slice(REVIEW.indexOf('if (summary.engagementAudiencesCreated?.length)'));
    const firstBlockEnd = block.indexOf("\n  }\n");
    const scoped = block.slice(0, firstBlockEnd);
    assert.match(scoped, /status:\s*a\.note\s*\?\s*"warning"\s*:\s*"success"/);
    assert.match(scoped, /detail:\s*a\.note/);
  });
});

describe("launch-campaign route: behavioural reproduction of the Modern Funktion failure", () => {
  const SIMILAR_PAGE_IG_ID = "17841400000000001"; // stand-in for the failing Similar-Pages IG source

  function refusal(ids: string[]) {
    const err = new Error(
      `(#2654) No permission for event source: Audience creation permission is ` +
        `missing for one or more event sources (ID: ${ids.join(", ")}).`,
    ) as Error & { code: number; subcode: number };
    err.code = 2654;
    err.subcode = EVENT_SOURCE_PERMISSION_SUBCODE;
    return err;
  }

  it("reproduces the exact failure, then clears it via grant + retry (single-source shape)", async () => {
    let attempts = 0;
    const out = await createWithEventSourceRecovery<{ id: string }>({
      // This is exactly what createEngagementAudienceWithRecovery passes:
      // one requested id per call, because an engagement audience has one
      // event source.
      requested: [SIMILAR_PAGE_IG_ID],
      names: { [SIMILAR_PAGE_IG_ID]: "Modern Funktion Newcastle — Similar Pages" },
      create: async () => {
        attempts++;
        if (attempts === 1) throw refusal([SIMILAR_PAGE_IG_ID]);
        return { id: "aud_recovered_123" };
      },
      remediate: async (ids) => ({ remediated: ids, skipped: [] }),
    });

    assert.equal(out.result.id, "aud_recovered_123");
    assert.equal(attempts, 2);
    assert.match(out.note ?? "", /Granted you ADVERTISE on Modern Funktion Newcastle/);
  });

  it("fails with the real cause (not a generic Meta error) when remediation cannot run", async () => {
    // e.g. Modern Funktion's Business Manager token has expired, or the page
    // isn't in any connected BM — remediateAudienceSeeds never throws, it
    // reports skipped instead, and the ladder must still explain, not swallow.
    await assert.rejects(
      createWithEventSourceRecovery<{ id: string }>({
        requested: [SIMILAR_PAGE_IG_ID],
        names: { [SIMILAR_PAGE_IG_ID]: "Modern Funktion Newcastle — Similar Pages" },
        create: async () => {
          throw refusal([SIMILAR_PAGE_IG_ID]);
        },
        remediate: async () => ({
          remediated: [],
          skipped: [
            { sourceId: SIMILAR_PAGE_IG_ID, reason: "Business Manager needs reconnecting" },
          ],
        }),
      }),
      (err: Error) => {
        assert.match(err.message, /Modern Funktion Newcastle — Similar Pages/);
        assert.match(err.message, /holds no role/);
        assert.match(err.message, /Business Manager needs reconnecting/);
        return true;
      },
    );
  });

  it("a single-source refusal never salvages a partial audience — it is fix or explain, never a reduced create", async () => {
    // Unlike the multi-page audience-builder case, dropping the only
    // requested seed leaves nothing to build from. This asserts that
    // invariant holds for the exact shape the launch route uses, so nobody
    // "optimises" the launch route into expecting a partial success.
    let createCalls: (string[] | null)[] = [];
    await assert.rejects(
      createWithEventSourceRecovery<{ id: string }>({
        requested: [SIMILAR_PAGE_IG_ID],
        create: async (seeds) => {
          createCalls.push(seeds);
          throw refusal([SIMILAR_PAGE_IG_ID]);
        },
        remediate: async () => ({ remediated: [], skipped: [] }),
      }),
    );
    // Exactly one create call: the original attempt. No retry with an empty
    // seed set was ever attempted.
    assert.deepEqual(createCalls, [null]);
  });
});
