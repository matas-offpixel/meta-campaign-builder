import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildAssetPath,
  buildEventUpdate,
  buildPageEventUpdate,
  isoToLondonWallTime,
  londonWallTimeToIso,
  moveImage,
  parseImageList,
  parsePageEventForm,
  slugifyEventName,
} from "../page-event-schema.ts";

/**
 * OP909 Phase 3 — landing-page CRUD validation + payload builders.
 * The content-merge test pins that keys this form does NOT own
 * (template_key, Phase-4 confirmation_*, operator extras) survive
 * verbatim; the asset-path test pins the client-scope prefix.
 */

describe("slugifyEventName", () => {
  it("kebab-cases with accents + symbols stripped", () => {
    assert.equal(
      slugifyEventName("Jackies — Open Air Müsic! (Mallorca)"),
      "jackies-open-air-music-mallorca",
    );
  });
  it("caps at 64 chars", () => {
    assert.ok(slugifyEventName("x".repeat(100)).length <= 64);
  });
});

describe("londonWallTimeToIso", () => {
  it("summer (BST, UTC+1): 18:00 London = 17:00 UTC", () => {
    assert.equal(londonWallTimeToIso("2026-07-08T18:00"), "2026-07-08T17:00:00.000Z");
  });
  it("winter (GMT, UTC+0): 18:00 London = 18:00 UTC", () => {
    assert.equal(londonWallTimeToIso("2026-01-15T18:00"), "2026-01-15T18:00:00.000Z");
  });
  it("garbage → null", () => {
    assert.equal(londonWallTimeToIso("not-a-date"), null);
    assert.equal(londonWallTimeToIso(""), null);
    assert.equal(londonWallTimeToIso(null), null);
  });
});

describe("isoToLondonWallTime", () => {
  it("round-trips summer + winter values", () => {
    assert.equal(isoToLondonWallTime("2026-07-08T17:00:00.000Z"), "2026-07-08T18:00");
    assert.equal(isoToLondonWallTime("2026-01-15T18:00:00.000Z"), "2026-01-15T18:00");
  });
  it("null/invalid → empty string (form prefill)", () => {
    assert.equal(isoToLondonWallTime(null), "");
    assert.equal(isoToLondonWallTime("garbage"), "");
  });
});

const VALID_FORM = {
  name: "Jackies Mallorca",
  slug: "jackies-mallorca",
  presale_at: "2026-07-08T18:00",
  general_sale_at: "",
  event_start_at: "2026-08-01T22:00",
  title: "JACKIES",
  subtitle: "Open air house music",
  description: "Line 1\nLine 2",
  venue: "Ushuaïa, Platja d'en Bossa, Ibiza",
  venue_short: "",
  youtube_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  brand_instagram_url: "https://instagram.com/jackies",
  brand_tiktok_url: "",
  countdown_enabled: "on",
  countdown_target_at: "2026-07-08T18:00",
  countdown_label: "presale opens in",
  status: "draft",
};

describe("parsePageEventForm", () => {
  it("happy path — venue_short defaults to first comma segment", () => {
    const result = parsePageEventForm(VALID_FORM);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.venue_short, "Ushuaïa");
    assert.equal(result.value.presale_at, "2026-07-08T17:00:00.000Z");
    assert.equal(result.value.general_sale_at, null);
    assert.equal(result.value.countdown_target_at, "2026-07-08T17:00:00.000Z");
    assert.equal(result.value.status, "draft");
  });

  it("missing name fails; slug auto-generates from name when blank", () => {
    const noName = parsePageEventForm({ ...VALID_FORM, name: "" });
    assert.equal(noName.ok, false);

    const autoSlug = parsePageEventForm({ ...VALID_FORM, slug: "" });
    assert.equal(autoSlug.ok, true);
    if (autoSlug.ok) assert.equal(autoSlug.value.slug, "jackies-mallorca");
  });

  it("rejects bad slugs", () => {
    for (const bad of ["UPPER", "spaces here", "trailing-", "-leading", "sneaky/../path"]) {
      const result = parsePageEventForm({ ...VALID_FORM, slug: bad });
      assert.equal(result.ok, false, `expected reject: ${bad}`);
    }
  });

  it("rejects a non-YouTube video URL", () => {
    const result = parsePageEventForm({
      ...VALID_FORM,
      youtube_url: "https://vimeo.com/12345",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.errors.youtube_url);
  });

  it("countdown enabled without a target fails; disabled nulls the target", () => {
    const missing = parsePageEventForm({
      ...VALID_FORM,
      countdown_target_at: "",
    });
    assert.equal(missing.ok, false);

    const disabled = parsePageEventForm({
      ...VALID_FORM,
      countdown_enabled: null,
      countdown_target_at: "2026-07-08T18:00",
    });
    assert.equal(disabled.ok, true);
    if (disabled.ok) assert.equal(disabled.value.countdown_target_at, null);
  });

  it("rejects an unknown status", () => {
    const result = parsePageEventForm({ ...VALID_FORM, status: "published" });
    assert.equal(result.ok, false);
  });
});

describe("buildEventUpdate / buildPageEventUpdate", () => {
  it("pins the events payload shape", () => {
    const parsed = parsePageEventForm(VALID_FORM);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(buildEventUpdate(parsed.value), {
      name: "Jackies Mallorca",
      slug: "jackies-mallorca",
      presale_at: "2026-07-08T17:00:00.000Z",
      general_sale_at: null,
      event_start_at: "2026-08-01T21:00:00.000Z",
    });
  });

  it("content merge preserves keys this form does not own", () => {
    const parsed = parsePageEventForm(VALID_FORM);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const current = {
      template_key: "mvp_v1",
      artwork_url: "https://cdn.example.com/art.jpg",
      confirmation_body: "custom copy from phase 4",
      subtitle: "OLD SUBTITLE",
    };
    const update = buildPageEventUpdate(current, parsed.value);
    const content = update.content as Record<string, unknown>;
    assert.equal(content.template_key, "mvp_v1");
    assert.equal(content.artwork_url, "https://cdn.example.com/art.jpg");
    assert.equal(content.confirmation_body, "custom copy from phase 4");
    assert.equal(content.subtitle, "Open air house music");
    assert.equal(content.brand_instagram_url, "https://instagram.com/jackies");
    // Cleared fields delete their key.
    assert.equal("brand_tiktok_url" in content, false);
  });

  it("disabled countdown writes null target", () => {
    const parsed = parsePageEventForm({
      ...VALID_FORM,
      countdown_enabled: null,
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const update = buildPageEventUpdate({}, parsed.value);
    assert.equal(update.countdown_target_at, null);
  });
});

describe("buildAssetPath", () => {
  const NOW = new Date("2026-07-05T02:00:00Z");

  it("pins the client-scoped prefix — the storage isolation mechanism", () => {
    const result = buildAssetPath("client-1", "page-9", "artwork", "image/png", NOW);
    assert.deepEqual(result, {
      ok: true,
      path: `client-1/page-9/artwork-${NOW.getTime()}.png`,
      ext: "png",
    });
  });

  it("rejects non-image MIME types (svg, gif, pdf)", () => {
    for (const mime of ["image/svg+xml", "image/gif", "application/pdf", ""]) {
      const result = buildAssetPath("c", "p", "hero", mime, NOW);
      assert.equal(result.ok, false, `expected reject: ${mime}`);
    }
  });
});

describe("image list helpers", () => {
  it("parseImageList tolerates garbage jsonb", () => {
    assert.deepEqual(parseImageList(["a", 2, null, "b", ""]), ["a", "b"]);
    assert.deepEqual(parseImageList("not-an-array"), []);
    assert.deepEqual(parseImageList(null), []);
  });

  it("moveImage swaps neighbours and no-ops at the edges", () => {
    assert.deepEqual(moveImage(["a", "b", "c"], "b", "up"), ["b", "a", "c"]);
    assert.deepEqual(moveImage(["a", "b", "c"], "b", "down"), ["a", "c", "b"]);
    assert.deepEqual(moveImage(["a", "b", "c"], "a", "up"), ["a", "b", "c"]);
    assert.deepEqual(moveImage(["a", "b", "c"], "c", "down"), ["a", "b", "c"]);
    assert.deepEqual(moveImage(["a"], "zz", "down"), ["a"]);
  });
});
