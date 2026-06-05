/**
 * Tests for POST /api/clients/[id]/asset-queue/[queueId]/override-urls
 *
 * Covers:
 *   - Valid override with /scl/fi/ file URLs
 *   - Rejects /scl/fo/ folder URLs
 *   - Rejects non-Dropbox URLs
 *   - Rejects rows not in 'error' status
 *   - Propagates DropboxFetchError from download
 */

import { NextRequest } from "next/server";

// ── Mocks ───────────────────────────────────────────────────────────────────

const mockGetUser = jest.fn();
const mockFrom = jest.fn();
const mockStorage = {
  from: jest.fn(() => ({
    upload: jest.fn().mockResolvedValue({ error: null }),
  })),
};

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(() => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  })),
  createServiceRoleClient: jest.fn(() => ({
    from: mockFrom,
    storage: mockStorage,
  })),
}));

jest.mock("@/lib/db/asset-queue", () => ({
  getAssetQueueRow: jest.fn(),
}));

jest.mock("@/lib/clients/asset-queue/dropbox", () => {
  const { DropboxFetchError } = jest.requireActual("@/lib/clients/asset-queue/dropbox");
  return {
    isDropboxFolderUrl: (url: string) => url.includes("/scl/fo/"),
    downloadDropboxAsset: jest.fn(),
    DropboxFetchError,
  };
});

import { POST } from "../route";
import { getAssetQueueRow } from "@/lib/db/asset-queue";
import { downloadDropboxAsset } from "@/lib/clients/asset-queue/dropbox";
import { DropboxFetchError } from "@/lib/clients/asset-queue/dropbox";

const CLIENT_ID = "client-123";
const QUEUE_ID  = "queue-abc";
const USER_ID   = "user-456";

const FILE_URL    = "https://www.dropbox.com/scl/fi/abc/file.mp4?rlkey=xyz";
const FOLDER_URL  = "https://www.dropbox.com/scl/fo/abc/folder?rlkey=xyz";

function makeRequest(body: unknown) {
  return new NextRequest(
    `http://localhost/api/clients/${CLIENT_ID}/asset-queue/${QUEUE_ID}/override-urls`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function params() {
  return Promise.resolve({ id: CLIENT_ID, queueId: QUEUE_ID });
}

function mockAuth() {
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
}

function mockClientRow() {
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
    // client_asset_queue update
    return {
      update: () => ({
        eq: () => Promise.resolve({ error: null }),
      }),
    };
  });
}

function mockQueueRow(overrides: Record<string, unknown> = {}) {
  (getAssetQueueRow as jest.Mock).mockResolvedValue({
    id: QUEUE_ID,
    client_id: CLIENT_ID,
    status: "error",
    error_message: "network",
    dropbox_url: FOLDER_URL,
    ...overrides,
  });
}

function mockDownload(ext = "mp4") {
  (downloadDropboxAsset as jest.Mock).mockResolvedValue({
    buffer: Buffer.from("fake-video-content"),
    extension: ext,
  });
}

describe("POST /api/clients/[id]/asset-queue/[queueId]/override-urls", () => {
  beforeEach(() => jest.clearAllMocks());

  it("accepts valid /scl/fi/ URLs, downloads, uploads, resets to matched", async () => {
    mockAuth();
    mockClientRow();
    mockQueueRow();
    mockDownload();

    const res = await POST(makeRequest({ urls: [FILE_URL] }), { params: params() });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.fileCount).toBe(1);
  });

  it("rejects /scl/fo/ folder URLs with 400", async () => {
    mockAuth();
    mockClientRow();
    mockQueueRow();

    const res = await POST(makeRequest({ urls: [FOLDER_URL] }), { params: params() });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/folder url/i);
  });

  it("rejects non-Dropbox URLs with 400", async () => {
    mockAuth();
    mockClientRow();
    mockQueueRow();

    const res = await POST(makeRequest({ urls: ["https://example.com/file.mp4"] }), { params: params() });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/dropbox/i);
  });

  it("rejects row not in error status", async () => {
    mockAuth();
    mockClientRow();
    mockQueueRow({ status: "matched" });

    const res = await POST(makeRequest({ urls: [FILE_URL] }), { params: params() });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/error rows/i);
  });

  it("returns 422 when Dropbox download fails", async () => {
    mockAuth();
    mockClientRow();
    mockQueueRow();
    (downloadDropboxAsset as jest.Mock).mockRejectedValue(
      new DropboxFetchError("not_found", "File not found"),
    );

    const res = await POST(makeRequest({ urls: [FILE_URL] }), { params: params() });
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.code).toBe("not_found");
  });

  it("accepts multiple file URLs and reports correct fileCount", async () => {
    mockAuth();
    mockClientRow();
    mockQueueRow();
    mockDownload("mov");
    (downloadDropboxAsset as jest.Mock)
      .mockResolvedValueOnce({ buffer: Buffer.from("a"), extension: "mp4" })
      .mockResolvedValueOnce({ buffer: Buffer.from("b"), extension: "mov" });

    const res = await POST(
      makeRequest({ urls: [FILE_URL, FILE_URL.replace("file.mp4", "file2.mov")] }),
      { params: params() },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.fileCount).toBe(2);
  });

  it("returns 400 for empty urls array", async () => {
    mockAuth();
    mockClientRow();
    mockQueueRow();

    const res = await POST(makeRequest({ urls: [] }), { params: params() });
    expect(res.status).toBe(400);
  });

  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const res = await POST(makeRequest({ urls: [FILE_URL] }), { params: params() });
    expect(res.status).toBe(401);
  });
});
