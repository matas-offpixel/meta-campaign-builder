import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import * as XLSX from "xlsx";

import {
  classifyCharOverflow,
  normaliseMatchType,
  parseGoogleSearchPlanXlsx,
} from "../xlsx-import.ts";

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
