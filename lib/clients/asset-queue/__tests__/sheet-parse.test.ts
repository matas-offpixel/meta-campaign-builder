import { parseSheetRows, filterNewRows } from "../sheet-parse";

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
    expect(rows).toHaveLength(1);
    expect(rows[0].mediaType).toBe("Video");
    expect(rows[0].assetName).toBe("Brighton UGC FPV Videos");
  });

  it("asset_name is never 'Graphic' or 'Video' (regression: was reading wrong column)", () => {
    const rows = parseSheetRows(CLIENT_ID, [JOE_HEADER, JOE_ROW_VIDEO, JOE_ROW_GRAPHIC]);
    for (const row of rows) {
      expect(row.assetName).not.toBe("Video");
      expect(row.assetName).not.toBe("Graphic");
    }
  });

  it("reads dropboxUrl from column F (not column E)", () => {
    const rows = parseSheetRows(CLIENT_ID, [JOE_HEADER, JOE_ROW_VIDEO]);
    expect(rows[0].dropboxUrl).toBe("https://dropbox.com/s/abc?dl=0");
  });

  it("reads notes from column G", () => {
    const rows = parseSheetRows(CLIENT_ID, [JOE_HEADER, JOE_ROW_GRAPHIC]);
    expect(rows[0].notes).toBe("Use in retargeting");
  });

  it("parses both rows correctly from a real sheet snapshot", () => {
    const rows = parseSheetRows(CLIENT_ID, [JOE_HEADER, JOE_ROW_VIDEO, JOE_ROW_GRAPHIC]);
    expect(rows).toHaveLength(2);

    expect(rows[0]).toMatchObject({
      nation: "England",
      location: "Brighton",
      funnel: "TOFU",
      mediaType: "Video",
      assetName: "Brighton UGC FPV Videos",
      dropboxUrl: "https://dropbox.com/s/abc?dl=0",
      notes: "",
    });

    expect(rows[1]).toMatchObject({
      nation: "Scotland",
      location: "Glasgow",
      funnel: "MOFU",
      mediaType: "Graphic",
      assetName: "Quote - John McGinn",
      dropboxUrl: "https://dropbox.com/s/def?dl=0",
      notes: "Use in retargeting",
    });
  });

  it("skips header row", () => {
    expect(parseSheetRows(CLIENT_ID, [JOE_HEADER])).toHaveLength(0);
  });

  it("skips fully empty rows", () => {
    const raw = [JOE_ROW_VIDEO, ["", "", "", "", "", "", ""], ["", "", "", "", "", "", ""]];
    expect(parseSheetRows(CLIENT_ID, raw)).toHaveLength(1);
  });

  it("skips rows where both assetName (col E) and dropboxUrl (col F) are empty", () => {
    const raw = [["England", "Brighton", "TOFU", "Video", "", "", "note"]];
    expect(parseSheetRows(CLIENT_ID, raw)).toHaveLength(0);
  });

  it("normalises extra whitespace in all cells", () => {
    const raw = [["  England  ", " Brighton ", "  TOFU  ", "  Video  ", "  My Asset  ", "https://dropbox.com/s/x", " note "]];
    const rows = parseSheetRows(CLIENT_ID, raw);
    expect(rows[0].mediaType).toBe("Video");
    expect(rows[0].assetName).toBe("My Asset");
    expect(rows[0].notes).toBe("note");
  });

  it("handles short rows gracefully (fewer than 7 columns)", () => {
    // Only 3 columns — no assetName or dropboxUrl → skipped
    expect(parseSheetRows(CLIENT_ID, [["England", "Brighton", "TOFU"]])).toHaveLength(0);
  });

  it("handles rows with mediaType but missing assetName (col E empty, col F has URL)", () => {
    // dropboxUrl present → row kept, assetName is empty string
    const raw = [["England", "Brighton", "TOFU", "Video", "", "https://dropbox.com/s/x", ""]];
    const rows = parseSheetRows(CLIENT_ID, raw);
    expect(rows).toHaveLength(1);
    expect(rows[0].assetName).toBe("");
    expect(rows[0].mediaType).toBe("Video");
  });

  it("produces deterministic hashes for the same row", () => {
    const r1 = parseSheetRows(CLIENT_ID, [JOE_ROW_VIDEO]);
    const r2 = parseSheetRows(CLIENT_ID, [JOE_ROW_VIDEO]);
    expect(r1[0].rowHash).toBe(r2[0].rowHash);
  });

  it("produces different hashes for different clients", () => {
    const r1 = parseSheetRows("client-a", [JOE_ROW_VIDEO]);
    const r2 = parseSheetRows("client-b", [JOE_ROW_VIDEO]);
    expect(r1[0].rowHash).not.toBe(r2[0].rowHash);
  });

  it("hash includes assetName (col E), not mediaType (col D)", () => {
    // Same row but different mediaType → same hash (mediaType not hashed)
    const rowA = [...JOE_ROW_VIDEO]; // mediaType = "Video"
    const rowB = [...JOE_ROW_VIDEO];
    rowB[3] = "Graphic"; // change mediaType only
    const r1 = parseSheetRows(CLIENT_ID, [rowA]);
    const r2 = parseSheetRows(CLIENT_ID, [rowB]);
    expect(r1[0].rowHash).toBe(r2[0].rowHash);

    // Different assetName → different hash
    const rowC = [...JOE_ROW_VIDEO];
    rowC[4] = "Different Asset Name"; // change assetName
    const r3 = parseSheetRows(CLIENT_ID, [rowC]);
    expect(r1[0].rowHash).not.toBe(r3[0].rowHash);
  });
});

describe("filterNewRows", () => {
  it("filters out known hashes", () => {
    const rows = parseSheetRows(CLIENT_ID, [JOE_ROW_VIDEO, JOE_ROW_GRAPHIC]);
    const known = new Set([rows[0].rowHash]);
    const filtered = filterNewRows(rows, known);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].assetName).toBe("Quote - John McGinn");
  });

  it("returns all rows when no known hashes", () => {
    const rows = parseSheetRows(CLIENT_ID, [JOE_ROW_VIDEO]);
    expect(filterNewRows(rows, new Set())).toHaveLength(1);
  });
});
