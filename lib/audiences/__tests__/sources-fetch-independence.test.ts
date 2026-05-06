import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function sliceBetween(
  source: string,
  startMarker: string,
  endMarker: string,
): string {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `missing ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end >= 0, `missing ${endMarker}`);
  return source.slice(start, end);
}

describe("fetchAudiencePageSources vs campaigns fetch", () => {
  it("page source helper does not touch campaigns edge or campaign insights", () => {
    const sources = readFileSync("lib/audiences/sources.ts", "utf8");
    const pageFn = sliceBetween(
      sources,
      "export async function fetchAudiencePageSources",
      "export async function fetchAudiencePixels",
    );
    assert.doesNotMatch(pageFn, /\/campaigns/);
    assert.doesNotMatch(pageFn, /fetchAudienceCampaigns/);
    assert.doesNotMatch(pageFn, /insights\.date_preset/);
  });

});
