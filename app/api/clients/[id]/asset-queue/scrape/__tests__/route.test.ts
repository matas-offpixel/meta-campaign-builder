/**
 * Tests for POST /api/clients/[id]/asset-queue/scrape
 *
 * Focuses on: dedup by hash, RLS scoping, error states.
 * Google Sheets + Supabase are mocked.
 */

import { NextRequest } from "next/server";

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockGetUser = jest.fn();
const mockFrom = jest.fn();
const mockSheetsGet = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(() => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  })),
  createServiceRoleClient: jest.fn(),
}));

jest.mock("googleapis", () => ({
  google: {
    auth: {
      JWT: jest.fn().mockImplementation(() => ({})),
    },
    sheets: jest.fn(() => ({
      spreadsheets: {
        values: {
          get: mockSheetsGet,
        },
      },
    })),
  },
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
    process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL = "svc@test.iam.gserviceaccount.com";
    process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY = "fake-private-key";

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
            in: () => Promise.resolve({ data: [] }),
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

  it("deduplicates rows already in the DB", async () => {
    (getAssetSheetConfig as jest.Mock).mockResolvedValue({
      google_sheet_id: "sheet-id",
      sheet_range: "Assets!A:G",
      cta_defaults: {},
      copy_templates: {},
      destination_url_pattern: {},
    });

    mockSheetsGet.mockResolvedValue({
      data: {
        values: [
          ["Nation", "Location", "Funnel", "Asset", "Dropbox", "Notes"],
          ["England", "Brighton", "TOFU", "Asset A", "https://db.com/s/a", ""],
          ["Scotland", "Glasgow", "MOFU", "Asset B", "https://db.com/s/b", ""],
        ],
      },
    });

    const { parseSheetRows } = await import("@/lib/clients/asset-queue/sheet-parse");
    const rows = parseSheetRows(CLIENT_ID, [
      ["England", "Brighton", "TOFU", "Asset A", "https://db.com/s/a", ""],
    ]);
    (getExistingHashes as jest.Mock).mockResolvedValue(new Set([rows[0].rowHash]));
    (listVenueMappings as jest.Mock).mockResolvedValue([]);
    (insertQueueRows as jest.Mock).mockResolvedValue([]);
    (touchLastScrapedAt as jest.Mock).mockResolvedValue(undefined);

    const res = await POST(makeRequest(), { params: paramsFor(CLIENT_ID) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.scraped).toBe(2);
    expect(json.new).toBe(1);

    const inserted = (insertQueueRows as jest.Mock).mock.calls[0][0];
    expect(inserted).toHaveLength(1);
    expect(inserted[0].asset_name).toBe("Asset B");
  });

  it("marks row as error when no venue mapping found", async () => {
    (getAssetSheetConfig as jest.Mock).mockResolvedValue({
      google_sheet_id: "sheet-id",
      sheet_range: "Assets!A:G",
      cta_defaults: {},
      copy_templates: {},
      destination_url_pattern: {},
    });

    mockSheetsGet.mockResolvedValue({
      data: {
        values: [
          ["England", "Liverpool", "BOFU", "Some Asset", "https://db.com/s/x", ""],
        ],
      },
    });

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

  it("returns 502 when Google Sheets throws", async () => {
    (getAssetSheetConfig as jest.Mock).mockResolvedValue({
      google_sheet_id: "sheet-id",
      sheet_range: "Assets!A:G",
    });

    mockSheetsGet.mockRejectedValue(new Error("Sheets API error"));

    const res = await POST(makeRequest(), { params: paramsFor(CLIENT_ID) });
    expect(res.status).toBe(502);
  });
});
