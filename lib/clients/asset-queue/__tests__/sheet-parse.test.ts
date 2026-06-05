import { parseSheetRows, filterNewRows } from "../sheet-parse";

const CLIENT_ID = "test-client-id";

describe("parseSheetRows", () => {
  it("parses a well-formed sheet correctly", () => {
    const raw = [
      ["Nation", "Location", "Funnel", "Asset name", "Dropbox link", "Notes"],
      ["England", "Brighton", "TOFU", "Brighton Hype Video", "https://dropbox.com/s/abc?dl=0", ""],
      ["Scotland", "Edinburgh", "BOFU", "Eddy Promo", "https://dropbox.com/s/def?dl=0", "Use in retargeting"],
    ];
    const rows = parseSheetRows(CLIENT_ID, raw);
    expect(rows).toHaveLength(2);
    expect(rows[0].nation).toBe("England");
    expect(rows[0].location).toBe("Brighton");
    expect(rows[0].funnel).toBe("TOFU");
    expect(rows[0].assetName).toBe("Brighton Hype Video");
    expect(rows[0].dropboxUrl).toBe("https://dropbox.com/s/abc?dl=0");
    expect(rows[0].rowHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("skips header row", () => {
    const raw = [
      ["Nation", "Location", "Funnel", "Asset Name", "Dropbox Link", "Notes"],
    ];
    expect(parseSheetRows(CLIENT_ID, raw)).toHaveLength(0);
  });

  it("skips fully empty rows", () => {
    const raw = [
      ["England", "Brighton", "TOFU", "Some Asset", "https://dropbox.com/s/abc", ""],
      ["", "", "", "", "", ""],
      ["", "", "", "", "", ""],
    ];
    expect(parseSheetRows(CLIENT_ID, raw)).toHaveLength(1);
  });

  it("skips rows with no asset name and no dropbox url", () => {
    const raw = [["England", "Brighton", "TOFU", "", "", ""]];
    expect(parseSheetRows(CLIENT_ID, raw)).toHaveLength(0);
  });

  it("normalises extra whitespace in cells", () => {
    const raw = [["  England  ", " Brighton ", "  TOFU  ", "  My Asset  ", "https://dropbox.com/s/x", " note "]];
    const rows = parseSheetRows(CLIENT_ID, raw);
    expect(rows[0].nation).toBe("England");
    expect(rows[0].location).toBe("Brighton");
    expect(rows[0].assetName).toBe("My Asset");
    expect(rows[0].notes).toBe("note");
  });

  it("handles 'All' location without error", () => {
    const raw = [["All", "All", "TOFU", "Global Asset", "https://dropbox.com/s/g", ""]];
    const rows = parseSheetRows(CLIENT_ID, raw);
    expect(rows).toHaveLength(1);
    expect(rows[0].location).toBe("All");
  });

  it("handles missing columns gracefully (short rows)", () => {
    const raw = [["England", "Brighton", "TOFU"]]; // only 3 cells
    const rows = parseSheetRows(CLIENT_ID, raw);
    // No assetName or dropboxUrl → skipped
    expect(rows).toHaveLength(0);
  });

  it("produces deterministic hashes for the same row", () => {
    const raw = [["England", "Brighton", "TOFU", "Asset", "https://dropbox.com/s/abc", ""]];
    const r1 = parseSheetRows(CLIENT_ID, raw);
    const r2 = parseSheetRows(CLIENT_ID, raw);
    expect(r1[0].rowHash).toBe(r2[0].rowHash);
  });

  it("produces different hashes for different clients", () => {
    const raw = [["England", "Brighton", "TOFU", "Asset", "https://dropbox.com/s/abc", ""]];
    const r1 = parseSheetRows("client-a", raw);
    const r2 = parseSheetRows("client-b", raw);
    expect(r1[0].rowHash).not.toBe(r2[0].rowHash);
  });
});

describe("filterNewRows", () => {
  it("filters out known hashes", () => {
    const raw = [
      ["England", "Brighton", "TOFU", "Asset A", "https://dropbox.com/s/a", ""],
      ["Scotland", "Glasgow", "MOFU", "Asset B", "https://dropbox.com/s/b", ""],
    ];
    const rows = parseSheetRows(CLIENT_ID, raw);
    const known = new Set([rows[0].rowHash]);
    const filtered = filterNewRows(rows, known);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].assetName).toBe("Asset B");
  });

  it("returns all rows when no known hashes", () => {
    const raw = [
      ["England", "Brighton", "TOFU", "Asset A", "https://dropbox.com/s/a", ""],
    ];
    const rows = parseSheetRows(CLIENT_ID, raw);
    expect(filterNewRows(rows, new Set())).toHaveLength(1);
  });
});
