import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import * as XLSX from "xlsx";

import {
  classifyCharOverflow,
  normaliseCampaignKey,
  normaliseMatchType,
  parseGoogleSearchPlanXlsx,
  resolveNegativeScope,
} from "../xlsx-import.ts";
import type { GoogleSearchImportWarning } from "../types.ts";

// ─── Helper: build an in-memory J2-style workbook for end-to-end tests ─

function buildJ2Workbook(): Uint8Array {
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Junction 2 Melodic — Google Search Plan"],
      [],
      ["Campaign", "Focus", "Ad Groups", "Monthly Budget", "Priority", "Notes"],
      ["C1 Brand Defence", "Brand terms", "1", 1500, "MUST-RUN", "Always-on"],
      ["C2 Adam Beyer", "Headliner", "1", 800, "HIGHEST", "Lead artist boost"],
    ]),
    "Overview",
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Campaign", "Ad Group", "Keyword", "Match Type", "Est CPC Low", "Est CPC High", "Intent", "Notes"],
      ["C1 Brand Defence", "Brand", "junction 2 melodic", "[Exact]", 0.2, 0.4, "Brand", null],
      ["C1 Brand Defence", "Brand", "junction 2 melodic tickets", '"Phrase"', 0.3, 0.6, "Brand", null],
      ["C1 Brand Defence", "Brand", "junction 2 melodic", "[Exact]", 0.2, 0.4, "Brand", "duplicate"],
      ["C2 Adam Beyer", "Headliner", "adam beyer london", "Phrase Match", 0.5, 1.2, "Trans.", null],
      ["C2 Adam Beyer", "Headliner", "adam beyer tickets", "Broad", 0.4, 0.9, "Disc.", null],
      ["C2 Adam Beyer", "Headliner", "weird-match-row", "Wibble", 0.4, 0.9, "Disc.", null],
      ["", "Headliner", "orphan keyword", "Exact", null, null, null, null],
      ["C2 Adam Beyer", "", "orphan keyword 2", "Exact", null, null, null, null],
    ]),
    "Keywords",
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Campaign", "Type", "Content", "Char Count"],
      ["C1 Brand Defence", "H1", "Junction 2 Melodic", "18"],
      ["C1 Brand Defence", "H2", "Tickets On Sale Now", "19"],
      ["C1 Brand Defence", "H3", "Official Brand Page Headlines That Overflow Limit", "47 ✗"],
      ["C1 Brand Defence", "D1", "Limited tickets remaining for Junction 2 Melodic.", "49"],
      ["C1 Brand Defence", "D2", "Headline acts and unforgettable nights.", "39"],
      ["C2 Adam Beyer", "H1", "See Adam Beyer Live", "19"],
      ["C2 Adam Beyer", "H2", "London Show", "11"],
      ["C2 Adam Beyer", "H3", "Buy Tickets Today", "17"],
      ["C2 Adam Beyer", "D1", "Catch the techno don live at Junction 2 Melodic this summer.", "60"],
      ["C2 Adam Beyer", "D2", "Tickets selling fast.", "21"],
    ]),
    "Ad Copy",
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Scope", "Negative Keyword", "Match Type", "Reason"],
      ["All", "free", "[Phrase]", "Filter freeloaders"],
      ["All", "torrent", "Broad", "Piracy filter"],
      ["C2 Adam Beyer", "stream", "Broad", "Filter streaming intent"],
      ["UnknownCampaign", "fallback", "Exact", "Unknown campaign"],
    ]),
    "Negative Keywords",
  );

  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
}

// ─── Match-type normalisation ─────────────────────────────────────────

describe("normaliseMatchType", () => {
  it("strips brackets/quotes and accepts EXACT/PHRASE/BROAD aliases", () => {
    assert.equal(normaliseMatchType("[Exact]"), "EXACT");
    assert.equal(normaliseMatchType('"Phrase"'), "PHRASE");
    assert.equal(normaliseMatchType("Broad"), "BROAD");
    assert.equal(normaliseMatchType("Phrase Match"), "PHRASE");
    assert.equal(normaliseMatchType("broad match"), "BROAD");
    assert.equal(normaliseMatchType("EXACT MATCH"), "EXACT");
  });

  it("returns null for unrecognised or empty inputs", () => {
    assert.equal(normaliseMatchType(""), null);
    assert.equal(normaliseMatchType(null), null);
    assert.equal(normaliseMatchType("Wibble"), null);
    assert.equal(normaliseMatchType("Modified Broad"), null);
  });
});

// ─── Char-overflow validator ──────────────────────────────────────────

describe("classifyCharOverflow", () => {
  it("returns null when within the limit", () => {
    assert.equal(classifyCharOverflow("Headline OK", "headline"), null);
    assert.equal(classifyCharOverflow("Description that is well under ninety chars", "description"), null);
  });

  it("flags headlines over 30 chars and descriptions over 90 chars", () => {
    const h = classifyCharOverflow("a".repeat(31), "headline");
    assert.equal(h?.code, "headline_too_long");
    assert.equal(h?.context?.length, 31);
    assert.equal(h?.context?.max, 30);

    const d = classifyCharOverflow("d".repeat(91), "description");
    assert.equal(d?.code, "description_too_long");
    assert.equal(d?.context?.length, 91);
    assert.equal(d?.context?.max, 90);
  });
});

// ─── End-to-end parser ────────────────────────────────────────────────

describe("parseGoogleSearchPlanXlsx (J2 fixture)", () => {
  const tree = parseGoogleSearchPlanXlsx(buildJ2Workbook());

  it("parses the plan name from the Overview tab title row", () => {
    assert.match(tree.plan.name, /Junction 2 Melodic/);
  });

  it("builds two campaigns from the Keywords tab", () => {
    assert.equal(tree.campaigns.length, 2);
    const names = tree.campaigns.map((c) => c.name).sort();
    assert.deepEqual(names, ["C1 Brand Defence", "C2 Adam Beyer"]);
  });

  it("attaches priority + monthly_budget from Overview", () => {
    const brand = tree.campaigns.find((c) => c.name === "C1 Brand Defence");
    assert.equal(brand?.priority, "MUST-RUN");
    assert.equal(brand?.monthly_budget, 1500);
    const beyer = tree.campaigns.find((c) => c.name === "C2 Adam Beyer");
    assert.equal(beyer?.priority, "HIGHEST");
    assert.equal(beyer?.monthly_budget, 800);
  });

  it("normalises match types and skips duplicates / orphans / unknown types", () => {
    const brand = tree.campaigns.find((c) => c.name === "C1 Brand Defence");
    assert.equal(brand?.ad_groups.length, 1);
    const ag = brand?.ad_groups[0];
    assert.equal(ag?.name, "Brand");
    assert.equal(ag?.keywords.length, 2); // duplicate skipped, others valid
    assert.deepEqual(
      ag?.keywords.map((k) => [k.keyword, k.match_type]),
      [
        ["junction 2 melodic", "EXACT"],
        ["junction 2 melodic tickets", "PHRASE"],
      ],
    );

    const beyer = tree.campaigns.find((c) => c.name === "C2 Adam Beyer");
    assert.equal(beyer?.ad_groups[0]?.keywords.length, 2); // Wibble row dropped
    assert.deepEqual(
      beyer?.ad_groups[0]?.keywords.map((k) => k.match_type),
      ["PHRASE", "BROAD"],
    );
  });

  it("groups Ad Copy headlines + descriptions per campaign and attaches as RSA", () => {
    const brand = tree.campaigns.find((c) => c.name === "C1 Brand Defence");
    assert.equal(brand?.ad_groups[0]?.rsas.length, 1);
    const rsa = brand?.ad_groups[0]?.rsas[0];
    assert.equal(rsa?.headlines.length, 3);
    assert.equal(rsa?.descriptions.length, 2);
    assert.equal(rsa?.headlines[0]?.text, "Junction 2 Melodic");
  });

  it("flags overflow headlines/descriptions as warnings without dropping them", () => {
    const overflow = tree.warnings.find((w) => w.code === "headline_too_long");
    assert(overflow, "expected a headline_too_long warning");
    const brand = tree.campaigns.find((c) => c.name === "C1 Brand Defence");
    assert.equal(brand?.ad_groups[0]?.rsas[0]?.headlines.length, 3);
  });

  it("collects plan-scoped + campaign-scoped negatives with scope fallback for unknown campaigns", () => {
    assert.equal(tree.negatives.length, 4);
    const planScoped = tree.negatives.filter((n) => n.scope.kind === "plan").map((n) => n.keyword).sort();
    assert.deepEqual(planScoped, ["fallback", "free", "torrent"]);
    const campaignScoped = tree.negatives.filter((n) => n.scope.kind === "campaign");
    assert.equal(campaignScoped.length, 1);
    assert.equal(campaignScoped[0]?.keyword, "stream");
    assert.equal(
      campaignScoped[0]?.scope.kind === "campaign" ? campaignScoped[0].scope.campaign_name : null,
      "C2 Adam Beyer",
    );
  });

  it("emits warnings for orphan keywords, duplicates, unknown match types, and the unknown-campaign negative fallback", () => {
    const codes = tree.warnings.map((w) => w.code).sort();
    assert.ok(codes.includes("missing_campaign"));
    assert.ok(codes.includes("missing_ad_group"));
    assert.ok(codes.includes("duplicate_keyword"));
    assert.ok(codes.includes("unknown_match_type"));
    assert.ok(codes.includes("headline_too_long"));
  });
});

// ─── J2-realistic fixture (section banners + Campaign / Level + ALL CAMPAIGNS) ─

/**
 * Mirrors the layout of the real `J2_Melodic_Google_Search_Ad_Plan.xlsx`:
 *
 *   - Ad Copy tab uses full-width SECTION HEADER banner rows (e.g.
 *     `C1 – BRAND: JUNCTION 2`) above each block of headlines and
 *     descriptions; the Campaign column is BLANK on every H/D row.
 *   - The same campaign appears TWICE — once over its H1..Hn block,
 *     then again over its D1..Dn block.
 *   - Section banner casing / dash style intentionally differs from
 *     the Keywords tab to prove fuzzy matching works (banner `C1 –
 *     BRAND: JUNCTION 2` vs skeleton `C1 – Brand: Junction 2`).
 *   - Negative Keywords tab uses `Campaign / Level` as the scope
 *     header and `ALL CAMPAIGNS` as the plan-scope value.
 */
function buildJ2RealisticWorkbook(): Uint8Array {
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Junction 2: Melodic — Google Search Plan"],
      [],
      ["Campaign", "Focus", "Ad Groups", "Est. Monthly Budget", "Priority", "Notes"],
      ["C1 – Brand: Junction 2", "Brand", "1", 1500, "MUST-RUN", "Always-on"],
      ["C2 – Artist: Adam Beyer", "Headliner", "1", 800, "HIGHEST", "Lead"],
      ["C6 – Genre", "Genre", "1", 300, "MEDIUM", "Discovery"],
    ]),
    "Overview",
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Campaign", "Ad Group", "Keyword", "Match Type", "Est CPC Low", "Est CPC High", "Intent", "Notes"],
      ["C1 – Brand: Junction 2", "Brand", "junction 2 melodic", "[Exact]", 0.2, 0.4, "Brand", null],
      ["C2 – Artist: Adam Beyer", "Headliner", "adam beyer london", "Phrase", 0.5, 1.2, "Trans.", null],
      ["C6 – Genre", "Melodic Techno", "melodic techno london", "Phrase", 0.3, 0.7, "Disc.", null],
    ]),
    "Keywords",
  );

  // Ad Copy with section-banner rows. Each banner sits in the FIRST
  // cell (column A); H/D rows have a blank Campaign column.
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Junction 2: Melodic — Ad Copy"],
      ["Headlines: max 30 chars each · Descriptions: max 90 chars each"],
      [],
      ["Campaign", "Type", "Content", "Char Count"],
      ["C1 – BRAND: JUNCTION 2"], // banner row (Campaign cell blank in subsequent rows)
      ["", "H1", "Junction 2 Melodic", "18"],
      ["", "H2", "Tickets On Sale Now", "19"],
      ["", "H3", "Official Brand Page", "20"],
      ["C1 – BRAND: JUNCTION 2"], // SAME campaign appears AGAIN for the D-block
      ["", "D1", "Limited tickets remaining.", "26"],
      ["", "D2", "Book today and join the rave.", "29"],
      ["C2 – ARTIST: ADAM BEYER"], // banner row
      ["", "H1", "See Adam Beyer Live", "19"],
      ["", "H2", "London Show", "11"],
      ["", "D1", "Catch the techno don live.", "26"],
      ["C6 – GENRE"], // banner with the C-prefix only-resolvable case
      ["", "H1", "Melodic Techno Tickets", "22"],
      ["", "D1", "Discover new melodic acts.", "26"],
    ]),
    "Ad Copy",
  );

  // Negative Keywords with the J2 layout: title row, then a
  // `Campaign / Level` scope header, then `ALL CAMPAIGNS` rows + a
  // campaign-scoped row using a C-prefix.
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Junction 2: Melodic — Negative Keyword List"],
      [],
      ["Campaign / Level", "Negative Keyword", "Match Type", "Reason"],
      ["ALL CAMPAIGNS", "free", "Phrase", "Filter freeloaders"],
      ["ALL CAMPAIGNS", "torrent", "Broad", "Piracy filter"],
      ["ALL CAMPAIGNS", "lyrics", "Broad", "Information seekers"],
      ["C6 – Genre", "underground", "Phrase", "Avoid unrelated genres"],
    ]),
    "Negative Keywords",
  );

  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
}

describe("parseGoogleSearchPlanXlsx (J2 realistic — section banners + ALL CAMPAIGNS)", () => {
  const tree = parseGoogleSearchPlanXlsx(buildJ2RealisticWorkbook());

  it("imports three campaigns from the Keywords tab", () => {
    assert.equal(tree.campaigns.length, 3);
    assert.deepEqual(
      tree.campaigns.map((c) => c.name).sort(),
      ["C1 – Brand: Junction 2", "C2 – Artist: Adam Beyer", "C6 – Genre"],
    );
  });

  it("RSAs import via section-banner carry-forward (the Phase 5 bug fix)", () => {
    const c1 = tree.campaigns.find((c) => c.name === "C1 – Brand: Junction 2");
    const c1Rsa = c1?.ad_groups[0]?.rsas[0];
    assert.ok(c1Rsa, "C1 should have an RSA from the section-banner carry-forward");
    assert.equal(c1Rsa.headlines.length, 3);
    assert.equal(c1Rsa.descriptions.length, 2);
    assert.equal(c1Rsa.headlines[0].text, "Junction 2 Melodic");

    const c2 = tree.campaigns.find((c) => c.name === "C2 – Artist: Adam Beyer");
    const c2Rsa = c2?.ad_groups[0]?.rsas[0];
    assert.equal(c2Rsa?.headlines.length, 2);
    assert.equal(c2Rsa?.descriptions.length, 1);
  });

  it("a campaign appearing twice in Ad Copy (H-block then D-block) accumulates into ONE RSA", () => {
    const c1 = tree.campaigns.find((c) => c.name === "C1 – Brand: Junction 2");
    assert.equal(
      c1?.ad_groups[0]?.rsas.length,
      1,
      "duplicate section banners must accumulate into a single RSA, not two",
    );
    const rsa = c1?.ad_groups[0]?.rsas[0];
    // All H1/H2/H3 from before the D-block banner + both D1/D2 after.
    assert.equal(rsa?.headlines.length, 3);
    assert.equal(rsa?.descriptions.length, 2);
  });

  it("section-banner casing / dash differences still match the skeleton (fuzzy)", () => {
    // Skeleton: `C1 – Brand: Junction 2`. Banner: `C1 – BRAND: JUNCTION 2`.
    // Normalisation (lowercase + dash-collapse) must make them equal.
    const c1 = tree.campaigns.find((c) => c.name === "C1 – Brand: Junction 2");
    assert.ok(c1?.ad_groups[0]?.rsas[0], "fuzzy banner match must hit C1");
  });

  it("emits ZERO empty_rsa warnings on the realistic J2 fixture", () => {
    const emptyRsaWarnings = tree.warnings.filter((w) => w.code === "empty_rsa");
    assert.equal(
      emptyRsaWarnings.length,
      0,
      `expected no empty_rsa warnings; got ${emptyRsaWarnings.length}: ${JSON.stringify(emptyRsaWarnings)}`,
    );
  });

  it("Negative Keywords with `Campaign / Level` header + `ALL CAMPAIGNS` scope imports correctly", () => {
    // 3 plan-scoped (ALL CAMPAIGNS rows) + 1 campaign-scoped (C6).
    assert.equal(tree.negatives.length, 4);
    const planScoped = tree.negatives
      .filter((n) => n.scope.kind === "plan")
      .map((n) => n.keyword)
      .sort();
    assert.deepEqual(planScoped, ["free", "lyrics", "torrent"]);
    const c6 = tree.negatives.find((n) => n.scope.kind === "campaign");
    assert.equal(c6?.keyword, "underground");
    assert.equal(
      c6?.scope.kind === "campaign" ? c6.scope.campaign_name : null,
      "C6 – Genre",
      "C6 – Genre banner text should match the skeleton campaign exactly",
    );
  });
});

// ─── parseNegativesTab — header-not-found warning + scope helpers ────

describe("parseGoogleSearchPlanXlsx — negatives header-not-found warning", () => {
  it("emits negatives_header_not_found when the tab has no recognisable header", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([["Campaign", "Ad Group", "Keyword", "Match Type"], ["C1", "AG", "kw", "Exact"]]),
      "Keywords",
    );
    // Negatives tab with NO `Negative Keyword` or `Keyword` header row.
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([["Title row only"], ["random text"]]),
      "Negative Keywords",
    );
    const buf = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
    const tree = parseGoogleSearchPlanXlsx(buf);
    const codes = tree.warnings.map((w) => w.code);
    assert.ok(
      codes.includes("negatives_header_not_found"),
      `expected negatives_header_not_found in warnings; got ${codes.join(", ")}`,
    );
  });
});

describe("resolveNegativeScope (pure helper)", () => {
  const skeletonByExact = new Map<string, string>([
    [normaliseCampaignKey("C6 – Genre"), "C6 – Genre"],
    [normaliseCampaignKey("C1 – Brand: Junction 2"), "C1 – Brand: Junction 2"],
  ]);
  const skeletonByPrefix = new Map<string, string>([
    ["1", "C1 – Brand: Junction 2"],
    ["6", "C6 – Genre"],
  ]);
  const warnings: GoogleSearchImportWarning[] = [];

  it("maps ALL CAMPAIGNS → plan-scope", () => {
    const scope = resolveNegativeScope("ALL CAMPAIGNS", skeletonByExact, skeletonByPrefix, "kw", warnings);
    assert.equal(scope.kind, "plan");
  });

  it("maps All / all / plan / shared / empty → plan-scope", () => {
    for (const value of ["All", "all", "plan", "shared", "", "  "]) {
      const scope = resolveNegativeScope(value, skeletonByExact, skeletonByPrefix, "kw", warnings);
      assert.equal(scope.kind, "plan", `value "${value}" should be plan-scope`);
    }
  });

  it("maps anything starting with all (e.g. `all campaign`) → plan-scope", () => {
    const scope = resolveNegativeScope("all campaign", skeletonByExact, skeletonByPrefix, "kw", warnings);
    assert.equal(scope.kind, "plan");
  });

  it("matches a known campaign exactly (case-insensitive)", () => {
    const scope = resolveNegativeScope("C6 – Genre", skeletonByExact, skeletonByPrefix, "kw", warnings);
    assert.equal(scope.kind, "campaign");
    if (scope.kind === "campaign") assert.equal(scope.campaign_name, "C6 – Genre");
  });

  it("matches by C\\d+ prefix when the suffix differs", () => {
    const scope = resolveNegativeScope("C6 – DIFFERENT SUFFIX", skeletonByExact, skeletonByPrefix, "kw", warnings);
    assert.equal(scope.kind, "campaign");
    if (scope.kind === "campaign") assert.equal(scope.campaign_name, "C6 – Genre");
  });

  it("falls back to plan-scope + missing_campaign warning when nothing matches", () => {
    const local: GoogleSearchImportWarning[] = [];
    const scope = resolveNegativeScope("Unknown Campaign", skeletonByExact, skeletonByPrefix, "kw", local);
    assert.equal(scope.kind, "plan");
    assert.equal(local.length, 1);
    assert.equal(local[0].code, "missing_campaign");
  });
});

describe("normaliseCampaignKey", () => {
  it("collapses case, dashes (- – —), and whitespace", () => {
    assert.equal(normaliseCampaignKey("C1 – Brand: Junction 2"), "c1 - brand: junction 2");
    assert.equal(normaliseCampaignKey("C1 – BRAND: JUNCTION 2"), "c1 - brand: junction 2");
    assert.equal(normaliseCampaignKey("C1 — Brand: Junction 2"), "c1 - brand: junction 2");
    assert.equal(normaliseCampaignKey("  C1   –   Brand:  Junction 2  "), "c1 - brand: junction 2");
  });
});
