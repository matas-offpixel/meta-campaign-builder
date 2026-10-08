import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import * as XLSX from "xlsx";

import {
  detectWorkbookKind,
  detectWorkbookKindFromBuffer,
  headerKey,
  sheetTokens,
  tabsReadSuffix,
  unknownWorkbookMessage,
} from "../workbook.ts";
import { describeEmptyGoogleSearchImport, parseGoogleSearchPlanXlsx } from "../xlsx-import.ts";

function fixture(path: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(path, import.meta.url)));
}

const SEARCH_SHEETS = [
  "./fixtures/IRW0001_JamieJones_GoogleSearch_BuildSheet.xlsx",
  "./fixtures/IRW0004_CamelPhat_GoogleSearch_BuildSheet.xlsx",
  "./fixtures/IRW0005_AppetiteHalloween_GoogleSearch_BuildSheet.xlsx",
];
const VIDEO_SHEET = "../../google-video/__tests__/fixtures/IRW0004_CamelPhat_YouTubeVideo_BuildSheet.xlsx";

const KEYWORDS_HEADER = ["Campaign", "Ad Group", "Keyword", "Match Type"];
const KEYWORD_ROW = ["C1 Brand", "Brand", "camelphat ironworks", "Exact"];

function workbook(tabs: Record<string, unknown[][]>): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(tabs)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows.length ? rows : [["a", "b"]]), name);
  }
  return wb;
}

function bytes(wb: XLSX.WorkBook): Uint8Array {
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
}

describe("detectWorkbookKind", () => {
  for (const path of SEARCH_SHEETS) {
    it(`${path.split("/").pop()} is a search sheet`, () => {
      const detected = detectWorkbookKindFromBuffer(fixture(path));
      assert.equal(detected.kind, "search");
      assert.ok(detected.keywordRows > 0);
    });
  }

  it("the CamelPhat YouTube build sheet is a video sheet", () => {
    const detected = detectWorkbookKindFromBuffer(fixture(VIDEO_SHEET));
    assert.equal(detected.kind, "video");
    assert.deepEqual(detected.tabs, [
      "1 Summary",
      "2 Campaign Settings",
      "3 Targeting & Exclusions",
      "4 Placements",
      "5 Ad Copy & Creative",
      "6 Measurement",
      "7 Checklist",
    ]);
  });

  it("a negatives tab alone does not make a search sheet", () => {
    assert.equal(detectWorkbookKind(workbook({ Summary: [], "Negative Keywords": [] })).kind, "unknown");
  });

  it("a Keywords tab with keyword rows wins over Placements", () => {
    const detected = detectWorkbookKind(workbook({ "4 Keywords": [KEYWORDS_HEADER, KEYWORD_ROW], "4 Placements": [] }));
    assert.equal(detected.kind, "search");
    assert.equal(detected.keywordRows, 1);
  });

  it("an empty Keywords tab plus Placements is video", () => {
    const detected = detectWorkbookKind(workbook({ "4 Keywords": [KEYWORDS_HEADER], "4 Placements": [] }));
    assert.equal(detected.kind, "video");
    assert.equal(detected.keywordsTab, "4 Keywords");
    assert.equal(detected.keywordRows, 0);
  });

  for (const word of ["Video", "YouTube", "Maximum CPV, bid £0.03", "Skippable in-stream only"]) {
    it(`a Campaign Settings tab mentioning "${word}" is video`, () => {
      const wb = workbook({ "2 Campaign Settings": [["Setting", "Value"], ["Campaign type", word]] });
      assert.equal(detectWorkbookKind(wb).kind, "video");
    });
  }

  it("a Campaign Settings tab with no video words is not video", () => {
    const wb = workbook({ "2 Campaign Settings": [["Setting", "Value"], ["Campaign type", "Search"]] });
    assert.equal(detectWorkbookKind(wb).kind, "unknown");
  });

  it("an empty Keywords tab and no video signal stays search", () => {
    const detected = detectWorkbookKind(workbook({ "1 Overview": [], "4 Keywords": [KEYWORDS_HEADER] }));
    assert.equal(detected.kind, "search");
    assert.equal(detected.keywordRows, 0);
  });

  it("neither tab → unknown", () => {
    assert.equal(detectWorkbookKind(workbook({ Sheet1: [] })).kind, "unknown");
  });
});

describe("import messages", () => {
  it("unknown lists the tabs found and the tabs each kind needs", () => {
    const message = unknownWorkbookMessage(["Sheet1", "Notes"]);
    assert.match(message, /Tabs found: Sheet1, Notes\./);
    assert.match(
      message,
      /Search needs a Keywords tab \(optional: Campaigns, RSAs, Negatives, Budget & Phasing, Assets & Extensions\)\./,
    );
    assert.match(
      message,
      /Video needs a Placements tab \(optional: Campaign Settings, Targeting & Exclusions, Ad Copy & Creative\)\./,
    );
  });

  it("Search with 0 keyword rows keeps the message and names the tab read as Keywords", () => {
    const wb = workbook({ "1 Overview": [], "4 Keywords": [KEYWORDS_HEADER], "6 Negatives": [] });
    const detected = detectWorkbookKind(wb);
    const draft = parseGoogleSearchPlanXlsx(bytes(wb));
    assert.equal(draft.campaigns.length, 0);
    const message = `${describeEmptyGoogleSearchImport(draft.warnings)} ${tabsReadSuffix(detected)}`;
    assert.match(message, /^Parsed 0 campaigns\./);
    assert.match(message, /Tabs found: 1 Overview, 4 Keywords, 6 Negatives\. "4 Keywords" was read as the Keywords tab\.$/);
  });

  it("names no Keywords tab when none was read", () => {
    assert.equal(
      tabsReadSuffix({ tabs: ["Sheet1"], keywordsTab: null }),
      "Tabs found: Sheet1. No tab was read as the Keywords tab.",
    );
  });
});

describe("shared header helpers", () => {
  it("headerKey and sheetTokens normalise the way both importers expect", () => {
    assert.equal(headerKey("Max CPC cap (£)"), "maxcpccap");
    assert.equal(headerKey("URL / ID"), "urlid");
    assert.deepEqual(sheetTokens("5 Ad Copy & Creative"), ["5", "ad", "copy", "creative"]);
  });
});
