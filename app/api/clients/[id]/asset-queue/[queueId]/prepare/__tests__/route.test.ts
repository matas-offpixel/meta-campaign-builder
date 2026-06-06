/**
 * Tests for POST /api/clients/[id]/asset-queue/[queueId]/prepare
 *
 * Covers: Dropbox download success/fail, Storage write, Anthropic mock, state transitions.
 */

import { NextRequest } from "next/server";

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockGetUser = jest.fn();
const mockFrom = jest.fn();
const mockStorageUpload = jest.fn();

const mockServiceClient = {
  storage: {
    from: jest.fn(() => ({ upload: mockStorageUpload })),
  },
  from: mockFrom,
};

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(() => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  })),
  createServiceRoleClient: jest.fn(() => mockServiceClient),
}));

jest.mock("@/lib/db/asset-queue", () => ({
  getAssetQueueRow: jest.fn(),
  updateQueueRowStatus: jest.fn(),
  updateQueueRowPrepared: jest.fn(),
}));

jest.mock("@/lib/db/asset-sheet-config", () => ({
  getAssetSheetConfig: jest.fn(),
}));

jest.mock("@/lib/clients/asset-queue/dropbox", () => ({
  downloadDropboxAsset: jest.fn(),
  DropboxFetchError: class DropboxFetchError extends Error {
    constructor(public code: string, message: string) { super(message); }
  },
}));

jest.mock("@/lib/clients/asset-queue/copy-generator", () => ({
  generateCopy: jest.fn(),
}));

jest.mock("@/lib/clients/asset-queue/resolve-queue-venue", () => ({
  resolveQueueRowVenue: jest.fn(),
  loadResolvedEventContext: jest.fn(),
}));

import { POST } from "../route";
import { getAssetQueueRow, updateQueueRowStatus, updateQueueRowPrepared } from "@/lib/db/asset-queue";
import { getAssetSheetConfig } from "@/lib/db/asset-sheet-config";
import { downloadDropboxAsset } from "@/lib/clients/asset-queue/dropbox";
import { generateCopy } from "@/lib/clients/asset-queue/copy-generator";
import {
  loadResolvedEventContext,
  resolveQueueRowVenue,
} from "@/lib/clients/asset-queue/resolve-queue-venue";

const CLIENT_ID = "client-uuid";
const USER_ID = "user-uuid";
const QUEUE_ID = "queue-row-uuid";

function makeRequest() {
  return new NextRequest(
    `http://localhost/api/clients/${CLIENT_ID}/asset-queue/${QUEUE_ID}/prepare`,
    { method: "POST" },
  );
}

function paramsFor(id: string, queueId: string) {
  return Promise.resolve({ id, queueId });
}

const BASE_ROW = {
  id: QUEUE_ID,
  client_id: CLIENT_ID,
  status: "matched",
  dropbox_url: "https://www.dropbox.com/s/abc123/video.mp4?dl=0",
  asset_name: "Brighton TOFU Reel",
  funnel: "TOFU",
  location: "Brighton",
  resolved_event_id: null,
  resolved_event_code: "WC26-BRIGHTON",
};

describe("POST /api/clients/[id]/asset-queue/[queueId]/prepare", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === "clients") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { id: CLIENT_ID, user_id: USER_ID, slug: "4thefans" },
                }),
            }),
          }),
        };
      }
      if (table === "events") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: null }),
            }),
          }),
        };
      }
      return {};
    });

    (getAssetQueueRow as jest.Mock).mockResolvedValue(BASE_ROW);
    (getAssetSheetConfig as jest.Mock).mockResolvedValue({
      cta_defaults: { TOFU: "WATCH_MORE" },
      copy_templates: {},
      destination_url_pattern: { TOFU: "https://tickets.example.com" },
    });
    (generateCopy as jest.Mock).mockResolvedValue({
      primaryText: "Watch the match live in Brighton!",
      headline: "WC26 Brighton",
      ctaValue: "WATCH_MORE",
      fromFallback: false,
    });
    mockStorageUpload.mockResolvedValue({ error: null });
    (resolveQueueRowVenue as jest.Mock).mockResolvedValue(null);
    (loadResolvedEventContext as jest.Mock).mockResolvedValue(null);
    (updateQueueRowPrepared as jest.Mock).mockResolvedValue(undefined);
    (updateQueueRowStatus as jest.Mock).mockResolvedValue(undefined);
  });

  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: new Error("no session") });
    const res = await POST(makeRequest(), { params: paramsFor(CLIENT_ID, QUEUE_ID) });
    expect(res.status).toBe(401);
  });

  it("returns 400 when row is not in matched status", async () => {
    (getAssetQueueRow as jest.Mock).mockResolvedValue({ ...BASE_ROW, status: "launched" });
    const res = await POST(makeRequest(), { params: paramsFor(CLIENT_ID, QUEUE_ID) });
    expect(res.status).toBe(400);
  });

  it("handles successful Dropbox download + Storage upload + AI copy", async () => {
    (downloadDropboxAsset as jest.Mock).mockResolvedValue({
      buffer: Buffer.from("fake-video-content"),
      extension: "mp4",
    });

    const res = await POST(makeRequest(), { params: paramsFor(CLIENT_ID, QUEUE_ID) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.generatedCopy).toBe("Watch the match live in Brighton!");
    expect(json.generatedCta).toBe("WATCH_MORE");

    expect(mockServiceClient.storage.from).toHaveBeenCalledWith("campaign-assets");
    expect(mockStorageUpload).toHaveBeenCalledWith(
      `queue/${QUEUE_ID}.mp4`,
      expect.any(Buffer),
      expect.objectContaining({ contentType: "video/mp4" }),
    );

    expect(updateQueueRowPrepared).toHaveBeenCalledWith(QUEUE_ID, expect.objectContaining({
      assetBlobUrl: `queue/${QUEUE_ID}.mp4`,
      generatedCopy: "Watch the match live in Brighton!",
    }));
  });

  it("sets status='error' and returns 200 on Dropbox 403", async () => {
    const { DropboxFetchError: DFE } = jest.requireMock("@/lib/clients/asset-queue/dropbox");
    (downloadDropboxAsset as jest.Mock).mockRejectedValue(
      new DFE("forbidden", "Dropbox returned 403"),
    );

    const res = await POST(makeRequest(), { params: paramsFor(CLIENT_ID, QUEUE_ID) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.code).toBe("forbidden");
    expect(updateQueueRowStatus).toHaveBeenCalledWith(QUEUE_ID, "error", { error_message: "forbidden" });
  });

  it("sets status='error' and returns 200 on Dropbox 404", async () => {
    const { DropboxFetchError: DFE } = jest.requireMock("@/lib/clients/asset-queue/dropbox");
    (downloadDropboxAsset as jest.Mock).mockRejectedValue(
      new DFE("not_found", "Dropbox returned 404"),
    );

    const res = await POST(makeRequest(), { params: paramsFor(CLIENT_ID, QUEUE_ID) });
    expect(res.status).toBe(200);
    expect(updateQueueRowStatus).toHaveBeenCalledWith(QUEUE_ID, "error", { error_message: "not_found" });
  });

  it("returns 500 on Storage upload failure", async () => {
    (downloadDropboxAsset as jest.Mock).mockResolvedValue({
      buffer: Buffer.from("data"),
      extension: "mp4",
    });
    mockStorageUpload.mockResolvedValue({ error: new Error("bucket not found") });

    const res = await POST(makeRequest(), { params: paramsFor(CLIENT_ID, QUEUE_ID) });
    expect(res.status).toBe(500);
    expect(updateQueueRowStatus).toHaveBeenCalledWith(QUEUE_ID, "error", { error_message: "storage_upload_failed" });
  });

  it("re-resolves NULL resolved_event_code and persists venue + organiser URL", async () => {
    (getAssetQueueRow as jest.Mock).mockResolvedValue({
      ...BASE_ROW,
      resolved_event_code: null,
      resolved_event_id: null,
      asset_name: "Colin Hendry Assets Glasgow",
      location: "Scotland",
      nation: "Scotland",
      event_match_ambiguous: false,
    });
    (resolveQueueRowVenue as jest.Mock).mockResolvedValue({
      resolvedEventCode: "WC26-GLASGOW-O2",
      resolvedEventId: "glasgow-event-id",
      eventMatchAmbiguous: true,
    });
    (loadResolvedEventContext as jest.Mock).mockResolvedValue({
      id: "glasgow-event-id",
      name: "Glasgow O2 Fanpark",
      event_code: "WC26-GLASGOW-O2",
      venue_name: "O2 Academy Glasgow",
      venue_city: "Glasgow",
    });
    (getAssetSheetConfig as jest.Mock).mockResolvedValue({
      cta_defaults: { TOFU: "BOOK_NOW" },
      copy_templates: {},
      destination_url_pattern: {},
    });
    (downloadDropboxAsset as jest.Mock).mockResolvedValue({
      buffer: Buffer.from("data"),
      extension: "png",
      name: "Hendry4x5.png",
    });

    const res = await POST(makeRequest(), { params: paramsFor(CLIENT_ID, QUEUE_ID) });
    expect(res.status).toBe(200);

    expect(resolveQueueRowVenue).toHaveBeenCalled();
    expect(updateQueueRowPrepared).toHaveBeenCalledWith(
      QUEUE_ID,
      expect.objectContaining({
        resolvedEventCode: "WC26-GLASGOW-O2",
        resolvedEventId: "glasgow-event-id",
        eventMatchAmbiguous: true,
        generatedUrl: "https://4thefans.tv/organiser/glasgow/",
      }),
    );
  });

  it("still writes prepared state even when generateCopy falls back", async () => {
    (downloadDropboxAsset as jest.Mock).mockResolvedValue({
      buffer: Buffer.from("data"),
      extension: "jpg",
    });
    (generateCopy as jest.Mock).mockResolvedValue({
      primaryText: "Watch the action live in Brighton!",
      headline: "WC26 Brighton",
      ctaValue: "WATCH_MORE",
      fromFallback: true,
    });

    const res = await POST(makeRequest(), { params: paramsFor(CLIENT_ID, QUEUE_ID) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.fromFallback).toBe(true);
    expect(updateQueueRowPrepared).toHaveBeenCalled();
  });
});
