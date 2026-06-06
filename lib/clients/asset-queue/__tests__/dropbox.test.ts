/**
 * Tests for the refactored Dropbox folder-listing integration.
 *
 * Authentication is handled by dropbox-auth.ts (refresh-token flow).
 * These tests mock both the OAuth2 token endpoint AND the Dropbox API
 * endpoints. The shared fetch mock routes calls by URL + request body.path
 * to simulate the recursive subfolder walk.
 *
 * Covers:
 *   listDropboxFolderFiles — recursive walk:
 *     - Missing credentials → DropboxFetchError("config_missing") via auth layer
 *     - Root with files only (no subfolders) → backward compat, returns root files
 *     - Root with V1 + V2 subfolders → all files aggregated (3 total)
 *     - Root with only a subfolder, no root files → returns subfolder files (not empty_folder)
 *     - Deep nesting (root → A → B → file.png) → returns file with path /a/b/file.png
 *     - Pathological depth (7 levels) → throws DropboxFetchError("network", depth exceeded)
 *     - Subfolder with has_more=true → paginated, all files returned
 *     - POST body does NOT contain recursive=true at any depth
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

const TOKEN_URL       = "https://api.dropbox.com/oauth2/token";
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

/** Builds a list_folder success response with the given entries. */
function listOk(
  entries: unknown[],
  opts: { has_more?: boolean; cursor?: string } = {},
) {
  return makeResponse({
    status: 200,
    ok: true,
    body: { entries, has_more: opts.has_more ?? false, cursor: opts.cursor },
  });
}

/** Parse the path from a list_folder request body. */
function bodyPath(init?: RequestInit): string {
  const body = JSON.parse((init?.body as string) ?? "{}") as { path?: string };
  return body.path ?? "";
}

/** Parse the cursor from a list_folder/continue request body. */
function bodyCursor(init?: RequestInit): string {
  const body = JSON.parse((init?.body as string) ?? "{}") as { cursor?: string };
  return body.cursor ?? "";
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

// ─── listDropboxFolderFiles — recursive walk ─────────────────────────────────

describe("listDropboxFolderFiles — recursive walk", () => {
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

  it("returns root files when root contains only files (backward compatible)", async () => {
    setValidEnv();
    mock.method(globalThis, "fetch", async (url: string) => {
      if (url === TOKEN_URL) return tokenOk();
      assert.equal(url, LIST_FOLDER_URL);
      return listOk([
        { ".tag": "file", name: "video.mp4", path_lower: "/video.mp4", size: 10_000_000 },
        { ".tag": "file", name: "thumb.jpg", path_lower: "/thumb.jpg", size: 50_000 },
      ]);
    });
    const entries = await listDropboxFolderFiles(SHARE_URL);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].name, "video.mp4");
    assert.equal(entries[1].name, "thumb.jpg");
  });

  it("does NOT send recursive=true in any list_folder POST body", async () => {
    setValidEnv();
    const bodies: string[] = [];
    mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
      if (url === TOKEN_URL) return tokenOk();
      if (url === LIST_FOLDER_URL) {
        bodies.push(init?.body as string);
        return listOk([{ ".tag": "file", name: "a.mp4", path_lower: "/a.mp4", size: 1 }]);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    await listDropboxFolderFiles(SHARE_URL);
    for (const body of bodies) {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      assert.ok(!("recursive" in parsed), `recursive key found in body: ${body}`);
    }
  });

  it("aggregates files from V1 + V2 subfolders (multi-level fixture)", async () => {
    setValidEnv();
    mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
      if (url === TOKEN_URL) return tokenOk();
      if (url === LIST_FOLDER_URL) {
        const path = bodyPath(init);
        if (path === "") {
          // Root: two subfolders, no root files
          return listOk([
            { ".tag": "folder", name: "V1", path_lower: "/v1" },
            { ".tag": "folder", name: "V2", path_lower: "/v2" },
          ]);
        }
        if (path === "/v1") {
          return listOk([
            { ".tag": "file", name: "old.mp4", path_lower: "/v1/old.mp4", size: 5_000_000 },
          ]);
        }
        if (path === "/v2") {
          return listOk([
            { ".tag": "file", name: "file1.mp4", path_lower: "/v2/file1.mp4", size: 8_000_000 },
            { ".tag": "file", name: "file2.jpg", path_lower: "/v2/file2.jpg", size: 100_000 },
          ]);
        }
        throw new Error(`Unexpected list_folder path: ${path}`);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const entries = await listDropboxFolderFiles(SHARE_URL);
    assert.equal(entries.length, 3);
    const names = entries.map((e) => e.name).sort();
    assert.deepEqual(names, ["file1.mp4", "file2.jpg", "old.mp4"]);
    // paths must be the full path_lower as Dropbox returned
    assert.ok(entries.some((e) => e.path_lower === "/v1/old.mp4"));
    assert.ok(entries.some((e) => e.path_lower === "/v2/file1.mp4"));
    assert.ok(entries.some((e) => e.path_lower === "/v2/file2.jpg"));
  });

  it("returns subfolder files when root has no files (no empty_folder error)", async () => {
    setValidEnv();
    mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
      if (url === TOKEN_URL) return tokenOk();
      if (url === LIST_FOLDER_URL) {
        const path = bodyPath(init);
        if (path === "") {
          return listOk([{ ".tag": "folder", name: "Assets", path_lower: "/assets" }]);
        }
        if (path === "/assets") {
          return listOk([
            { ".tag": "file", name: "hero.mp4", path_lower: "/assets/hero.mp4", size: 20_000_000 },
          ]);
        }
        throw new Error(`Unexpected path: ${path}`);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const entries = await listDropboxFolderFiles(SHARE_URL);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].name, "hero.mp4");
    assert.equal(entries[0].path_lower, "/assets/hero.mp4");
  });

  it("handles deep nesting: root → A → B → file.png (depth 2)", async () => {
    setValidEnv();
    mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
      if (url === TOKEN_URL) return tokenOk();
      if (url === LIST_FOLDER_URL) {
        const path = bodyPath(init);
        if (path === "") return listOk([{ ".tag": "folder", name: "A", path_lower: "/a" }]);
        if (path === "/a") return listOk([{ ".tag": "folder", name: "B", path_lower: "/a/b" }]);
        if (path === "/a/b") {
          return listOk([{ ".tag": "file", name: "file.png", path_lower: "/a/b/file.png", size: 500 }]);
        }
        throw new Error(`Unexpected path: ${path}`);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const entries = await listDropboxFolderFiles(SHARE_URL);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].path_lower, "/a/b/file.png");
  });

  it("throws network error when depth exceeds 5 levels", async () => {
    setValidEnv();
    // 7 levels deep: root → /1 → /1/2 → /1/2/3 → /1/2/3/4 → /1/2/3/4/5 → /1/2/3/4/5/6
    const depthFolders: Record<string, string> = {
      "": "/1",
      "/1": "/1/2",
      "/1/2": "/1/2/3",
      "/1/2/3": "/1/2/3/4",
      "/1/2/3/4": "/1/2/3/4/5",
      "/1/2/3/4/5": "/1/2/3/4/5/6",
    };
    mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
      if (url === TOKEN_URL) return tokenOk();
      if (url === LIST_FOLDER_URL) {
        const path = bodyPath(init);
        if (path in depthFolders) {
          const nextPath = depthFolders[path];
          return listOk([{ ".tag": "folder", name: nextPath.split("/").pop(), path_lower: nextPath }]);
        }
        return listOk([{ ".tag": "file", name: "deep.mp4", path_lower: `${path}/deep.mp4`, size: 1 }]);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    await assert.rejects(
      () => listDropboxFolderFiles(SHARE_URL),
      (err: unknown) => {
        assert.ok(err instanceof DropboxFetchError);
        assert.equal(err.code, "network");
        assert.ok(
          err.message.includes("nesting exceeds"),
          `Expected depth-exceeded message, got: ${err.message}`,
        );
        return true;
      },
    );
  });

  it("paginates within a subfolder (subfolder has_more=true → continue)", async () => {
    setValidEnv();
    mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
      if (url === TOKEN_URL) return tokenOk();
      if (url === LIST_FOLDER_URL) {
        const path = bodyPath(init);
        if (path === "") {
          return listOk([{ ".tag": "folder", name: "Videos", path_lower: "/videos" }]);
        }
        if (path === "/videos") {
          // First page of /videos — has more
          return listOk(
            [{ ".tag": "file", name: "clip_a.mp4", path_lower: "/videos/clip_a.mp4", size: 1 }],
            { has_more: true, cursor: "subfolder_cursor_1" },
          );
        }
        throw new Error(`Unexpected list_folder path: ${path}`);
      }
      if (url === CONTINUE_URL) {
        const cursor = bodyCursor(init);
        if (cursor === "subfolder_cursor_1") {
          return listOk([{ ".tag": "file", name: "clip_b.mp4", path_lower: "/videos/clip_b.mp4", size: 2 }]);
        }
        throw new Error(`Unexpected cursor: ${cursor}`);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const entries = await listDropboxFolderFiles(SHARE_URL);
    assert.equal(entries.length, 2);
    assert.ok(entries.some((e) => e.name === "clip_a.mp4"));
    assert.ok(entries.some((e) => e.name === "clip_b.mp4"));
  });

  it("paginates root via /continue and recurses into subfolder on page 2", async () => {
    setValidEnv();
    mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
      if (url === TOKEN_URL) return tokenOk();
      if (url === LIST_FOLDER_URL) {
        const path = bodyPath(init);
        if (path === "") {
          return listOk(
            [{ ".tag": "file", name: "a.mp4", path_lower: "/a.mp4", size: 1 }],
            { has_more: true, cursor: "root_cursor_1" },
          );
        }
        if (path === "/sub") {
          return listOk([{ ".tag": "file", name: "b.mp4", path_lower: "/sub/b.mp4", size: 2 }]);
        }
        throw new Error(`Unexpected path: ${path}`);
      }
      if (url === CONTINUE_URL) {
        return listOk([{ ".tag": "folder", name: "sub", path_lower: "/sub" }]);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const entries = await listDropboxFolderFiles(SHARE_URL);
    assert.equal(entries.length, 2);
    assert.ok(entries.some((e) => e.name === "a.mp4"));
    assert.ok(entries.some((e) => e.name === "b.mp4"));
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
