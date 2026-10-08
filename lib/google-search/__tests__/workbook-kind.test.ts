import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import * as XLSX from "xlsx";

import {
  detectWorkbookKind,
  detectWorkbookKindFromBuffer,
  headerKey,
  sheetTokens,
  videoWorkbookMessage,
} from "../workbook.ts";
import { parseGoogleSearchPlanXlsx } from "../xlsx-import.ts";

function fixture(path: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(path, import.meta.url)));
}

const SEARCH_SHEETS = [
  "./fixtures/IRW0001_JamieJones_GoogleSearch_BuildSheet.xlsx",
  "./fixtures/IRW0004_CamelPhat_GoogleSearch_BuildSheet.xlsx",
  "./fixtures/IRW0005_AppetiteHalloween_GoogleSearch_BuildSheet.xlsx",
];
const VIDEO_SHEET = "../../google-video/__tests__/fixtures/IRW0004_CamelPhat_YouTubeVideo_BuildSheet.xlsx";

function workbookWithTabs(names: string[]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  for (const name of names) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["a", "b"]]), name);
  return wb;
}

describe("detectWorkbookKind", () => {
  for (const path of SEARCH_SHEETS) {
    it(`${path.split("/").pop()} is a search sheet`, () => {
      assert.equal(detectWorkbookKindFromBuffer(fixture(path)).kind, "search");
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
    assert.equal(detectWorkbookKind(workbookWithTabs(["Summary", "Negative Keywords"])).kind, "unknown");
  });

  it("keywords win over placements", () => {
    assert.equal(detectWorkbookKind(workbookWithTabs(["Keywords", "Placements"])).kind, "search");
  });

  it("neither tab → unknown, and the Search importer still runs as before", () => {
    const wb = workbookWithTabs(["Sheet1"]);
    assert.equal(detectWorkbookKind(wb).kind, "unknown");
    const buf = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
    assert.equal(parseGoogleSearchPlanXlsx(buf).campaigns.length, 0);
  });

  it("names the tabs in the refusal", () => {
    assert.match(videoWorkbookMessage(["4 Placements", "5 Ad Copy & Creative"]), /tabs: 4 Placements, 5 Ad Copy & Creative/);
  });
});

describe("shared header helpers", () => {
  it("headerKey and sheetTokens normalise the way both importers expect", () => {
    assert.equal(headerKey("Max CPC cap (£)"), "maxcpccap");
    assert.equal(headerKey("URL / ID"), "urlid");
    assert.deepEqual(sheetTokens("5 Ad Copy & Creative"), ["5", "ad", "copy", "creative"]);
  });
});
