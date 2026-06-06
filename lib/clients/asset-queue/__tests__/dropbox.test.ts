/**
 * Tests for the refactored Dropbox folder-listing integration.
 *
 * Authentication is now handled by dropbox-auth.ts (refresh-token flow).
 * These tests mock both the OAuth2 token endpoint AND the Dropbox API
 * endpoints. A shared helper mockFetch() routes calls by URL.
 *
 * Covers:
 *   listDropboxFolderFiles:
 *     - Missing credentials → DropboxFetchError("config_missing") via auth layer
 *     - list_folder 200 success → returns file entries, skips .tag==="folder"
 *     - list_folder with pagination (has_more → continue) → all pages merged
 *     - list_folder 401 → DropboxFetchError("forbidden")
 *     - list_folder 404 → DropboxFetchError("not_found")
 *     - list_folder 429 → DropboxFetchError("forbidden")
 *     - list_folder unexpected non-ok → DropboxFetchError("network")
 *
 *   fetchDropboxFileContent:
 *     - Missing credentials → DropboxFetchError("config_missing") via auth layer
 *     - get_shared_link_file 200 → buffer + correct extension from content-type
 *     - get_shared_link_file 200 → extension from content-disposition
 *     - get_shared_link_file 401 → DropboxFetchError("forbidden")
 *     - get_shared_link_file 429 → DropboxFetchError("forbidden")
 *     - get_shared_link_file 404 → DropboxFetchError("not_found")
 *
 * Run: node --test (repo's test runner).
 */

import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";

import {
  listDropboxFolderFiles,
  fetchDropboxFileContent,
  DropboxFetchError,
} from "../dropbox.ts";
import { _clearTokenCache } from "../dropbox-auth.ts";

// ─── Fetch mock helpers ───────────────────────────────────────────────────────

type FetchReturn = {
  status: number;
  ok: boolean;
  headers?: Record<string, string>;
  body?: unknown;
  text?: string;
  arrayBuffer?: ArrayBuffer;
};

function makeResponse(opts: FetchReturn): Response {
  const headers = new Headers(opts.headers ?? {});
  return {
    status: opts.status,
    ok: opts.ok,
    headers,
    json: async () => opts.body,
    text: async () => opts.text ?? JSON.stringify(opts.body ?? ""),
    arrayBuffer: async () =>
      opts.arrayBuffer ?? new TextEncoder().encode("filedata").buffer,
  } as unknown as Response;
}

const TOKEN_URL      = "https://api.dropbox.com/oauth2/token";
const LIST_FOLDER_URL = "https://api.dropboxapi.com/2/files/list_folder";
const CONTINUE_URL    = "https://api.dropboxapi.com/2/files/list_folder/continue";
const DOWNLOAD_URL    = "https://content.dropboxapi.com/2/sharing/get_shared_link_file";

const SHARE_URL = "https://www.dropbox.com/scl/fo/test/id?rlkey=xyz&dl=0";

/** Success response for the OAuth2 token endpoint. */
function tokenOk() {
  return makeResponse({
    status: 200,
    ok: true,
    body: { access_token: "sl.test_tok", expires_in: 14400, token_type: "bearer" },
  });
}

// ─── Env + cache harness ─────────────────────────────────────────────────────

const SAVED = {
  DROPBOX_REFRESH_TOKEN: process.env.DROPBOX_REFRESH_TOKEN,
  DROPBOX_APP_KEY: process.env.DROPBOX_APP_KEY,
  DROPBOX_APP_SECRET: process.env.DROPBOX_APP_SECRET,
};

function setValidEnv() {
  process.env.DROPBOX_REFRESH_TOKEN = "rt_test";
  process.env.DROPBOX_APP_KEY = "key_test";
  process.env.DROPBOX_APP_SECRET = "secret_test";
}

afterEach(() => {
  for (const [k, v] of Object.entries(SAVED)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  _clearTokenCache();
  mock.restoreAll();
});

// ─── listDropboxFolderFiles ───────────────────────────────────────────────────

describe("listDropboxFolderFiles", () => {
  it("throws config_missing when credentials are absent (auth layer)", async () => {
    delete process.env.DROPBOX_REFRESH_TOKEN;
    delete process.env.DROPBOX_APP_KEY;
    delete process.env.DROPBOX_APP_SECRET;
    await assert.rejects(
      () => listDropboxFolderFiles(SHARE_URL),
      (err: unknown) => {
        assert.ok(err instanceof DropboxFetchError);
        assert.equal(err.code, "config_missing");
        return true;
      },
    );
  });

  it("returns file entries on 200, skipping sub-folder entries", async () => {
    setValidEnv();
    mock.method(globalThis, "fetch", async (url: string) => {
      if (url === TOKEN_URL) return tokenOk();
      assert.equal(url, LIST_FOLDER_URL);
      return makeResponse({
        status: 200,
        ok: true,
        body: {
          entries: [
            { ".tag": "file", name: "video.mp4", path_lower: "/video.mp4", size: 10_000_000 },
            { ".tag": "folder", name: "subfolder", path_lower: "/subfolder", size: 0 },
            { ".tag": "file", name: "thumb.jpg", path_lower: "/thumb.jpg", size: 50_000 },
          ],
          has_more: false,
        },
      });
    });

    const entries = await listDropboxFolderFiles(SHARE_URL);
    assert.equal(entries.length, 2, "2 files returned, folder entry skipped");
    assert.equal(entries[0].name, "video.mp4");
    assert.equal(entries[0].path_lower, "/video.mp4");
    assert.equal(entries[0].size, 10_000_000);
    assert.equal(entries[1].name, "thumb.jpg");
  });

  it("merges pages when has_more=true (pagination via /continue)", async () => {
    setValidEnv();
    let callCount = 0;
    mock.method(globalThis, "fetch", async (url: string) => {
      if (url === TOKEN_URL) return tokenOk();
      callCount++;
      if (url === LIST_FOLDER_URL) {
        return makeResponse({
          status: 200,
          ok: true,
          body: {
            entries: [{ ".tag": "file", name: "a.mp4", path_lower: "/a.mp4", size: 1 }],
            has_more: true,
            cursor: "cursor_abc",
          },
        });
      }
      if (url === CONTINUE_URL) {
        return makeResponse({
          status: 200,
          ok: true,
          body: {
            entries: [{ ".tag": "file", name: "b.mp4", path_lower: "/b.mp4", size: 2 }],
            has_more: false,
          },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const entries = await listDropboxFolderFiles(SHARE_URL);
    assert.equal(entries.length, 2, "both pages merged");
    assert.equal(entries[0].name, "a.mp4");
    assert.equal(entries[1].name, "b.mp4");
    assert.equal(callCount, 2, "first page + one continue call");
  });

  it("throws forbidden on 401 from list_folder", async () => {
    setValidEnv();
    mock.method(globalThis, "fetch", async (url: string) => {
      if (url === TOKEN_URL) return tokenOk();
      return makeResponse({ status: 401, ok: false, text: "unauthorized" });
    });
    await assert.rejects(
      () => listDropboxFolderFiles(SHARE_URL),
      (err: unknown) => {
        assert.ok(err instanceof DropboxFetchError);
        assert.equal(err.code, "forbidden");
        return true;
      },
    );
  });

  it("throws not_found on 404 from list_folder", async () => {
    setValidEnv();
    mock.method(globalThis, "fetch", async (url: string) => {
      if (url === TOKEN_URL) return tokenOk();
      return makeResponse({ status: 404, ok: false, text: "not found" });
    });
    await assert.rejects(
      () => listDropboxFolderFiles(SHARE_URL),
      (err: unknown) => {
        assert.ok(err instanceof DropboxFetchError);
        assert.equal(err.code, "not_found");
        return true;
      },
    );
  });

  it("throws forbidden on 429 (rate limit) from list_folder", async () => {
    setValidEnv();
    mock.method(globalThis, "fetch", async (url: string) => {
      if (url === TOKEN_URL) return tokenOk();
      return makeResponse({ status: 429, ok: false });
    });
    await assert.rejects(
      () => listDropboxFolderFiles(SHARE_URL),
      (err: unknown) => {
        assert.ok(err instanceof DropboxFetchError);
        assert.equal(err.code, "forbidden");
        return true;
      },
    );
  });

  it("throws network on unexpected non-ok status from list_folder", async () => {
    setValidEnv();
    mock.method(globalThis, "fetch", async (url: string) => {
      if (url === TOKEN_URL) return tokenOk();
      return makeResponse({ status: 503, ok: false, text: "service unavailable" });
    });
    await assert.rejects(
      () => listDropboxFolderFiles(SHARE_URL),
      (err: unknown) => {
        assert.ok(err instanceof DropboxFetchError);
        assert.equal(err.code, "network");
        return true;
      },
    );
  });
});

// ─── fetchDropboxFileContent ──────────────────────────────────────────────────

describe("fetchDropboxFileContent", () => {
  const entry = { name: "video.mp4", path_lower: "/video.mp4" };

  it("throws config_missing when credentials are absent (auth layer)", async () => {
    delete process.env.DROPBOX_REFRESH_TOKEN;
    delete process.env.DROPBOX_APP_KEY;
    delete process.env.DROPBOX_APP_SECRET;
    await assert.rejects(
      () => fetchDropboxFileContent(SHARE_URL, entry),
      (err: unknown) => {
        assert.ok(err instanceof DropboxFetchError);
        assert.equal(err.code, "config_missing");
        return true;
      },
    );
  });

  it("returns buffer + extension from content-type on 200", async () => {
    setValidEnv();
    const fakeBytes = new TextEncoder().encode("FAKEVIDEO").buffer;
    mock.method(globalThis, "fetch", async (url: string) => {
      if (url === TOKEN_URL) return tokenOk();
      assert.equal(url, DOWNLOAD_URL);
      return makeResponse({
        status: 200,
        ok: true,
        headers: { "content-type": "video/mp4" },
        arrayBuffer: fakeBytes,
      });
    });

    const { buffer, extension } = await fetchDropboxFileContent(SHARE_URL, entry);
    assert.equal(extension, "mp4");
    assert.ok(buffer.byteLength > 0);
  });

  it("prefers content-disposition over content-type for extension", async () => {
    setValidEnv();
    mock.method(globalThis, "fetch", async (url: string) => {
      if (url === TOKEN_URL) return tokenOk();
      return makeResponse({
        status: 200,
        ok: true,
        headers: {
          "content-disposition": 'attachment; filename="clip.mov"',
          "content-type": "application/octet-stream",
        },
      });
    });
    const { extension } = await fetchDropboxFileContent(SHARE_URL, { name: "clip.mov", path_lower: "/clip.mov" });
    assert.equal(extension, "mov");
  });

  it("throws forbidden on 401 from get_shared_link_file", async () => {
    setValidEnv();
    mock.method(globalThis, "fetch", async (url: string) => {
      if (url === TOKEN_URL) return tokenOk();
      return makeResponse({ status: 401, ok: false });
    });
    await assert.rejects(
      () => fetchDropboxFileContent(SHARE_URL, entry),
      (err: unknown) => {
        assert.ok(err instanceof DropboxFetchError);
        assert.equal(err.code, "forbidden");
        return true;
      },
    );
  });

  it("throws forbidden on 429 from get_shared_link_file", async () => {
    setValidEnv();
    mock.method(globalThis, "fetch", async (url: string) => {
      if (url === TOKEN_URL) return tokenOk();
      return makeResponse({ status: 429, ok: false });
    });
    await assert.rejects(
      () => fetchDropboxFileContent(SHARE_URL, entry),
      (err: unknown) => {
        assert.ok(err instanceof DropboxFetchError);
        assert.equal(err.code, "forbidden");
        return true;
      },
    );
  });

  it("throws not_found on 404 from get_shared_link_file", async () => {
    setValidEnv();
    mock.method(globalThis, "fetch", async (url: string) => {
      if (url === TOKEN_URL) return tokenOk();
      return makeResponse({ status: 404, ok: false });
    });
    await assert.rejects(
      () => fetchDropboxFileContent(SHARE_URL, entry),
      (err: unknown) => {
        assert.ok(err instanceof DropboxFetchError);
        assert.equal(err.code, "not_found");
        return true;
      },
    );
  });
});
