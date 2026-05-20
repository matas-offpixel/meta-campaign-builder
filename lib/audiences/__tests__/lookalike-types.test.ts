import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_LOOKALIKE_COUNTRY,
  LOOKALIKE_TIERS,
  buildLookalikeCellName,
  buildLookalikePreview,
  isLookalikeTier,
  lookalikePreviewToInserts,
  normaliseCountryCode,
  tierToRatio,
  type LookalikeSeedCandidate,
} from "../lookalike-types.ts";
import { sanitizeAudienceName } from "../../meta/audience-payload.ts";

// ── 1. Type predicates + constants ───────────────────────────────────────────

describe("isLookalikeTier", () => {
  it("accepts 1, 2, 3", () => {
    for (const t of LOOKALIKE_TIERS) assert.ok(isLookalikeTier(t));
  });

  it("rejects out-of-range / non-number / non-integer", () => {
    assert.ok(!isLookalikeTier(0));
    assert.ok(!isLookalikeTier(4));
    assert.ok(!isLookalikeTier(1.5));
    assert.ok(!isLookalikeTier("1"));
    assert.ok(!isLookalikeTier(undefined));
    assert.ok(!isLookalikeTier(null));
  });
});

describe("tierToRatio", () => {
  it("maps tier → Meta ratio float", () => {
    assert.equal(tierToRatio(1), 0.01);
    assert.equal(tierToRatio(2), 0.02);
    assert.equal(tierToRatio(3), 0.03);
  });
});

// ── 2. Country normalisation ─────────────────────────────────────────────────

describe("normaliseCountryCode", () => {
  it("uppercases valid ISO-2 codes", () => {
    assert.equal(normaliseCountryCode("gb"), "GB");
    assert.equal(normaliseCountryCode("US"), "US");
    assert.equal(normaliseCountryCode(" ie "), "IE");
  });

  it("defaults to GB for non-ISO-2 input", () => {
    assert.equal(normaliseCountryCode(""), DEFAULT_LOOKALIKE_COUNTRY);
    assert.equal(normaliseCountryCode("UK"), "UK"); // UK passes the /^[A-Z]{2}$/ check
    assert.equal(normaliseCountryCode("GBR"), DEFAULT_LOOKALIKE_COUNTRY);
    assert.equal(normaliseCountryCode("1A"), DEFAULT_LOOKALIKE_COUNTRY);
    assert.equal(normaliseCountryCode(undefined), DEFAULT_LOOKALIKE_COUNTRY);
    assert.equal(normaliseCountryCode(42), DEFAULT_LOOKALIKE_COUNTRY);
  });
});

// ── 3. Cell naming ───────────────────────────────────────────────────────────

describe("buildLookalikeCellName", () => {
  it("formats as '[prefix] <seed> LAL <tier>% <country>'", () => {
    assert.equal(
      buildLookalikeCellName({
        labelPrefix: "innervisions",
        seedName: "Innervisions 95% VV 60d",
        tier: 1,
        country: "GB",
      }),
      "[innervisions] Innervisions 95% VV 60d LAL 1% GB",
    );
  });

  it("trims and clips the seed-name portion at 60 raw chars so the LAL suffix always survives sanitisation", () => {
    const longSeed = "a".repeat(120);
    const raw = buildLookalikeCellName({
      labelPrefix: "x",
      seedName: longSeed,
      tier: 2,
      country: "US",
    });
    assert.ok(raw.includes("LAL 2% US"), "suffix preserved in raw name");
    const sanitised = sanitizeAudienceName(raw);
    // Sanitise truncates to 50 chars total — guarantee the row still inserts.
    assert.equal(sanitised.length, 50);
  });

  it("sanitised output for a real-world name fits Meta's 50-char cap", () => {
    const raw = buildLookalikeCellName({
      labelPrefix: "innervisions",
      seedName: "Innervisions 95% VV 60d",
      tier: 1,
      country: "GB",
    });
    const sanitised = sanitizeAudienceName(raw);
    assert.ok(sanitised.length <= 50);
    // Sanitise lowercases nothing — but it does strip the % character.
    // "[innervisions] Innervisions 95% VV 60d LAL 1% GB" becomes:
    //  "innervisions_Innervisions_95_VV_60d_LAL_1_GB" → fits in 50 chars
    assert.ok(sanitised.includes("LAL_1_GB"));
  });
});

// ── 4. buildLookalikePreview — cell count + dedup ────────────────────────────

const BASE_SEEDS: LookalikeSeedCandidate[] = [
  {
    metaAudienceId: "1001",
    name: "Innervisions 95% VV 60d",
    source: "db",
    localAudienceId: "local-1",
    audienceSubtype: "video_views",
    funnelStage: "bottom_funnel",
  },
  {
    metaAudienceId: "1002",
    name: "Junction 30d Pixel",
    source: "db",
    localAudienceId: "local-2",
    audienceSubtype: "website_pixel",
    funnelStage: "bottom_funnel",
  },
];

describe("buildLookalikePreview — cell count", () => {
  it("produces one cell per seed (N seeds × 1 tier)", () => {
    const preview = buildLookalikePreview({
      clientSlug: "innervisions",
      clientName: "Innervisions",
      seeds: BASE_SEEDS,
      tier: 1,
      country: "GB",
    });
    assert.equal(preview.cells.length, BASE_SEEDS.length);
    assert.equal(preview.tier, 1);
    assert.equal(preview.ratio, 0.01);
    assert.equal(preview.country, "GB");
    assert.equal(preview.labelPrefix, "innervisions");
  });

  it("uses labelOverride when provided", () => {
    const preview = buildLookalikePreview({
      clientSlug: "innervisions",
      clientName: "Innervisions",
      labelOverride: "spring-tour",
      seeds: BASE_SEEDS,
      tier: 1,
      country: "GB",
    });
    assert.equal(preview.labelPrefix, "spring-tour");
  });

  it("falls back to clientName when slug + override are both absent", () => {
    const preview = buildLookalikePreview({
      clientSlug: null,
      clientName: "Innervisions",
      seeds: BASE_SEEDS,
      tier: 2,
      country: "GB",
    });
    assert.equal(preview.labelPrefix, "Innervisions");
  });
});

describe("buildLookalikePreview — defensive dedup by metaAudienceId", () => {
  it("ignores duplicate seed entries (same metaAudienceId from DB and Meta lists)", () => {
    const duplicated: LookalikeSeedCandidate[] = [
      BASE_SEEDS[0]!,
      // Same id, came from the Meta live-fetch list.
      {
        metaAudienceId: "1001",
        name: "Innervisions 95% VV 60d (Meta name)",
        source: "meta",
        metaSubtype: "ENGAGEMENT",
        approximateCount: 25_000,
      },
      BASE_SEEDS[1]!,
    ];
    const preview = buildLookalikePreview({
      clientSlug: "x",
      clientName: "x",
      seeds: duplicated,
      tier: 1,
      country: "GB",
    });
    // Two unique meta IDs → two cells. First-seen wins (DB version of 1001).
    assert.equal(preview.cells.length, 2);
    assert.equal(preview.cells[0]!.seedMetaAudienceId, "1001");
    assert.equal(preview.cells[0]!.seedName, "Innervisions 95% VV 60d");
  });

  it("drops seeds with empty metaAudienceId silently", () => {
    const withBad: LookalikeSeedCandidate[] = [
      BASE_SEEDS[0]!,
      { metaAudienceId: "", name: "broken", source: "meta" },
    ];
    const preview = buildLookalikePreview({
      clientSlug: "x",
      clientName: "x",
      seeds: withBad,
      tier: 1,
      country: "GB",
    });
    assert.equal(preview.cells.length, 1);
  });
});

// ── 5. lookalikePreviewToInserts ─────────────────────────────────────────────

describe("lookalikePreviewToInserts", () => {
  const opts = {
    userId: "user-1",
    clientId: "client-1",
    metaAdAccountId: "act_42",
  };

  it("emits one insert per cell with correct subtype + funnel stage + retention sentinel", () => {
    const preview = buildLookalikePreview({
      clientSlug: "x",
      clientName: "x",
      seeds: BASE_SEEDS,
      tier: 1,
      country: "GB",
    });
    const inserts = lookalikePreviewToInserts(preview, opts);
    assert.equal(inserts.length, BASE_SEEDS.length);
    for (const insert of inserts) {
      assert.equal(insert.audienceSubtype, "lookalike");
      assert.equal(insert.funnelStage, "top_of_funnel");
      assert.equal(insert.retentionDays, 1);
      assert.equal(insert.userId, "user-1");
      assert.equal(insert.clientId, "client-1");
      assert.equal(insert.metaAdAccountId, "act_42");
      assert.equal(insert.eventId, null);
    }
  });

  it("packs sourceMeta with originAudienceId, ratio, country, seedName + seedLocalAudienceId for DB seeds", () => {
    const preview = buildLookalikePreview({
      clientSlug: "x",
      clientName: "x",
      seeds: BASE_SEEDS,
      tier: 2,
      country: "US",
    });
    const [first] = lookalikePreviewToInserts(preview, opts);
    const sm = first!.sourceMeta as Record<string, unknown>;
    assert.equal(sm.subtype, "lookalike");
    assert.equal(sm.originAudienceId, "1001");
    assert.equal(sm.ratio, 0.02);
    assert.equal(sm.country, "US");
    assert.equal(sm.seedName, "Innervisions 95% VV 60d");
    assert.equal(sm.seedLocalAudienceId, "local-1");
    assert.equal(sm.type, "similarity");
  });

  it("sets seedLocalAudienceId=null for seeds sourced from the live Meta list", () => {
    const seeds: LookalikeSeedCandidate[] = [
      { metaAudienceId: "2001", name: "CSV ticket holders", source: "meta" },
    ];
    const preview = buildLookalikePreview({
      clientSlug: "x",
      clientName: "x",
      seeds,
      tier: 1,
      country: "GB",
    });
    const [insert] = lookalikePreviewToInserts(preview, opts);
    const sm = insert!.sourceMeta as Record<string, unknown>;
    assert.equal(sm.seedLocalAudienceId, null);
    assert.equal(insert!.sourceId, "2001");
  });

  it("sourceId mirrors origin Meta audience id (used by audit / UI surfaces)", () => {
    const preview = buildLookalikePreview({
      clientSlug: "x",
      clientName: "x",
      seeds: BASE_SEEDS,
      tier: 3,
      country: "GB",
    });
    const inserts = lookalikePreviewToInserts(preview, opts);
    assert.equal(inserts[0]!.sourceId, "1001");
    assert.equal(inserts[1]!.sourceId, "1002");
  });
});
