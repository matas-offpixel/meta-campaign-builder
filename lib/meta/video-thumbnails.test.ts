import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  pickBestVideoThumbnail,
  type VideoThumbnail,
} from "./video-thumbnails.ts";

const t = (
  uri: string,
  w: number,
  h: number,
  opts: Partial<Omit<VideoThumbnail, "uri" | "width" | "height">> = {},
): VideoThumbnail => ({
  uri,
  width: w,
  height: h,
  scale: opts.scale ?? 1,
  is_preferred: opts.is_preferred ?? false,
});

describe("pickBestVideoThumbnail", () => {
  it("returns null for an empty array", () => {
    assert.equal(pickBestVideoThumbnail([]), null);
  });

  it("returns the only thumbnail in a one-element list", () => {
    const a = t("a", 100, 200);
    assert.deepEqual(pickBestVideoThumbnail([a]), a);
  });

  it("picks the is_preferred row even when another has larger area", () => {
    const big = t("b", 1000, 1000, { is_preferred: false });
    const ed = t("c", 10, 10, { is_preferred: true });
    const result = pickBestVideoThumbnail([big, ed]);
    assert.deepEqual(result, ed);
  });

  it("picks the largest area when no row is_preferred", () => {
    const small = t("a", 10, 10);
    const large = t("b", 50, 50);
    const mid = t("c", 20, 20);
    const result = pickBestVideoThumbnail([small, mid, large]);
    assert.deepEqual(result, large);
  });

  it("on area ties, keeps the first in insertion order", () => {
    const first = t("a", 20, 20);
    const second = t("b", 20, 20);
    const result = pickBestVideoThumbnail([first, second]);
    assert.deepEqual(result, first);
  });

  it("skips malformed rows and uses the next valid", () => {
    const result = pickBestVideoThumbnail(
      // Missing width/height — skipped by the picker
      [Object.freeze({ uri: "https://x" }), t("ok", 10, 10)] as readonly unknown[],
    );
    assert.deepEqual(result, t("ok", 10, 10));
  });
});
