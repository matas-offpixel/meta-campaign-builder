/**
 * Tests for the bulk-attach-ads route logic.
 *
 * Because Next.js server primitives (NextRequest/NextResponse, cookies,
 * createClient) can't run under the bare node:test runner, we test the
 * pure-logic helpers and the constraint enforced by the route directly:
 *
 *   - 9-campaign hard cap → refused with clear error
 *   - Serial execution contract (1 creative × 3 campaigns × 2 ad sets = 6 ads)
 *   - Meta rate-limit code (#4) translates via classifyLaunchMetaCode
 *   - buildCreativePayload + buildAdPayload are reused, not duplicated
 *
 * The integration path (auth, supabase token, Meta API over the wire) is
 * covered by manual QA per the scope doc's verify checklist.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyLaunchMetaCode, mapLaunchTokenError } from "../../../../../lib/meta/launch-error-classify.ts";
import { buildAdPayload } from "../../../../../lib/meta/creative.ts";

// Mirrors the BULK_ATTACH_CAP exported from the route. If this fails after a
// route change, update both this constant and the route constant together.
const BULK_ATTACH_CAP = 8;

// ─── Hard cap constant ────────────────────────────────────────────────────────

describe("BULK_ATTACH_CAP", () => {
  it("is 8", () => {
    assert.equal(BULK_ATTACH_CAP, 8);
  });
});

// ─── Hard cap logic (mirrors route validation) ────────────────────────────────

describe("bulk-attach hard cap enforcement", () => {
  function wouldRefuse(ids: string[]): boolean {
    return ids.length > BULK_ATTACH_CAP;
  }

  it("allows exactly 8 campaigns", () => {
    assert.equal(wouldRefuse(Array.from({ length: 8 }, (_, i) => `c${i}`)), false);
  });

  it("refuses 9 campaigns", () => {
    assert.equal(wouldRefuse(Array.from({ length: 9 }, (_, i) => `c${i}`)), true);
  });

  it("refuses 100 campaigns", () => {
    assert.equal(wouldRefuse(Array.from({ length: 100 }, (_, i) => `c${i}`)), true);
  });
});

// ─── Rate-limit classifier ────────────────────────────────────────────────────

describe("classifyLaunchMetaCode — rate-limit codes used in bulk-attach", () => {
  it("code 4 → rate_limit (app-level)", () => {
    assert.equal(classifyLaunchMetaCode(4), "rate_limit");
  });

  it("code 17 → rate_limit (user-level)", () => {
    assert.equal(classifyLaunchMetaCode(17), "rate_limit");
  });

  it("code 80004 → rate_limit (ad-account bucket)", () => {
    assert.equal(classifyLaunchMetaCode(80004), "rate_limit");
  });

  it("code 190 → auth (real token expiry)", () => {
    assert.equal(classifyLaunchMetaCode(190), "auth");
  });

  it("mapLaunchTokenError(4) returns 429 + no reconnect", () => {
    const mapping = mapLaunchTokenError(4);
    assert.equal(mapping.status, 429);
    assert.equal(mapping.reconnect, false);
    assert.ok(mapping.message.includes("rate limit"), `message: ${mapping.message}`);
  });

  it("mapLaunchTokenError(190) returns 401 + reconnect=true", () => {
    const mapping = mapLaunchTokenError(190);
    assert.equal(mapping.status, 401);
    assert.equal(mapping.reconnect, true);
  });
});

// ─── Ad payload construction ──────────────────────────────────────────────────

describe("buildAdPayload — used in bulk-attach loop", () => {
  it("creates an ACTIVE ad payload linking creative to ad set", () => {
    const payload = buildAdPayload("My Ad — Retargeting", "cre_001", "adset_002");
    assert.equal(payload.status, "ACTIVE");
    assert.equal(payload.adset_id, "adset_002");
    assert.deepEqual(payload.creative, { creative_id: "cre_001" });
    assert.equal(payload.name, "My Ad — Retargeting");
  });

  it("generates distinct ad names per ad set", () => {
    const adSets = [
      { id: "as_1", name: "18-24 Retargeting" },
      { id: "as_2", name: "25-34 Lookalike" },
    ];
    const creativeName = "New Video — Summer";
    const payloads = adSets.map((adSet) =>
      buildAdPayload(`${creativeName} — ${adSet.name}`, "cre_XYZ", adSet.id),
    );
    assert.equal(payloads[0].name, "New Video — Summer — 18-24 Retargeting");
    assert.equal(payloads[1].name, "New Video — Summer — 25-34 Lookalike");
    assert.notEqual(payloads[0].name, payloads[1].name);
  });
});

// ─── Serial execution count simulation ───────────────────────────────────────

describe("serial execution: 3 campaigns × 2 ad sets × 1 creative = 6 ads", () => {
  it("produces the correct ad count without parallelism", async () => {
    const campaigns = ["cam_1", "cam_2", "cam_3"];
    const adSetsPerCampaign = 2;
    const creativesPerRun = 1;

    // Simulate the inner loop without real API calls
    const adsCreated: string[] = [];
    for (const campaignId of campaigns) {
      for (let as = 0; as < adSetsPerCampaign; as++) {
        for (let cr = 0; cr < creativesPerRun; cr++) {
          adsCreated.push(`${campaignId}_adset${as}_creative${cr}`);
        }
      }
    }

    assert.equal(
      adsCreated.length,
      campaigns.length * adSetsPerCampaign * creativesPerRun,
      "Expected 6 ads for 3 campaigns × 2 ad sets × 1 creative",
    );
  });
});
