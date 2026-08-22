import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseSheetRows, filterNewRows, parseMultiFunnel } from "../sheet-parse.ts";

const CLIENT_ID = "test-client-id";

/**
 * Joe's actual sheet layout (7 columns):
 *   A=Nation  B=Location  C=Funnel  D=MediaType  E=AssetName  F=Link  G=Notes
 */
const JOE_HEADER = ["Nation", "Location", "Funnel", "Column 6", "Asset", "Link", "Notes"];
const JOE_ROW_VIDEO: string[] = ["England", "Brighton", "TOFU", "Video", "Brighton UGC FPV Videos", "https://dropbox.com/s/abc?dl=0", ""];
const JOE_ROW_GRAPHIC: string[] = ["Scotland", "Glasgow", "MOFU", "Graphic", "Quote - John McGinn", "https://dropbox.com/s/def?dl=0", "Use in retargeting"];

describe("parseSheetRows — Joe's 7-column layout", () => {
  it("reads mediaType from column D and assetName from column E", () => {
    const rows = parseSheetRows(CLIENT_ID, [JOE_HEADER, JOE_ROW_VIDEO]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].mediaType, "Video");
    assert.equal(rows[0].assetName, "Brighton UGC FPV Videos");
  });

  it("asset_name is never 'Graphic' or 'Video' (regression: was reading wrong column)", () => {
    const rows = parseSheetRows(CLIENT_ID, [JOE_HEADER, JOE_ROW_VIDEO, JOE_ROW_GRAPHIC]);
    for (const row of rows) {
      assert.notEqual(row.assetName, "Video");
      assert.notEqual(row.assetName, "Graphic");
    }
  });

  it("reads dropboxUrl from column F (not column E)", () => {
    const rows = parseSheetRows(CLIENT_ID, [JOE_HEADER, JOE_ROW_VIDEO]);
    assert.equal(rows[0].dropboxUrl, "https://dropbox.com/s/abc?dl=0");
  });

  it("reads notes from column G", () => {
    const rows = parseSheetRows(CLIENT_ID, [JOE_HEADER, JOE_ROW_GRAPHIC]);
    assert.equal(rows[0].notes, "Use in retargeting");
  });

  it("parses both rows correctly from a real sheet snapshot", () => {
    const rows = parseSheetRows(CLIENT_ID, [JOE_HEADER, JOE_ROW_VIDEO, JOE_ROW_GRAPHIC]);
    assert.equal(rows.length, 2);

    assert.equal(rows[0].nation, "England");
    assert.equal(rows[0].location, "Brighton");
    assert.equal(rows[0].funnel, "TOFU");
    assert.equal(rows[0].mediaType, "Video");
    assert.equal(rows[0].assetName, "Brighton UGC FPV Videos");
    assert.equal(rows[0].dropboxUrl, "https://dropbox.com/s/abc?dl=0");
    assert.equal(rows[0].notes, "");

    assert.equal(rows[1].nation, "Scotland");
    assert.equal(rows[1].location, "Glasgow");
    assert.equal(rows[1].funnel, "MOFU");
    assert.equal(rows[1].mediaType, "Graphic");
    assert.equal(rows[1].assetName, "Quote - John McGinn");
    assert.equal(rows[1].dropboxUrl, "https://dropbox.com/s/def?dl=0");
    assert.equal(rows[1].notes, "Use in retargeting");
  });

  it("skips header row", () => {
    assert.equal(parseSheetRows(CLIENT_ID, [JOE_HEADER]).length, 0);
  });

  it("skips fully empty rows", () => {
    const raw = [JOE_ROW_VIDEO, ["", "", "", "", "", "", ""], ["", "", "", "", "", "", ""]];
    assert.equal(parseSheetRows(CLIENT_ID, raw).length, 1);
  });

  it("skips rows where both assetName (col E) and dropboxUrl (col F) are empty", () => {
    const raw = [["England", "Brighton", "TOFU", "Video", "", "", "note"]];
    assert.equal(parseSheetRows(CLIENT_ID, raw).length, 0);
  });

  it("normalises extra whitespace in all cells", () => {
    const raw = [["  England  ", " Brighton ", "  TOFU  ", "  Video  ", "  My Asset  ", "https://dropbox.com/s/x", " note "]];
    const rows = parseSheetRows(CLIENT_ID, raw);
    assert.equal(rows[0].mediaType, "Video");
    assert.equal(rows[0].assetName, "My Asset");
    assert.equal(rows[0].notes, "note");
  });

  it("handles short rows gracefully (fewer than 7 columns)", () => {
    assert.equal(parseSheetRows(CLIENT_ID, [["England", "Brighton", "TOFU"]]).length, 0);
  });

  it("handles rows with mediaType but missing assetName (col E empty, col F has URL)", () => {
    const raw = [["England", "Brighton", "TOFU", "Video", "", "https://dropbox.com/s/x", ""]];
    const rows = parseSheetRows(CLIENT_ID, raw);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].assetName, "");
    assert.equal(rows[0].mediaType, "Video");
  });

  it("produces deterministic hashes for the same row", () => {
    const r1 = parseSheetRows(CLIENT_ID, [JOE_ROW_VIDEO]);
    const r2 = parseSheetRows(CLIENT_ID, [JOE_ROW_VIDEO]);
    assert.equal(r1[0].rowHash, r2[0].rowHash);
  });

  it("produces different hashes for different clients", () => {
    const r1 = parseSheetRows("client-a", [JOE_ROW_VIDEO]);
    const r2 = parseSheetRows("client-b", [JOE_ROW_VIDEO]);
    assert.notEqual(r1[0].rowHash, r2[0].rowHash);
  });

  it("hash includes assetName (col E), not mediaType (col D)", () => {
    const rowA = [...JOE_ROW_VIDEO];
    const rowB = [...JOE_ROW_VIDEO];
    rowB[3] = "Graphic";
    const r1 = parseSheetRows(CLIENT_ID, [rowA]);
    const r2 = parseSheetRows(CLIENT_ID, [rowB]);
    assert.equal(r1[0].rowHash, r2[0].rowHash);

    const rowC = [...JOE_ROW_VIDEO];
    rowC[4] = "Different Asset Name";
    const r3 = parseSheetRows(CLIENT_ID, [rowC]);
    assert.notEqual(r1[0].rowHash, r3[0].rowHash);
  });
});

describe("parseMultiFunnel", () => {
  it("single TOFU → funnel=TOFU, funnels=[TOFU]", () => {
    const result = parseMultiFunnel("TOFU");
    assert.equal(result.funnel, "TOFU");
    assert.deepEqual(result.funnels, ["TOFU"]);
  });

  it("comma-separated TOFU,MOFU → funnel=MOFU (higher intent)", () => {
    const result = parseMultiFunnel("TOFU, MOFU");
    assert.equal(result.funnel, "MOFU");
    assert.ok(result.funnels.includes("TOFU"));
    assert.ok(result.funnels.includes("MOFU"));
  });

  it("TOFU,MOFU,BOFU → funnel=BOFU (highest intent)", () => {
    assert.equal(parseMultiFunnel("TOFU, MOFU, BOFU").funnel, "BOFU");
  });

  it("is case-insensitive", () => {
    assert.equal(parseMultiFunnel("tofu, bofu").funnel, "BOFU");
  });

  it("deduplicates repeated labels", () => {
    const result = parseMultiFunnel("MOFU, MOFU");
    assert.equal(result.funnels.length, 1);
  });

  it("handles unknown label gracefully", () => {
    const result = parseMultiFunnel("CUSTOM");
    assert.equal(result.funnel, "CUSTOM");
    assert.deepEqual(result.funnels, ["CUSTOM"]);
  });

  it("handles empty string", () => {
    const result = parseMultiFunnel("");
    assert.equal(result.funnel, "");
    assert.equal(result.funnels.length, 0);
  });
});

describe("parseSheetRows — multi-funnel column C", () => {
  it("sets funnel to highest-intent when column C has comma-separated values", () => {
    const raw = [["England", "Brighton", "TOFU, MOFU", "Video", "My Asset", "https://dropbox.com/s/x", ""]];
    const rows = parseSheetRows(CLIENT_ID, raw);
    assert.equal(rows[0].funnel, "MOFU");
    assert.deepEqual(rows[0].funnels, ["TOFU", "MOFU"]);
  });

  it("single funnel row still populates funnels array", () => {
    const rows = parseSheetRows(CLIENT_ID, [JOE_ROW_VIDEO]);
    assert.deepEqual(rows[0].funnels, ["TOFU"]);
  });
});

describe("filterNewRows", () => {
  it("filters out known hashes", () => {
    const rows = parseSheetRows(CLIENT_ID, [JOE_ROW_VIDEO, JOE_ROW_GRAPHIC]);
    const known = new Set([rows[0].rowHash]);
    const filtered = filterNewRows(rows, known);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].assetName, "Quote - John McGinn");
  });

  it("returns all rows when no known hashes", () => {
    const rows = parseSheetRows(CLIENT_ID, [JOE_ROW_VIDEO]);
    assert.equal(filterNewRows(rows, new Set()).length, 1);
  });
});
