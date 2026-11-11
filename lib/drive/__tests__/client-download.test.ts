/** restDriveApi.downloadTo streams the response body to disk; the file is never one Buffer. */

import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { restDriveApi } from "../client.ts";

const CHUNK = 1024 * 1024;
const TOTAL = 128 * CHUNK + 4321;

function serviceAccount() {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return { client_email: "export@test.iam", private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
}

describe("restDriveApi.downloadTo", () => {
  it("writes a 128 MB body to disk chunk by chunk, with its sha256 and size, under 32 MB of buffers", async () => {
    const block = randomBytes(CHUNK);
    const base = process.memoryUsage().arrayBuffers;
    let peak = 0;
    const sample = () => {
      peak = Math.max(peak, process.memoryUsage().arrayBuffers - base);
    };
    const expected = createHash("sha256");
    for (let sent = 0; sent < TOTAL; sent += CHUNK) expected.update(block.subarray(0, Math.min(CHUNK, TOTAL - sent)));

    const urls: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("oauth2")) return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 });
      let sent = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          sample();
          if (sent >= TOTAL) return controller.close();
          const n = Math.min(CHUNK, TOTAL - sent);
          sent += n;
          controller.enqueue(new Uint8Array(block.buffer, block.byteOffset, n));
        },
      });
      return new Response(body, { status: 200 });
    }) as typeof fetch;

    const dir = mkdtempSync(path.join(tmpdir(), "drive-download-"));
    try {
      const drive = restDriveApi({ driveId: "D", serviceAccount: serviceAccount(), fetchImpl });
      const target = path.join(dir, "original.mp4");
      const identity = await drive.downloadTo!("file-1", target);
      sample();
      assert.equal(identity.byteSize, TOTAL);
      assert.equal(identity.contentHash, expected.digest("hex"));
      assert.equal(statSync(target).size, TOTAL);
      assert.ok(peak < 32 * CHUNK, `peak array-buffer memory ${Math.round(peak / CHUNK)} MB`);
      assert.ok(urls.some((u) => u.includes("/files/file-1?alt=media&supportsAllDrives=true")));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a Drive error rejects with the status and reason", async () => {
    const fetchImpl = (async (input: string | URL | Request) => {
      if (String(input).includes("oauth2")) return new Response(JSON.stringify({ access_token: "t" }), { status: 200 });
      return new Response(JSON.stringify({ error: { errors: [{ reason: "notFound" }] } }), { status: 404 });
    }) as typeof fetch;
    const dir = mkdtempSync(path.join(tmpdir(), "drive-download-"));
    try {
      const drive = restDriveApi({ driveId: "D", serviceAccount: serviceAccount(), fetchImpl });
      await assert.rejects(() => drive.downloadTo!("gone", path.join(dir, "x.mp4")), /HTTP 404 notFound/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
