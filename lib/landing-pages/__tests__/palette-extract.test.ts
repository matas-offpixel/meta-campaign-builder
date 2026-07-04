import assert from "node:assert/strict";
import { describe, it } from "node:test";

import sharp from "sharp";

import {
  extractPaletteFromPixels,
  isPaletteHex,
  parseStoredPalette,
} from "../palette.ts";
import {
  extractArtworkPalette,
  maybeExtractAndPersistPalette,
  type PaletteDb,
} from "../palette-extract.ts";

/**
 * Palette pipeline (PR 6): the pure bin-ranking extractor on synthetic
 * RGBA buffers, plus the fetch/decode wrapper's contract — real JPEG in
 * (generated with sharp at test time), 3 hex out; invalid URL → [];
 * deadline enforced; persist hook fire-and-forget semantics.
 */

/** Solid-color RGBA buffer. */
function solid(r: number, g: number, b: number, pixels: number): Uint8Array {
  const buf = new Uint8Array(pixels * 4);
  for (let i = 0; i < pixels; i++) {
    buf[i * 4] = r;
    buf[i * 4 + 1] = g;
    buf[i * 4 + 2] = b;
    buf[i * 4 + 3] = 255;
  }
  return buf;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

describe("extractPaletteFromPixels (pure)", () => {
  it("ranks three distinct colors by dominance: primary, secondary, tertiary", () => {
    const pixels = concat(
      solid(0xe2, 0x77, 0x37, 500), // orange — most pixels
      solid(0xf5, 0xb6, 0x5c, 300), // sand
      solid(0x4b, 0x27, 0x16, 200), // brown
    );
    const palette = extractPaletteFromPixels(pixels);
    assert.equal(palette.length, 3);
    assert.equal(palette[0], "#E27737");
    assert.equal(palette[1], "#F5B65C");
    assert.equal(palette[2], "#4B2716");
  });

  it("flat single-color artwork still returns entries (padded, not < 3 when bins allow)", () => {
    const palette = extractPaletteFromPixels(solid(16, 32, 48, 100));
    assert.ok(palette.length >= 1);
    assert.equal(palette[0], "#102030");
    for (const hex of palette) assert.ok(isPaletteHex(hex));
  });

  it("ignores transparent pixels; empty/garbage input → []", () => {
    const transparent = solid(255, 0, 0, 10);
    for (let i = 0; i < 10; i++) transparent[i * 4 + 3] = 0;
    assert.deepEqual(extractPaletteFromPixels(transparent), []);
    assert.deepEqual(extractPaletteFromPixels(new Uint8Array(0)), []);
  });
});

describe("parseStoredPalette / isPaletteHex", () => {
  it("filters jsonb junk down to valid #RRGGBB entries", () => {
    assert.deepEqual(
      parseStoredPalette(["#e27737", "nope", 42, "#F5B65C", "url(evil)"]),
      ["#E27737", "#F5B65C"],
    );
    assert.deepEqual(parseStoredPalette("not-an-array"), []);
    assert.deepEqual(parseStoredPalette(null), []);
  });
});

describe("extractArtworkPalette (fetch + sharp)", () => {
  it("real JPEG fixture → 3 hex codes, dominant color first", async () => {
    // 60x60 canvas: left 2/3 orange, right 1/3 near-black — composited
    // and JPEG-encoded with sharp, so the decode path is the real one.
    const jpeg = await sharp({
      create: {
        width: 60,
        height: 60,
        channels: 3,
        background: { r: 226, g: 119, b: 55 },
      },
    })
      .composite([
        {
          input: {
            create: {
              width: 20,
              height: 60,
              channels: 3,
              background: { r: 20, g: 20, b: 20 },
            },
          },
          left: 40,
          top: 0,
        },
      ])
      .jpeg({ quality: 95 })
      .toBuffer();

    const fetchImpl = (async () =>
      new Response(new Uint8Array(jpeg), { status: 200 })) as typeof fetch;

    const palette = await extractArtworkPalette("https://cdn.example/art.jpg", {
      fetchImpl,
    });
    assert.equal(palette.length, 3);
    for (const hex of palette) assert.ok(isPaletteHex(hex), `bad hex ${hex}`);
    // Dominant = the orange region (JPEG-lossy, so assert channel bands
    // rather than exact bytes).
    const [r, g, b] = [1, 3, 5].map((i) =>
      parseInt(palette[0].slice(i, i + 2), 16),
    );
    assert.ok(r > 180 && g > 80 && g < 170 && b < 110, `unexpected dominant ${palette[0]}`);
  });

  it("invalid / non-http URL → [] (fail-silent)", async () => {
    assert.deepEqual(await extractArtworkPalette("not a url"), []);
    assert.deepEqual(await extractArtworkPalette("ftp://example.com/x.jpg"), []);
  });

  it("HTTP failure → [] without throwing", async () => {
    const fetch404 = (async () =>
      new Response("nope", { status: 404 })) as typeof fetch;
    assert.deepEqual(
      await extractArtworkPalette("https://cdn.example/missing.jpg", {
        fetchImpl: fetch404,
      }),
      [],
    );
  });

  it("hard deadline: a hung fetch is aborted and yields []", async () => {
    const hangingFetch = ((_url: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      })) as typeof fetch;

    const started = Date.now();
    const palette = await extractArtworkPalette("https://cdn.example/slow.jpg", {
      fetchImpl: hangingFetch,
      timeoutMs: 150, // scaled-down 3s deadline — same mechanism
    });
    assert.deepEqual(palette, []);
    assert.ok(
      Date.now() - started < 3_000,
      "deadline must cut a hung fetch short",
    );
  });
});

describe("maybeExtractAndPersistPalette", () => {
  function makeDb(updates: Array<Record<string, unknown>>): PaletteDb {
    return {
      from(table: string) {
        return {
          update(values: Record<string, unknown>) {
            return {
              eq(column: string, value: unknown) {
                updates.push({ table, values, [column]: value });
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      },
    };
  }

  it("persists the extracted palette to the page_events row", async () => {
    const png = await sharp({
      create: {
        width: 10,
        height: 10,
        channels: 3,
        background: { r: 229, g: 50, b: 45 },
      },
    })
      .png()
      .toBuffer();
    const fetchImpl = (async () =>
      new Response(new Uint8Array(png), { status: 200 })) as typeof fetch;

    const updates: Array<Record<string, unknown>> = [];
    await maybeExtractAndPersistPalette(
      makeDb(updates),
      "pe-1",
      "https://cdn.example/art.png",
      { fetchImpl },
    );
    assert.equal(updates.length, 1);
    assert.equal(updates[0].table, "page_events");
    assert.equal(updates[0].id, "pe-1");
    const palette = (updates[0].values as { artwork_palette: string[] })
      .artwork_palette;
    assert.equal(palette[0], "#E5322D");
  });

  it("extraction failure → NO write, no throw", async () => {
    const fetchBoom = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    const updates: Array<Record<string, unknown>> = [];
    await maybeExtractAndPersistPalette(
      makeDb(updates),
      "pe-2",
      "https://cdn.example/art.png",
      { fetchImpl: fetchBoom },
    );
    assert.equal(updates.length, 0);
  });
});
