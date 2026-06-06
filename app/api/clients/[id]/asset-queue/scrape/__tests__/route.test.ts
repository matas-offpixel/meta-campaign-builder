/**
 * Tests for POST /api/clients/[id]/asset-queue/scrape
 *
 * Focuses on: dedup by hash, RLS scoping, private-sheet error, CSV parse path.
 * Supabase is mocked; fetch is mocked via jest.spyOn(global, "fetch").
 */

import { NextRequest } from "next/server";

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockGetUser = jest.fn();
const mockFrom = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(() => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  })),
  createServiceRoleClient: jest.fn(),
}));

jest.mock("@/lib/db/asset-sheet-config", () => ({
  getAssetSheetConfig: jest.fn(),
  touchLastScrapedAt: jest.fn(),
}));

jest.mock("@/lib/db/venue-mappings", () => ({
  listVenueMappings: jest.fn(),
}));

jest.mock("@/lib/db/asset-queue", () => ({
  getExistingHashes: jest.fn(),
  insertQueueRows: jest.fn(),
}));

import { POST } from "../route";
import { getAssetSheetConfig, touchLastScrapedAt } from "@/lib/db/asset-sheet-config";
import { listVenueMappings } from "@/lib/db/venue-mappings";
import { getExistingHashes, insertQueueRows } from "@/lib/db/asset-queue";

const CLIENT_ID = "client-uuid-123";
const USER_ID = "user-uuid-456";

/** Joe's 7-column CSV format: Nation,Location,Funnel,MediaType,AssetName,Link,Notes */
const SHEET_CSV_TWO_ROWS = [
  "Nation,Location,Funnel,Column 6,Asset,Link,Notes",
  "England,Brighton,TOFU,Video,Asset A,https://db.com/s/a,",
  "Scotland,Glasgow,MOFU,Graphic,Asset B,https://db.com/s/b,",
].join("\n");

const SHEET_CSV_ONE_ROW = [
  "England,Liverpool,BOFU,Video,Some Asset,https://db.com/s/x,",
].join("\n");

function mockFetchOk(csv: string) {
  jest.spyOn(global, "fetch").mockResolvedValueOnce(
    new Response(csv, { status: 200 }),
  );
}

function mockFetchStatus(status: number) {
  jest.spyOn(global, "fetch").mockResolvedValueOnce(
    new Response("", { status }),
  );
}

function makeRequest() {
  return new NextRequest(`http://localhost/api/clients/${CLIENT_ID}/asset-queue/scrape`, {
    method: "POST",
  });
}

function paramsFor(id: string) {
  return Promise.resolve({ id });
}

describe("POST /api/clients/[id]/asset-queue/scrape", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();

    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === "clients") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: { id: CLIENT_ID, user_id: USER_ID } }),
            }),
          }),
        };
      }
      if (table === "events") {
        return {
          select: () => ({
            eq: () => ({
              in: () => Promise.resolve({ data: [] }),
            }),
          }),
        };
      }
      return {};
    });
  });

  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: new Error("no session") });
    const res = await POST(makeRequest(), { params: paramsFor(CLIENT_ID) });
    expect(res.status).toBe(401);
  });

  it("returns 403 when client belongs to a different user", async () => {
    mockFrom.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: { id: CLIENT_ID, user_id: "other-user" } }),
        }),
      }),
    }));
    const res = await POST(makeRequest(), { params: paramsFor(CLIENT_ID) });
    expect(res.status).toBe(403);
  });

  it("returns 400 when no sheet config exists", async () => {
    (getAssetSheetConfig as jest.Mock).mockResolvedValue(null);
    const res = await POST(makeRequest(), { params: paramsFor(CLIENT_ID) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/no sheet config/i);
  });

  it("returns 502 when Google Sheets returns 403 (sheet is private)", async () => {
    (getAssetSheetConfig as jest.Mock).mockResolvedValue({
      google_sheet_id: "sheet-id",
      sheet_range: "Assets!A:G",
    });
    mockFetchStatus(403);

    const res = await POST(makeRequest(), { params: paramsFor(CLIENT_ID) });
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toMatch(/anyone with link/i);
  });

  it("returns 502 when Google Sheets returns 404 (bad sheet ID)", async () => {
    (getAssetSheetConfig as jest.Mock).mockResolvedValue({
      google_sheet_id: "bad-sheet-id",
      sheet_range: "Assets!A:G",
    });
    mockFetchStatus(404);

    const res = await POST(makeRequest(), { params: paramsFor(CLIENT_ID) });
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toMatch(/anyone with link/i);
  });

  it("returns 502 when fetch throws (network error)", async () => {
    (getAssetSheetConfig as jest.Mock).mockResolvedValue({
      google_sheet_id: "sheet-id",
      sheet_range: "Assets!A:G",
    });
    jest.spyOn(global, "fetch").mockRejectedValueOnce(new Error("Network error"));

    const res = await POST(makeRequest(), { params: paramsFor(CLIENT_ID) });
    expect(res.status).toBe(502);
  });

  it("builds the correct CSV export URL from sheet ID + range", async () => {
    (getAssetSheetConfig as jest.Mock).mockResolvedValue({
      google_sheet_id: "my-sheet-id",
      sheet_range: "Assets!A:G",
    });
    const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response("", { status: 200 }),
    );
    (getExistingHashes as jest.Mock).mockResolvedValue(new Set());
    (touchLastScrapedAt as jest.Mock).mockResolvedValue(undefined);

    await POST(makeRequest(), { params: paramsFor(CLIENT_ID) });

    const calledUrl = (fetchSpy.mock.calls[0][0] as string);
    expect(calledUrl).toContain("my-sheet-id");
    expect(calledUrl).toContain("tqx=out:csv");
    expect(calledUrl).toContain("sheet=Assets");
  });

  it("deduplicates rows already in the DB", async () => {
    (getAssetSheetConfig as jest.Mock).mockResolvedValue({
      google_sheet_id: "sheet-id",
      sheet_range: "Assets!A:G",
    });
    mockFetchOk(SHEET_CSV_TWO_ROWS);

    const { parseSheetRows } = await import("@/lib/clients/asset-queue/sheet-parse");
    // 7-column format: Nation, Location, Funnel, MediaType, AssetName, Link, Notes
    const rows = parseSheetRows(CLIENT_ID, [
      ["England", "Brighton", "TOFU", "Video", "Asset A", "https://db.com/s/a", ""],
    ]);
    (getExistingHashes as jest.Mock).mockResolvedValue(new Set([rows[0].rowHash]));
    (listVenueMappings as jest.Mock).mockResolvedValue([]);
    (insertQueueRows as jest.Mock).mockResolvedValue([]);
    (touchLastScrapedAt as jest.Mock).mockResolvedValue(undefined);

    const res = await POST(makeRequest(), { params: paramsFor(CLIENT_ID) });
    expect(res.status).toBe(200);
    const json = await res.json();
    // Header row is skipped by parseSheetRows; 2 data rows scraped, 1 already known
    expect(json.scraped).toBe(2);
    expect(json.new).toBe(1);

    const inserted = (insertQueueRows as jest.Mock).mock.calls[0][0];
    expect(inserted).toHaveLength(1);
    expect(inserted[0].asset_name).toBe("Asset B");
    expect(inserted[0].media_type).toBe("Graphic");
  });

  it("marks row as error when no venue mapping found", async () => {
    (getAssetSheetConfig as jest.Mock).mockResolvedValue({
      google_sheet_id: "sheet-id",
      sheet_range: "Assets!A:G",
    });
    mockFetchOk(SHEET_CSV_ONE_ROW);

    (getExistingHashes as jest.Mock).mockResolvedValue(new Set());
    (listVenueMappings as jest.Mock).mockResolvedValue([]);
    (insertQueueRows as jest.Mock).mockResolvedValue([]);
    (touchLastScrapedAt as jest.Mock).mockResolvedValue(undefined);

    const res = await POST(makeRequest(), { params: paramsFor(CLIENT_ID) });
    const json = await res.json();
    expect(json.errors).toBe(1);

    const inserted = (insertQueueRows as jest.Mock).mock.calls[0][0];
    expect(inserted[0].status).toBe("error");
    expect(inserted[0].error_message).toBe("no_venue_mapping");
  });

  it("inserts matched_umbrella rows when location=All and mappings exist", async () => {
    (getAssetSheetConfig as jest.Mock).mockResolvedValue({
      google_sheet_id: "sheet-id",
      sheet_range: "Assets!A:G",
    });

    // Umbrella row: location=All, nation=England
    const UMBRELLA_CSV = [
      "Nation,Location,Funnel,Column 6,Asset,Link,Notes",
      "England,All,TOFU,Video,England-Wide Hype,https://db.com/s/all,",
    ].join("\n");
    mockFetchOk(UMBRELLA_CSV);

    (getExistingHashes as jest.Mock).mockResolvedValue(new Set());
    (listVenueMappings as jest.Mock).mockResolvedValue([
      { id: "1", client_id: CLIENT_ID, sheet_label: "Brighton", event_code: "WC26-BRIGHTON", nation_label: "England" },
      { id: "2", client_id: CLIENT_ID, sheet_label: "Manchester", event_code: "UTB0046-NEW", nation_label: "England" },
    ]);

    // mockFrom already returns [] for events — simulate no resolved IDs
    (insertQueueRows as jest.Mock).mockResolvedValue([]);
    (touchLastScrapedAt as jest.Mock).mockResolvedValue(undefined);

    const res = await POST(makeRequest(), { params: paramsFor(CLIENT_ID) });
    const json = await res.json();
    expect(json.matched).toBe(1);

    const inserted = (insertQueueRows as jest.Mock).mock.calls[0][0];
    expect(inserted).toHaveLength(1);
    expect(inserted[0].status).toBe("matched_umbrella");
    expect(inserted[0].resolved_event_codes_multi).toContain("WC26-BRIGHTON");
    expect(inserted[0].resolved_event_codes_multi).toContain("UTB0046-NEW");
    expect(inserted[0].resolved_event_code).toBeNull();
  });

  it("returns { new: 0 } when all rows are already in the queue", async () => {
    (getAssetSheetConfig as jest.Mock).mockResolvedValue({
      google_sheet_id: "sheet-id",
      sheet_range: "Assets!A:G",
    });
    mockFetchOk(SHEET_CSV_TWO_ROWS);

    const { parseSheetRows } = await import("@/lib/clients/asset-queue/sheet-parse");
    const rows = parseSheetRows(CLIENT_ID, [
      ["England", "Brighton", "TOFU", "Video", "Asset A", "https://db.com/s/a", ""],
      ["Scotland", "Glasgow", "MOFU", "Graphic", "Asset B", "https://db.com/s/b", ""],
    ]);
    (getExistingHashes as jest.Mock).mockResolvedValue(new Set(rows.map((r) => r.rowHash)));
    (touchLastScrapedAt as jest.Mock).mockResolvedValue(undefined);

    const res = await POST(makeRequest(), { params: paramsFor(CLIENT_ID) });
    const json = await res.json();
    expect(json.new).toBe(0);
    expect(insertQueueRows).not.toHaveBeenCalled();
  });
});
