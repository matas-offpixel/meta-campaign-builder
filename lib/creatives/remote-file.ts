/**
 * An original read where it lives (Drive), never written to disk.
 *
 * 11 Nov 2026: SWEELY 1.mp4 (449,059,415 B) failed in the Drive pickup with
 * ffmpeg's "Error submitting a packet" — the function's /tmp ("writable
 * /tmp scratch space up to 500 MB", vercel.com/docs/functions/runtimes)
 * could not hold the original and its 1080 copy at once. B3B12.mp4 had fit:
 * 406,425,869 B + a 125,998,784 B copy = 532,424,653 B.
 *
 * So an over-cap original is read three ways, none touching disk:
 *   - fingerprint(): one streamed pass for the sha256 and byte count (dedupe);
 *   - readRange(): byte ranges, for the moov probe;
 *   - serve(): a loopback HTTP URL that ffmpeg reads with range requests. The
 *     server forwards each range to the origin with the credentials added
 *     there, so the token is never on ffmpeg's command line, in its errors,
 *     or in anything this module returns.
 */

import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

import type { ContentIdentity } from "./asset-registry.ts";

/**
 * One request to the origin: `range` is an HTTP Range value ("bytes=0-99")
 * or null for the whole file. Credentials are the caller's business; the
 * Response must be 200 or 206 on success.
 */
export type FetchRange = (range: string | null, signal?: AbortSignal) => Promise<Response>;

export type ServedOriginal = { url: string; close(): Promise<void> };

export type RemoteOriginal = {
  /** sha256 and byte count from one streamed pass. Nothing is written to disk. */
  fingerprint(): Promise<ContentIdentity>;
  /** Exactly `length` bytes from `start`. Refuses an origin that ignores the range (it would send the whole file). */
  readRange(start: number, length: number): Promise<Buffer>;
  /** A loopback URL serving the original with range support, without credentials. Close it when done. */
  serve(): Promise<ServedOriginal>;
};

/** The registry fingerprint of a stream, hashed as it passes; nothing is kept. */
export async function fingerprintStream(body: ReadableStream<Uint8Array> | WebReadableStream<Uint8Array>): Promise<ContentIdentity> {
  const hash = createHash("sha256");
  let byteSize = 0;
  for await (const chunk of Readable.fromWeb(body as WebReadableStream<Uint8Array>)) {
    const bytes = chunk as Buffer;
    hash.update(bytes);
    byteSize += bytes.byteLength;
  }
  return { contentHash: hash.digest("hex"), byteSize };
}

async function discard(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    /* already closed */
  }
}

export function remoteOriginal(fetchRange: FetchRange): RemoteOriginal {
  return {
    async fingerprint() {
      const res = await fetchRange(null);
      if (!res.body) throw new Error("The original's download returned no body.");
      return fingerprintStream(res.body);
    },

    async readRange(start, length) {
      if (length <= 0) return Buffer.alloc(0);
      const res = await fetchRange(`bytes=${start}-${start + length - 1}`);
      if (res.status !== 206) {
        await discard(res);
        throw new Error(`The original's host ignored a range request (HTTP ${res.status}).`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength < length) throw new Error("The original's host returned a short range.");
      return buf.subarray(0, length);
    },

    serve: () => serveRanges(fetchRange),
  };
}

const PASSED_HEADERS = ["content-type", "content-length", "content-range", "accept-ranges", "last-modified", "etag"];

/**
 * A loopback HTTP server for one original. GET and HEAD, the client's Range
 * passed through, the origin's status and length headers passed back, the
 * body piped with backpressure. A client that disconnects (ffmpeg seeking)
 * aborts its origin request. The path is random, the host 127.0.0.1.
 */
export async function serveRanges(fetchRange: FetchRange): Promise<ServedOriginal> {
  const secretPath = `/${randomBytes(16).toString("hex")}`;
  const open = new Set<AbortController>();

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url !== secretPath || (req.method !== "GET" && req.method !== "HEAD")) {
      res.writeHead(404).end();
      return;
    }
    const abort = new AbortController();
    open.add(abort);
    const done = () => {
      abort.abort();
      open.delete(abort);
    };
    req.on("close", done);
    res.on("close", done);
    try {
      const range = typeof req.headers.range === "string" ? req.headers.range : null;
      const upstream = await fetchRange(range, abort.signal);
      const headers: Record<string, string> = { "accept-ranges": "bytes" };
      for (const name of PASSED_HEADERS) {
        const value = upstream.headers.get(name);
        if (value) headers[name] = value;
      }
      if (upstream.status !== 200 && upstream.status !== 206) {
        await discard(upstream);
        // The status only: an origin's error body can carry request details.
        res.writeHead(upstream.status === 416 ? 416 : 502).end();
        return;
      }
      res.writeHead(upstream.status, headers);
      if (req.method === "HEAD" || !upstream.body) {
        await discard(upstream);
        res.end();
        return;
      }
      Readable.fromWeb(upstream.body as WebReadableStream<Uint8Array>)
        .on("error", () => res.destroy())
        .pipe(res);
    } catch {
      if (!res.headersSent) res.writeHead(502).end();
      else res.destroy();
    }
  };

  const server = createServer((req, res) => {
    void handle(req, res);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}${secretPath}`,
    async close() {
      for (const abort of open) abort.abort();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
