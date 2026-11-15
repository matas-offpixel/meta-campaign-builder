import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import * as XLSX from "xlsx";

import { resolveImportedGeoTargets } from "../import-geo.ts";
import { parseGoogleSearchPlanXlsx } from "../xlsx-import.ts";

const KEYWORDS = [
  ["Campaign", "Ad Group", "Keyword", "Match Type"],
  ["C1 Brand", "Brand", "folamour tickets", "Exact"],
];

function bytes(tabs: Record<string, unknown[][]>): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(tabs)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
}

function locationsSheet(rows: unknown[][]): Record<string, unknown[][]> {
  return {
    Keywords: KEYWORDS,
    Locations: [["Location", "Bid modifier (%)", "Targeting"], ...rows],
  };
}

describe("Locations tab", () => {
  it("reads three unresolved rows", () => {
    const tree = parseGoogleSearchPlanXlsx(bytes(locationsSheet([
      ["Tyne and Wear", "", "Presence"],
      ["Northumberland", "", "Presence"],
      ["County Durham", "", "Presence"],
    ])));
    assert.deepEqual(
      tree.plan.geo_targets.map((g) => g.location),
      ["Tyne and Wear", "Northumberland", "County Durham"],
    );
    assert.ok(tree.plan.geo_targets.every((g) => g.resolved_resource_name === undefined));
    assert.equal(tree.plan.geo_targets.length, 3);
    assert.equal(tree.campaigns[0]?.ad_groups[0]?.keywords.length, 1);
  });

  it("parses +20 / -10 / blank, and warns geo_bad_modifier for abc", () => {
    const tree = parseGoogleSearchPlanXlsx(bytes(locationsSheet([
      ["London", "+20", ""],
      ["Manchester", "-10", ""],
      ["Leeds", "", ""],
      ["Bristol", "abc", ""],
    ])));
    assert.deepEqual(
      tree.plan.geo_targets.map((g) => [g.location, g.bid_modifier_pct]),
      [
        ["London", 20],
        ["Manchester", -10],
        ["Leeds", null],
        ["Bristol", null],
      ],
    );
    const bad = tree.warnings.filter((w) => w.code === "geo_bad_modifier");
    assert.equal(bad.length, 1);
    assert.match(bad[0]!.message, /abc/);
    assert.match(bad[0]!.message, /Bristol/);
  });

  it("Targeting: Presence sets geo_target_type, and Presence or interest does too", () => {
    const presence = parseGoogleSearchPlanXlsx(bytes(locationsSheet([["London", "", "Presence"]])));
    assert.equal(presence.plan.geo_target_type, "PRESENCE");
    const interest = parseGoogleSearchPlanXlsx(
      bytes(locationsSheet([["London", "", "Presence or interest"]])),
    );
    assert.equal(interest.plan.geo_target_type, "PRESENCE_OR_INTEREST");
  });

  it("warns geo_duplicate and keeps the first row", () => {
    const tree = parseGoogleSearchPlanXlsx(bytes(locationsSheet([
      ["London", "+20", "Presence"],
      ["london", "-10", ""],
    ])));
    assert.equal(tree.plan.geo_targets.length, 1);
    assert.equal(tree.plan.geo_targets[0]?.bid_modifier_pct, 20);
    assert.ok(tree.warnings.some((w) => w.code === "geo_duplicate"));
  });

  it("warns geo_tab_empty when the Locations tab has no rows", () => {
    const tree = parseGoogleSearchPlanXlsx(bytes({
      Keywords: KEYWORDS,
      Locations: [["Location", "Bid modifier (%)", "Targeting"]],
    }));
    assert.deepEqual(tree.plan.geo_targets, []);
    assert.ok(tree.warnings.some((w) => w.code === "geo_tab_empty"));
    assert.ok(!tree.warnings.some((w) => w.code === "geo_none"));
  });

  it("no Locations tab warns geo_none", () => {
    const tree = parseGoogleSearchPlanXlsx(bytes({ Keywords: KEYWORDS }));
    assert.deepEqual(tree.plan.geo_targets, []);
    const warning = tree.warnings.find((w) => w.code === "geo_none");
    assert.equal(warning?.message, "No locations in the sheet — add them in the Budget step before push.");
  });

  it("does not take Campaigns, Keywords, Negative Keywords, Targeting & Exclusions, or Targeting & Budget", () => {
    const tree = parseGoogleSearchPlanXlsx(bytes({
      Keywords: KEYWORDS,
      Campaigns: [
        ["Campaign", "Status at launch", "Max CPC cap (£)"],
        ["C1 Brand", "Enabled", 1.5],
      ],
      "Negative Keywords": [
        ["Scope", "Negative Keyword", "Match Type"],
        ["All", "free", "Phrase"],
      ],
      "Targeting & Exclusions": [
        ["Location", "Bid modifier (%)", "Targeting"],
        ["Should Not Import", "+50", "Presence"],
      ],
      "Targeting & Budget": [
        ["Total Google Search budget (£)", 400],
        ["Location", "Bid modifier (%)", "Targeting"],
        ["Also Not A Location Tab", "", "Presence"],
      ],
      Geo: [
        ["Location", "Targeting"],
        ["Newcastle", "Presence"],
      ],
    }));
    assert.equal(tree.campaigns[0]?.ad_groups[0]?.keywords[0]?.keyword, "folamour tickets");
    assert.equal(tree.campaigns[0]?.bid_adjustments.max_cpc_cap, 1.5);
    assert.equal(tree.negatives.length, 1);
    assert.equal(tree.negatives[0]?.keyword, "free");
    assert.equal(tree.plan.total_budget, 400);
    assert.deepEqual(tree.plan.geo_targets.map((g) => g.location), ["Newcastle"]);
    assert.ok(!tree.warnings.some((w) => w.code === "geo_none"));

    const named = parseGoogleSearchPlanXlsx(bytes({
      Keywords: KEYWORDS,
      Locations: [["Location", "Targeting"], ["Gateshead", "Presence"]],
    }));
    assert.deepEqual(named.plan.geo_targets.map((g) => g.location), ["Gateshead"]);
  });

  it("the parser makes no network call", () => {
    const source = readFileSync(new URL("../xlsx-import.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /geo-resolve|GoogleAdsClient|fetch\(/);
  });
});

describe("Folamour fixture", () => {
  it("reads Tyne and Wear, Northumberland and County Durham as Presence", () => {
    const buf = new Uint8Array(readFileSync(new URL("./fixtures/261023-folamour-google-search.xlsx", import.meta.url)));
    const tree = parseGoogleSearchPlanXlsx(buf);
    assert.equal(tree.plan.geo_target_type, "PRESENCE");
    assert.deepEqual(
      tree.plan.geo_targets.map((g) => [g.location, g.bid_modifier_pct, g.resolved_resource_name]),
      [
        ["Tyne and Wear", null, undefined],
        ["Northumberland", null, undefined],
        ["County Durham", null, undefined],
      ],
    );
  });
});

describe("import route resolution", () => {
  function parsed() {
    return parseGoogleSearchPlanXlsx(bytes(locationsSheet([
      ["Tyne and Wear", "", "Presence"],
      ["Northumberland", "", "Presence"],
      ["County Durham", "", "Presence"],
    ])));
  }

  it("writes the wizard shape when every row resolves", async () => {
    const tree = parsed();
    await resolveImportedGeoTargets(tree, async (names) =>
      names.map((name) => ({
        resourceName: `geoTargetConstants/${name.length}`,
        canonicalName: `${name}, England, United Kingdom`,
        countryCode: "GB",
        targetType: "County",
        source: "suggest" as const,
      })),
    );
    assert.deepEqual(
      tree.plan.geo_targets.map((g) => [g.location, g.resolved_resource_name, g.resolved_name]),
      [
        ["Tyne and Wear", "geoTargetConstants/13", "Tyne and Wear, England, United Kingdom"],
        ["Northumberland", "geoTargetConstants/14", "Northumberland, England, United Kingdom"],
        ["County Durham", "geoTargetConstants/13", "County Durham, England, United Kingdom"],
      ],
    );
    assert.ok(!tree.warnings.some((w) => w.code === "geo_unresolved" || w.code === "geo_resolve_failed"));
  });

  it("stores null and warns geo_unresolved for the row that did not match", async () => {
    const tree = parsed();
    await resolveImportedGeoTargets(tree, async (names) =>
      names.map((name, i) =>
        i === 1
          ? null
          : {
              resourceName: `geoTargetConstants/${i}`,
              canonicalName: name,
              countryCode: "GB",
              targetType: "County",
              source: "suggest" as const,
            },
      ),
    );
    assert.equal(tree.plan.geo_targets[0]?.resolved_resource_name, "geoTargetConstants/0");
    assert.equal(tree.plan.geo_targets[1]?.resolved_resource_name, null);
    assert.equal(tree.plan.geo_targets[1]?.resolved_name, null);
    const unresolved = tree.warnings.filter((w) => w.code === "geo_unresolved");
    assert.equal(unresolved.length, 1);
    assert.match(unresolved[0]!.message, /Northumberland/);
  });

  it("still imports when the resolver throws, with geo_resolve_failed and the rows unresolved", async () => {
    const tree = parsed();
    await resolveImportedGeoTargets(tree, async () => {
      throw new Error("Google Ads unreachable");
    });
    assert.ok(tree.plan.geo_targets.every((g) => g.resolved_resource_name === undefined));
    assert.equal(tree.plan.geo_targets.length, 3);
    assert.ok(tree.warnings.some((w) => w.code === "geo_resolve_failed"));
    assert.ok(!tree.warnings.some((w) => w.code === "geo_unresolved"));
  });
});
