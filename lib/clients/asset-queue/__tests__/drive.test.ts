/**
 * Tests for the Google Drive asset-queue source provider (drive.ts + drive-auth.ts).
 *
 * Mirrors dropbox.test.ts / dropbox-auth.test.ts coverage:
 *
 *   signServiceAccountJwt (fixture keypair):
 *     - emits header.payload.signature with RS256/JWT header
 *     - claims carry iss, drive.readonly scope, aud, iat, exp=iat+3600
 *     - signature verifies against the matching public key
 *     - normalises literal "\n" escapes in the private key
 *
 *   getDriveAccessToken:
 *     - config_missing when env var absent / malformed / missing fields
 *     - 200 success → returns + caches token (one network call across two reads)
 *     - expired cache → re-fetches
 *     - 400/401 → forbidden, 500 → network, fetch throw → network
 *
 *   parseFolderId / parseFileId / isDriveUrl / isDriveFolderUrl
 *
 *   listFolderRecursive (mock fetch):
 *     - yields files, recurses into subfolders, follows nextPageToken
 *     - depth cap → network error
 *     - 401/403/429 → forbidden, 404 → not_found, 500 → network
 *
 *   downloadFile: 200 → buffer + mimeType, content-length > cap → too_large,
 *     404 → not_found, 401 → forbidden
 *
 *   downloadDriveFolderFiles: media filter, empty_folder, folder_too_large
 *   downloadDriveAsset: parse id → metadata → download
 *   mimeToExtension: mime map + filename fallback + bin default
 *
 * Run: node --test (repo's test runner).
 */

import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { generateKeyPairSync, createVerify } from "node:crypto";

import {
  parseFolderId,
  parseFileId,
  isDriveUrl,
  isDriveFolderUrl,
  listFolderRecursive,
  getFileMetadata,
  downloadFile,
  downloadDriveFolderFiles,
  downloadDriveAsset,
  mimeToExtension,
  DriveFetchError,
} from "../drive.ts";
import {
  signServiceAccountJwt,
  getDriveAccessToken,
  _clearDriveTokenCache,
} from "../drive-auth.ts";

// ─── Fixture keypair (generated once per test run) ───────────────────────────

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM_PRIVATE = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const PEM_PUBLIC = publicKey.export({ type: "spki", format: "pem" }).toString();

const SA = {
  client_email: "svc@proj.iam.gserviceaccount.com",
  private_key: PEM_PRIVATE,
};

function b64urlToBuffer(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function decodeSegment(s: string): Record<string, unknown> {
  return JSON.parse(b64urlToBuffer(s).toString("utf8")) as Record<string, unknown>;
}

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

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const FILES_BASE = "https://www.googleapis.com/drive/v3/files";

function tokenOk(accessToken = "ya29.test_token", expiresIn = 3600) {
  return makeResponse({
    status: 200,
    ok: true,
    body: { access_token: accessToken, expires_in: expiresIn, token_type: "Bearer" },
  });
}

function listOk(files: unknown[], nextPageToken?: string) {
  return makeResponse({ status: 200, ok: true, body: { files, nextPageToken } });
}

/** Reads the ?q= parents filter target folder id from a files.list URL. */
function listedFolderId(url: string): string | null {
  const u = new URL(url);
  const q = u.searchParams.get("q") ?? "";
  const m = q.match(/'([^']+)' in parents/);
  return m?.[1] ?? null;
}

function pageTokenOf(url: string): string | null {
  return new URL(url).searchParams.get("pageToken");
}

const FOLDER_MIME = "application/vnd.google-apps.folder";

// ─── Env + cache harness ─────────────────────────────────────────────────────

const SAVED = { GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON: process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON };

function setValidEnv() {
  process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON = JSON.stringify(SA);
}

afterEach(() => {
  for (const [k, v] of Object.entries(SAVED)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  _clearDriveTokenCache();
  mock.restoreAll();
});

// ─── signServiceAccountJwt ───────────────────────────────────────────────────

describe("signServiceAccountJwt", () => {
  it("emits a three-part JWT with RS256/JWT header", () => {
    const jwt = signServiceAccountJwt(SA, 1_000_000);
    const parts = jwt.split(".");
    assert.equal(parts.length, 3);
    const header = decodeSegment(parts[0]);
    assert.equal(header.alg, "RS256");
    assert.equal(header.typ, "JWT");
  });

  it("sets iss, drive.readonly scope, aud, and exp=iat+3600", () => {
    const now = 1_700_000_000;
    const jwt = signServiceAccountJwt(SA, now);
    const claims = decodeSegment(jwt.split(".")[1]);
    assert.equal(claims.iss, SA.client_email);
    assert.equal(claims.scope, "https://www.googleapis.com/auth/drive.readonly");
    assert.equal(claims.aud, TOKEN_URL);
    assert.equal(claims.iat, now);
    assert.equal(claims.exp, now + 3600);
  });

  it("produces a signature that verifies against the matching public key", () => {
    const jwt = signServiceAccountJwt(SA, 1_700_000_000);
    const [h, p, s] = jwt.split(".");
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${h}.${p}`);
    verifier.end();
    assert.ok(verifier.verify(PEM_PUBLIC, b64urlToBuffer(s)), "signature must verify");
  });

  it("normalises literal \\n escapes in the private key", () => {
    const escaped = { ...SA, private_key: PEM_PRIVATE.replace(/\n/g, "\\n") };
    const jwt = signServiceAccountJwt(escaped, 1_700_000_000);
    const [h, p, s] = jwt.split(".");
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${h}.${p}`);
    verifier.end();
    assert.ok(verifier.verify(PEM_PUBLIC, b64urlToBuffer(s)));
  });
});

// ─── getDriveAccessToken ─────────────────────────────────────────────────────

describe("getDriveAccessToken — config", () => {
  it("throws config_missing when env var is absent", async () => {
    delete process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON;
    await assert.rejects(
      () => getDriveAccessToken(),
      (err: unknown) => {
        assert.ok(err instanceof DriveFetchError);
        assert.equal(err.code, "config_missing");
        return true;
      },
    );
  });

  it("throws config_missing when JSON is malformed", async () => {
    process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON = "{not json";
    await assert.rejects(
      () => getDriveAccessToken(),
      (err: unknown) => err instanceof DriveFetchError && err.code === "config_missing",
    );
  });

  it("throws config_missing when client_email / private_key missing", async () => {
    process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: "x" });
    await assert.rejects(
      () => getDriveAccessToken(),
      (err: unknown) => err instanceof DriveFetchError && err.code === "config_missing",
    );
  });
});

describe("getDriveAccessToken — success + caching", () => {
  it("returns the access token on 200", async () => {
    setValidEnv();
    mock.method(globalThis, "fetch", async (url: string) => {
      assert.equal(url, TOKEN_URL);
      return tokenOk("ya29.fresh");
    });
    assert.equal(await getDriveAccessToken(), "ya29.fresh");
  });

  it("caches the token (token endpoint called once across two reads)", async () => {
    setValidEnv();
    let calls = 0;
    mock.method(globalThis, "fetch", async () => {
      calls++;
      return tokenOk("ya29.cached", 3600);
    });
    const a = await getDriveAccessToken();
    const b = await getDriveAccessToken();
    assert.equal(a, "ya29.cached");
    assert.equal(b, "ya29.cached");
    assert.equal(calls, 1);
  });

  it("re-fetches when the cache TTL is elapsed", async () => {
    setValidEnv();
    let calls = 0;
    mock.method(globalThis, "fetch", async () => {
      calls++;
      return tokenOk(`ya29.tok_${calls}`, 0); // expires_in=0 → immediately stale
    });
    const a = await getDriveAccessToken();
    const b = await getDriveAccessToken();
    assert.equal(a, "ya29.tok_1");
    assert.equal(b, "ya29.tok_2");
    assert.equal(calls, 2);
  });
});

describe("getDriveAccessToken — error responses", () => {
  it("throws forbidden on 400", async () => {
    setValidEnv();
    mock.method(globalThis, "fetch", async () =>
      makeResponse({ status: 400, ok: false, body: { error: "invalid_grant" } }),
    );
    await assert.rejects(
      () => getDriveAccessToken(),
      (err: unknown) => err instanceof DriveFetchError && err.code === "forbidden",
    );
  });

  it("throws forbidden on 401", async () => {
    setValidEnv();
    mock.method(globalThis, "fetch", async () =>
      makeResponse({ status: 401, ok: false, text: "unauthorized" }),
    );
    await assert.rejects(
      () => getDriveAccessToken(),
      (err: unknown) => err instanceof DriveFetchError && err.code === "forbidden",
    );
  });

  it("throws network on 500", async () => {
    setValidEnv();
    mock.method(globalThis, "fetch", async () =>
      makeResponse({ status: 500, ok: false, text: "server error" }),
    );
    await assert.rejects(
      () => getDriveAccessToken(),
      (err: unknown) => err instanceof DriveFetchError && err.code === "network",
    );
  });

  it("throws network on fetch exception", async () => {
    setValidEnv();
    mock.method(globalThis, "fetch", async () => {
      throw new Error("ECONNREFUSED");
    });
    await assert.rejects(
      () => getDriveAccessToken(),
      (err: unknown) => err instanceof DriveFetchError && err.code === "network",
    );
  });
});

// ─── URL + id parsing ────────────────────────────────────────────────────────

describe("parseFolderId / parseFileId / detection", () => {
  it("parses folderId from a shared folder URL", () => {
    assert.equal(
      parseFolderId("https://drive.google.com/drive/folders/18x_-SlTomoxo3zm-InHSADRF7_P1antL?usp=sharing"),
      "18x_-SlTomoxo3zm-InHSADRF7_P1antL",
    );
  });

  it("parses folderId from /drive/u/0/folders/ URL", () => {
    assert.equal(
      parseFolderId("https://drive.google.com/drive/u/0/folders/ABC123_xyz"),
      "ABC123_xyz",
    );
  });

  it("parses fileId from a /file/d/ URL", () => {
    assert.equal(
      parseFileId("https://drive.google.com/file/d/1a2B3c-D4e_F/view?usp=sharing"),
      "1a2B3c-D4e_F",
    );
  });

  it("parses id from an open?id= URL for both parsers", () => {
    assert.equal(parseFileId("https://drive.google.com/open?id=FILEID99"), "FILEID99");
    assert.equal(parseFolderId("https://drive.google.com/open?id=FOLDERID99"), "FOLDERID99");
  });

  it("returns null for non-Drive URLs", () => {
    assert.equal(parseFolderId("https://www.dropbox.com/scl/fo/abc"), null);
    assert.equal(parseFileId("https://example.com/x"), null);
  });

  it("isDriveUrl recognises drive + docs hosts, rejects dropbox", () => {
    assert.equal(isDriveUrl("https://drive.google.com/drive/folders/x"), true);
    assert.equal(isDriveUrl("https://docs.google.com/spreadsheets/d/x"), true);
    assert.equal(isDriveUrl("https://www.dropbox.com/scl/fo/x"), false);
  });

  it("isDriveFolderUrl only matches folder links", () => {
    assert.equal(isDriveFolderUrl("https://drive.google.com/drive/folders/x"), true);
    assert.equal(isDriveFolderUrl("https://drive.google.com/file/d/x/view"), false);
  });
});

// ─── listFolderRecursive ─────────────────────────────────────────────────────

async function collect(folderId: string) {
  const out = [];
  for await (const e of listFolderRecursive(folderId)) out.push(e);
  return out;
}

describe("listFolderRecursive — walk", () => {
  it("throws config_missing when credentials absent (auth layer)", async () => {
    delete process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON;
    await assert.rejects(
      () => collect("root"),
      (err: unknown) => err instanceof DriveFetchError && err.code === "config_missing",
    );
  });

  it("yields files and recurses into subfolders", async () => {
    setValidEnv();
    mock.method(globalThis, "fetch", async (url: string) => {
      if (url === TOKEN_URL) return tokenOk();
      const folder = listedFolderId(url);
      if (folder === "root") {
        return listOk([
          { id: "f1", name: "hero.mp4", mimeType: "video/mp4", size: "1000" },
          { id: "sub", name: "V2", mimeType: FOLDER_MIME },
        ]);
      }
      if (folder === "sub") {
        return listOk([
          { id: "f2", name: "clip.mov", mimeType: "video/quicktime", size: "2000" },
        ]);
      }
      throw new Error(`unexpected folder: ${folder}`);
    });

    const entries = await collect("root");
    const names = entries.map((e) => e.name).sort();
    assert.deepEqual(names, ["clip.mov", "hero.mp4"]);
    assert.ok(entries.find((e) => e.id === "f2" && e.mimeType === "video/quicktime"));
  });

  it("follows nextPageToken pagination within a folder", async () => {
    setValidEnv();
    mock.method(globalThis, "fetch", async (url: string) => {
      if (url === TOKEN_URL) return tokenOk();
      const page = pageTokenOf(url);
      if (!page) {
        return listOk([{ id: "a", name: "a.jpg", mimeType: "image/jpeg", size: "1" }], "PAGE2");
      }
      if (page === "PAGE2") {
        return listOk([{ id: "b", name: "b.png", mimeType: "image/png", size: "2" }]);
      }
      throw new Error(`unexpected page: ${page}`);
    });

    const entries = await collect("root");
    assert.deepEqual(entries.map((e) => e.name).sort(), ["a.jpg", "b.png"]);
  });

  it("throws network when nesting exceeds 5 levels", async () => {
    setValidEnv();
    // Every folder returns a single child folder → infinite depth → cap trips.
    mock.method(globalThis, "fetch", async (url: string) => {
      if (url === TOKEN_URL) return tokenOk();
      const folder = listedFolderId(url);
      return listOk([{ id: `${folder}-child`, name: "deeper", mimeType: FOLDER_MIME }]);
    });

    await assert.rejects(
      () => collect("root"),
      (err: unknown) => {
        assert.ok(err instanceof DriveFetchError);
        assert.equal(err.code, "network");
        assert.match(err.message, /nesting exceeds/);
        return true;
      },
    );
  });

  for (const [status, code] of [
    [401, "forbidden"],
    [403, "forbidden"],
    [429, "forbidden"],
    [404, "not_found"],
    [500, "network"],
  ] as const) {
    it(`maps files.list HTTP ${status} → ${code}`, async () => {
      setValidEnv();
      mock.method(globalThis, "fetch", async (url: string) => {
        if (url === TOKEN_URL) return tokenOk();
        return makeResponse({ status, ok: false, text: "err" });
      });
      await assert.rejects(
        () => collect("root"),
        (err: unknown) => err instanceof DriveFetchError && err.code === code,
      );
    });
  }
});

// ─── getFileMetadata + downloadFile ──────────────────────────────────────────

describe("getFileMetadata", () => {
  it("returns normalised metadata on 200", async () => {
    setValidEnv();
    mock.method(globalThis, "fetch", async (url: string) => {
      if (url === TOKEN_URL) return tokenOk();
      return makeResponse({
        status: 200,
        ok: true,
        body: { id: "fid", name: "art.png", mimeType: "image/png", size: "1234", modifiedTime: "2026-01-01T00:00:00Z" },
      });
    });
    const meta = await getFileMetadata("fid");
    assert.equal(meta.name, "art.png");
    assert.equal(meta.mimeType, "image/png");
    assert.equal(meta.size, 1234);
  });

  it("throws not_found on 404", async () => {
    setValidEnv();
    mock.method(globalThis, "fetch", async (url: string) => {
      if (url === TOKEN_URL) return tokenOk();
      return makeResponse({ status: 404, ok: false });
    });
    await assert.rejects(
      () => getFileMetadata("fid"),
      (err: unknown) => err instanceof DriveFetchError && err.code === "not_found",
    );
  });
});

describe("downloadFile", () => {
  const MB = 1024 * 1024;

  it("returns buffer + mimeType on 200", async () => {
    setValidEnv();
    const bytes = new TextEncoder().encode("VIDEOBYTES").buffer;
    mock.method(globalThis, "fetch", async (url: string) => {
      if (url === TOKEN_URL) return tokenOk();
      assert.match(url, /alt=media/);
      return makeResponse({ status: 200, ok: true, headers: { "content-type": "video/mp4" }, arrayBuffer: bytes });
    });
    const { buffer, mimeType } = await downloadFile("fid");
    assert.equal(mimeType, "video/mp4");
    assert.ok(buffer.byteLength > 0);
  });

  it("throws too_large when content-length exceeds 200 MB", async () => {
    setValidEnv();
    mock.method(globalThis, "fetch", async (url: string) => {
      if (url === TOKEN_URL) return tokenOk();
      return makeResponse({
        status: 200,
        ok: true,
        headers: { "content-type": "video/mp4", "content-length": String(250 * MB) },
      });
    });
    await assert.rejects(
      () => downloadFile("fid"),
      (err: unknown) => err instanceof DriveFetchError && err.code === "too_large",
    );
  });

  it("throws forbidden on 401", async () => {
    setValidEnv();
    mock.method(globalThis, "fetch", async (url: string) => {
      if (url === TOKEN_URL) return tokenOk();
      return makeResponse({ status: 401, ok: false });
    });
    await assert.rejects(
      () => downloadFile("fid"),
      (err: unknown) => err instanceof DriveFetchError && err.code === "forbidden",
    );
  });
});

// ─── downloadDriveFolderFiles ────────────────────────────────────────────────

const GB = 1024 * 1024 * 1024;

describe("downloadDriveFolderFiles", () => {
  const FOLDER_URL = "https://drive.google.com/drive/folders/FOLDER1?usp=sharing";

  it("downloads media files, skips non-media", async () => {
    setValidEnv();
    mock.method(globalThis, "fetch", async (url: string) => {
      if (url === TOKEN_URL) return tokenOk();
      if (url.startsWith(FILES_BASE) && listedFolderId(url)) {
        return listOk([
          { id: "v1", name: "reel.mp4", mimeType: "video/mp4", size: "1000" },
          { id: "n1", name: "notes.txt", mimeType: "text/plain", size: "10" },
        ]);
      }
      // download branch
      return makeResponse({ status: 200, ok: true, headers: { "content-type": "video/mp4" }, arrayBuffer: new ArrayBuffer(8) });
    });

    const files = await downloadDriveFolderFiles(FOLDER_URL);
    assert.equal(files.length, 1);
    assert.equal(files[0].name, "reel.mp4");
    assert.equal(files[0].extension, "mp4");
  });

  it("throws empty_folder when no media files present", async () => {
    setValidEnv();
    mock.method(globalThis, "fetch", async (url: string) => {
      if (url === TOKEN_URL) return tokenOk();
      return listOk([{ id: "n1", name: "notes.txt", mimeType: "text/plain", size: "10" }]);
    });
    await assert.rejects(
      () => downloadDriveFolderFiles(FOLDER_URL),
      (err: unknown) => err instanceof DriveFetchError && err.code === "empty_folder",
    );
  });

  it("throws folder_too_large when total exceeds 2 GB", async () => {
    setValidEnv();
    mock.method(globalThis, "fetch", async (url: string) => {
      if (url === TOKEN_URL) return tokenOk();
      return listOk([{ id: "big", name: "huge.mp4", mimeType: "video/mp4", size: String(Math.floor(2.5 * GB)) }]);
    });
    await assert.rejects(
      () => downloadDriveFolderFiles(FOLDER_URL),
      (err: unknown) => {
        assert.ok(err instanceof DriveFetchError);
        assert.equal(err.code, "folder_too_large");
        assert.match(err.message, /2 GB limit/);
        return true;
      },
    );
  });

  it("throws not_found when the URL has no parseable folder id", async () => {
    setValidEnv();
    await assert.rejects(
      () => downloadDriveFolderFiles("https://drive.google.com/nonsense"),
      (err: unknown) => err instanceof DriveFetchError && err.code === "not_found",
    );
  });
});

// ─── downloadDriveAsset ──────────────────────────────────────────────────────

describe("downloadDriveAsset", () => {
  it("resolves metadata + downloads a single file", async () => {
    setValidEnv();
    mock.method(globalThis, "fetch", async (url: string) => {
      if (url === TOKEN_URL) return tokenOk();
      if (url.includes("alt=media")) {
        return makeResponse({ status: 200, ok: true, headers: { "content-type": "image/png" }, arrayBuffer: new ArrayBuffer(4) });
      }
      // metadata
      return makeResponse({ status: 200, ok: true, body: { id: "F", name: "poster.png", mimeType: "image/png", size: "4" } });
    });

    const { buffer, extension, name } = await downloadDriveAsset("https://drive.google.com/file/d/F/view");
    assert.equal(name, "poster.png");
    assert.equal(extension, "png");
    assert.ok(buffer.byteLength > 0);
  });
});

// ─── mimeToExtension ─────────────────────────────────────────────────────────

describe("mimeToExtension", () => {
  it("maps known mime types", () => {
    assert.equal(mimeToExtension("video/mp4"), "mp4");
    assert.equal(mimeToExtension("video/quicktime"), "mov");
    assert.equal(mimeToExtension("image/jpeg"), "jpg");
    assert.equal(mimeToExtension("image/png; charset=binary"), "png");
  });

  it("falls back to the filename extension", () => {
    assert.equal(mimeToExtension("application/octet-stream", "clip.webm"), "webm");
  });

  it("returns bin when nothing matches", () => {
    assert.equal(mimeToExtension("application/octet-stream", ""), "bin");
    assert.equal(mimeToExtension("application/octet-stream", "file.superlongextension"), "bin");
  });
});
