import { isDropboxFolderUrl, toDirectDownloadUrl, DropboxFetchError } from "../dropbox";

// ─── listDropboxFolderFiles / tryDropboxApiList ───────────────────────────────

const FOLDER_URL = "https://www.dropbox.com/scl/fo/abc/folder?rlkey=xyz";

/** Dropbox API response shape for /2/sharing/list_shared_link_files */
function makeApiResponse(entries: object[], status = 200) {
  return new Response(JSON.stringify({ entries, has_more: false }), { status });
}

const FILE_ENTRY = {
  ".tag": "file",
  name: "clip.mp4",
  url: "https://www.dropbox.com/scl/fi/xyz/clip.mp4?rlkey=abc",
  size: 12345678,
};

const FOLDER_ENTRY = {
  ".tag": "folder",
  name: "subfolder",
  url: "",
  size: 0,
};

describe("listDropboxFolderFiles — API auth path", () => {
  const origEnv = process.env;

  beforeEach(() => {
    process.env = { ...origEnv, DROPBOX_ACCESS_TOKEN: "sl.u.fake-test-token" };
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env = origEnv;
  });

  it("returns file entries when API responds 200", async () => {
    jest.spyOn(global, "fetch").mockResolvedValueOnce(makeApiResponse([FILE_ENTRY]));

    const { listDropboxFolderFiles } = await import("../dropbox");
    const files = await listDropboxFolderFiles(FOLDER_URL);

    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("clip.mp4");
    expect(files[0].size).toBe(12345678);
  });

  it("excludes .tag=folder entries from results", async () => {
    jest.spyOn(global, "fetch").mockResolvedValueOnce(
      makeApiResponse([FILE_ENTRY, FOLDER_ENTRY]),
    );

    const { listDropboxFolderFiles } = await import("../dropbox");
    const files = await listDropboxFolderFiles(FOLDER_URL);

    expect(files.every((f) => f.name !== "subfolder")).toBe(true);
    expect(files).toHaveLength(1);
  });

  it("throws DropboxFetchError('forbidden') on 401", async () => {
    jest.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error_summary: "invalid_access_token" }), { status: 401 }),
    );

    const { listDropboxFolderFiles } = await import("../dropbox");
    await expect(listDropboxFolderFiles(FOLDER_URL)).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("throws DropboxFetchError on 429 rate limit", async () => {
    jest.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response("", { status: 429 }),
    );

    const { listDropboxFolderFiles } = await import("../dropbox");
    await expect(listDropboxFolderFiles(FOLDER_URL)).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("throws DropboxFetchError('not_found') on 404", async () => {
    jest.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response("", { status: 404 }),
    );

    const { listDropboxFolderFiles } = await import("../dropbox");
    await expect(listDropboxFolderFiles(FOLDER_URL)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("falls through to HTML scrape when DROPBOX_ACCESS_TOKEN is absent", async () => {
    process.env = { ...origEnv }; // no token
    delete process.env.DROPBOX_ACCESS_TOKEN;

    // First fetch = folder page HTML (scrape path); return minimal HTML that
    // will throw 'network' error (no __INITIAL_PROPS__) rather than succeed
    jest.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response("<html><body>no props here</body></html>", { status: 200 }),
    );

    const { listDropboxFolderFiles } = await import("../dropbox");
    // Should throw from the scrape path, NOT from an auth error
    await expect(listDropboxFolderFiles(FOLDER_URL)).rejects.toMatchObject({
      code: "network",
    });
  });

  it("sends Authorization header when token is set", async () => {
    const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValueOnce(
      makeApiResponse([FILE_ENTRY]),
    );

    const { listDropboxFolderFiles } = await import("../dropbox");
    await listDropboxFolderFiles(FOLDER_URL);

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toMatch(/^Bearer /);
    // Must NOT include the actual token value in test output — just check shape
    expect(headers["Authorization"].length).toBeGreaterThan(7);
  });
});

describe("isDropboxFolderUrl", () => {
  it("returns true for /scl/fo/ (folder) URLs", () => {
    expect(isDropboxFolderUrl("https://www.dropbox.com/scl/fo/abc123/key?rlkey=xyz")).toBe(true);
    expect(isDropboxFolderUrl("https://www.dropbox.com/scl/fo/test")).toBe(true);
  });

  it("returns false for /scl/fi/ (single file) URLs", () => {
    expect(isDropboxFolderUrl("https://www.dropbox.com/scl/fi/abc123/file.mp4?rlkey=xyz")).toBe(false);
  });

  it("returns false for legacy /s/ URLs", () => {
    expect(isDropboxFolderUrl("https://www.dropbox.com/s/abc123?dl=0")).toBe(false);
  });

  it("returns false for direct CDN URLs", () => {
    expect(isDropboxFolderUrl("https://dl.dropboxusercontent.com/s/abc123/file.mp4")).toBe(false);
  });
});

describe("toDirectDownloadUrl", () => {
  it("appends ?dl=1 to a share link", () => {
    const url = toDirectDownloadUrl("https://www.dropbox.com/scl/fi/abc/file.mp4?rlkey=xyz");
    expect(url).toContain("dl=1");
  });

  it("replaces existing ?dl=0 with ?dl=1", () => {
    const url = toDirectDownloadUrl("https://www.dropbox.com/s/abc?dl=0");
    expect(url).toContain("dl=1");
    expect(url).not.toContain("dl=0");
  });

  it("returns CDN URLs unchanged", () => {
    const cdn = "https://dl.dropboxusercontent.com/s/abc/file.mp4";
    expect(toDirectDownloadUrl(cdn)).toBe(cdn);
  });

  it("returns malformed URLs as-is", () => {
    expect(toDirectDownloadUrl("not-a-url")).toBe("not-a-url");
  });
});
