/**
 * Write a download to disk and fingerprint it in the same pass, without
 * holding the whole file in memory. The Drive pickup's 4K originals are
 * 400–450 MB (11 Nov 2026: B3B12.mp4 406 MB and SWEELY 1.mp4 449 MB ran
 * the function out of memory when they were read into a Buffer). The
 * fingerprint is the asset registry's (sha256 of the bytes, and their
 * count), so a file written here dedupes against one fingerprinted with
 * fingerprintBytes.
 */

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

import type { ContentIdentity } from "./asset-registry.ts";

export type ByteSource = AsyncIterable<Uint8Array> | ReadableStream<Uint8Array> | WebReadableStream<Uint8Array>;

function toNodeReadable(source: ByteSource): Readable {
  if (typeof (source as ReadableStream<Uint8Array>).getReader === "function") {
    return Readable.fromWeb(source as WebReadableStream<Uint8Array>);
  }
  return Readable.from(source as AsyncIterable<Uint8Array>, { objectMode: false });
}

/** Streams `source` into `filePath` (created or replaced) and returns the sha256 and byte count of what was written. `onBytes` hears the running count. */
export async function writeStreamToFile(source: ByteSource, filePath: string, onBytes?: (written: number) => void): Promise<ContentIdentity> {
  const hash = createHash("sha256");
  let byteSize = 0;
  const tap = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      hash.update(chunk);
      byteSize += chunk.byteLength;
      onBytes?.(byteSize);
      done(null, chunk);
    },
  });
  await pipeline(toNodeReadable(source), tap, createWriteStream(filePath));
  return { contentHash: hash.digest("hex"), byteSize };
}

/** The registry fingerprint of a file on disk, read in chunks. */
export async function fingerprintFile(filePath: string): Promise<ContentIdentity> {
  const hash = createHash("sha256");
  let byteSize = 0;
  for await (const chunk of createReadStream(filePath)) {
    const bytes = chunk as Buffer;
    hash.update(bytes);
    byteSize += bytes.byteLength;
  }
  return { contentHash: hash.digest("hex"), byteSize };
}
