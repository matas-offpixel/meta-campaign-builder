/**
 * Incremental SHA-256 for a File the browser already holds.
 *
 * `crypto.subtle.digest` needs the whole buffer at once. A 150 MB video
 * would be a second full copy next to the File. This updates one 64-byte
 * block at a time from `blob.stream()`, which is what the Storage upload
 * already reads. The route never sees the bytes — only the hex digest,
 * and only for dedupe.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

export interface Sha256Hasher {
  update(chunk: Uint8Array): void;
  digestHex(): string;
}

export function createSha256(): Sha256Hasher {
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  const block = new Uint8Array(64);
  let blockLen = 0;
  let bytes = 0;

  function compress(view: Uint8Array): void {
    for (let i = 0; i < 16; i++) {
      const o = i * 4;
      w[i] = ((view[o]! << 24) | (view[o + 1]! << 16) | (view[o + 2]! << 8) | view[o + 3]!) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let a = h[0]!;
    let b = h[1]!;
    let c = h[2]!;
    let d = h[3]!;
    let e = h[4]!;
    let f = h[5]!;
    let g = h[6]!;
    let hh = h[7]!;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + S1 + ch + K[i]! + w[i]!) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h[0] = (h[0]! + a) >>> 0;
    h[1] = (h[1]! + b) >>> 0;
    h[2] = (h[2]! + c) >>> 0;
    h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0;
    h[5] = (h[5]! + f) >>> 0;
    h[6] = (h[6]! + g) >>> 0;
    h[7] = (h[7]! + hh) >>> 0;
  }

  return {
    update(chunk: Uint8Array): void {
      let offset = 0;
      bytes += chunk.byteLength;
      if (blockLen > 0) {
        const need = 64 - blockLen;
        const take = Math.min(need, chunk.byteLength);
        block.set(chunk.subarray(0, take), blockLen);
        blockLen += take;
        offset = take;
        if (blockLen === 64) {
          compress(block);
          blockLen = 0;
        }
      }
      while (offset + 64 <= chunk.byteLength) {
        compress(chunk.subarray(offset, offset + 64));
        offset += 64;
      }
      if (offset < chunk.byteLength) {
        block.set(chunk.subarray(offset), 0);
        blockLen = chunk.byteLength - offset;
      }
    },
    digestHex(): string {
      const bitLen = bytes * 8;
      const tail = new Uint8Array(blockLen + 72);
      tail.set(block.subarray(0, blockLen), 0);
      tail[blockLen] = 0x80;
      const padTo = (blockLen + 1 + 8) % 64 === 0 ? blockLen + 1 + 8 : blockLen + 1 + 8 + (64 - ((blockLen + 1 + 8) % 64));
      const high = Math.floor(bitLen / 0x100000000);
      const low = bitLen >>> 0;
      const lenAt = padTo - 8;
      tail[lenAt] = (high >>> 24) & 0xff;
      tail[lenAt + 1] = (high >>> 16) & 0xff;
      tail[lenAt + 2] = (high >>> 8) & 0xff;
      tail[lenAt + 3] = high & 0xff;
      tail[lenAt + 4] = (low >>> 24) & 0xff;
      tail[lenAt + 5] = (low >>> 16) & 0xff;
      tail[lenAt + 6] = (low >>> 8) & 0xff;
      tail[lenAt + 7] = low & 0xff;
      const padded = tail.subarray(0, padTo);
      for (let i = 0; i < padded.byteLength; i += 64) compress(padded.subarray(i, i + 64));
      let hex = "";
      for (let i = 0; i < 8; i++) hex += h[i]!.toString(16).padStart(8, "0");
      return hex;
    },
  };
}

export async function sha256HexOfBlob(blob: Blob): Promise<{ contentHash: string; byteSize: number }> {
  const hasher = createSha256();
  const reader = blob.stream().getReader();
  let byteSize = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    hasher.update(value);
    byteSize += value.byteLength;
  }
  return { contentHash: hasher.digestHex(), byteSize };
}
