import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseYouTubeId,
  youtubeEmbedUrl,
  youtubeThumbnailUrl,
} from "../youtube.ts";

/**
 * YouTube URL parsing (PR 6) — the logic seam behind the bottom-media
 * lite-embed. The parsed id feeds both the thumbnail URL and the iframe
 * src, so the strict charset check below doubles as injection defence.
 */

describe("parseYouTubeId — the three operator-pasted shapes", () => {
  const ID = "dQw4w9WgXcQ";

  it("youtube.com/watch?v=", () => {
    assert.equal(parseYouTubeId(`https://www.youtube.com/watch?v=${ID}`), ID);
    assert.equal(
      parseYouTubeId(`https://youtube.com/watch?v=${ID}&t=42s`),
      ID,
    );
  });

  it("youtu.be/", () => {
    assert.equal(parseYouTubeId(`https://youtu.be/${ID}`), ID);
    assert.equal(parseYouTubeId(`https://youtu.be/${ID}?si=share-junk`), ID);
  });

  it("youtube.com/embed/ (and shorts, mobile host)", () => {
    assert.equal(parseYouTubeId(`https://www.youtube.com/embed/${ID}`), ID);
    assert.equal(parseYouTubeId(`https://www.youtube.com/shorts/${ID}`), ID);
    assert.equal(parseYouTubeId(`https://m.youtube.com/watch?v=${ID}`), ID);
  });

  it("junk in → null out (embed hidden, never a broken iframe)", () => {
    for (const junk of [
      null,
      undefined,
      "",
      "not a url",
      "https://vimeo.com/12345",
      "https://evil.example/watch?v=dQw4w9WgXcQ",
      "javascript:alert(1)",
      'https://www.youtube.com/watch?v=<script>"',
      "https://www.youtube.com/watch",
    ]) {
      assert.equal(parseYouTubeId(junk), null, `expected null for ${junk}`);
    }
  });
});

describe("thumbnail + embed URL builders", () => {
  it("thumbnail hits img.youtube.com maxresdefault; embed autoplays post-gesture", () => {
    assert.equal(
      youtubeThumbnailUrl("abc123XYZ_-"),
      "https://img.youtube.com/vi/abc123XYZ_-/maxresdefault.jpg",
    );
    assert.equal(
      youtubeEmbedUrl("abc123XYZ_-"),
      "https://www.youtube.com/embed/abc123XYZ_-?autoplay=1",
    );
  });
});
