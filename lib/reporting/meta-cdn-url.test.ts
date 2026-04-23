import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { upscaleMetaCdnUrl } from "./meta-cdn-url.ts";

const META_BASE =
  "https://scontent-ams2-1.xx.fbcdn.net/v/t39.30808-6/000000_0000000_n.png";

describe("upscaleMetaCdnUrl", () => {
  it("upgrades stp=dst-jpg_s160x160_tt6 to _s640x640_", () => {
    const u = `${META_BASE}?stp=dst-jpg_s160x160_tt6&_nc_cat=1`;
    const out = upscaleMetaCdnUrl(u, 640);
    assert.equal(
      out,
      `${META_BASE}?stp=${encodeURIComponent("dst-jpg_s640x640_tt6")}&_nc_cat=1`,
    );
  });

  it("p→s: p64x64 inside complex stp becomes s640x640, preserves siblings", () => {
    const url = new URL(META_BASE);
    url.searchParams.set(
      "stp",
      "c0.5000x0.5000f_dst-emg0_p64x64_q75_tt6",
    );
    const out = upscaleMetaCdnUrl(url.toString(), 640);
    const parsed = new URL(out);
    assert.equal(
      parsed.searchParams.get("stp"),
      "c0.5000x0.5000f_dst-emg0_s640x640_q75_tt6",
    );
  });

  it("leaves URL without stp= unchanged (Meta host)", () => {
    const u = `${META_BASE}?_nc_cat=1`;
    assert.equal(upscaleMetaCdnUrl(u, 640), u);
  });

  it("leaves non-Meta URL unchanged", () => {
    const u = "https://example.com/foo.jpg?stp=dst-jpg_s160x160_tt6";
    assert.equal(upscaleMetaCdnUrl(u, 640), u);
  });

  it("leaves non-square p110x80 unchanged", () => {
    const u = new URL(META_BASE);
    u.searchParams.set("stp", "c0.5000f_dst_p110x80_q75_tt6");
    assert.equal(
      upscaleMetaCdnUrl(u.toString(), 640),
      u.toString(),
    );
  });

  it("is idempotent for already _s640x640_", () => {
    const u = new URL(META_BASE);
    u.searchParams.set("stp", "dst-jpg_s640x640_tt6");
    const s = u.toString();
    assert.equal(upscaleMetaCdnUrl(s, 640), s);
  });

  it("uses custom targetSize 1080", () => {
    const u = new URL(META_BASE);
    u.searchParams.set("stp", "dst-jpg_s160x160_tt6");
    const out = upscaleMetaCdnUrl(u.toString(), 1080);
    const parsed = new URL(out);
    assert.equal(parsed.searchParams.get("stp"), "dst-jpg_s1080x1080_tt6");
  });

  it("does not downscale s1080x1080 to 640", () => {
    const u = new URL(META_BASE);
    u.searchParams.set("stp", "dst-jpg_s1080x1080_tt6");
    const s = u.toString();
    assert.equal(upscaleMetaCdnUrl(s, 640), s);
  });
});
