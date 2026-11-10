import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ServiceRoleDb } from "../load.ts";
import {
  candidateThumb,
  classifyAspect,
  fillMissingPromoterThumbs,
  findArtistClips,
  findPromoterClips,
  IG_MEDIA_FIELDS,
  igScore,
  imageHeaderSize,
  parseIgPost,
  plainIgMessage,
  rankIgPosts,
  requestArtistClip,
  type IgPost,
  type IgRead,
} from "../ig-discovery.ts";
import { fakeDb, type FakeDb } from "./fake-db.ts";

const NOW = new Date("2026-11-06T00:00:00.000Z");

function daysBefore(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

function post(over: Partial<IgPost> & { id: string }): IgPost {
  return {
    mediaType: "VIDEO",
    mediaProductType: "REELS",
    permalink: `https://www.instagram.com/reel/${over.id}/`,
    caption: null,
    postedAt: daysBefore(1),
    likes: 10,
    comments: 0,
    thumbnailUrl: null,
    thumbWidth: null,
    thumbHeight: null,
    children: [],
    ...over,
  };
}

function seed(over: Record<string, Record<string, unknown>[]> = {}): FakeDb {
  return fakeDb({
    creative_lab_artists: [{
      id: "artist-1",
      user_id: "op",
      client_id: "client-1",
      name: "Enzo Siragusa",
      approved_at: "2026-11-01T00:00:00Z",
      instagram_actor_id: "17841401538493170",
      ig_username: null,
    }],
    clients: [{ id: "client-1", instagram_business_id: "17841456620568454" }],
    creative_lab_clips: [],
    creative_lab_ig_candidates: [],
    ...over,
  });
}

function read(posts: IgPost[], opts: { mediaOk?: boolean; copyright?: Record<string, boolean | null> } = {}): IgRead & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async profile() {
      calls.push("profile");
      return { ok: true, username: "enzosiragusa", followers: 100 };
    },
    async media() {
      calls.push("media");
      return opts.mediaOk === false ? { ok: false, message: "own edge refused" } : { ok: true, posts };
    },
    async discovery() {
      calls.push("discovery");
      return { ok: true, followers: 100, posts };
    },
    async copyright(mediaId: string) {
      calls.push(`copyright:${mediaId}`);
      return opts.copyright?.[mediaId] ?? false;
    },
  };
}

describe("rankIgPosts", () => {
  it("scores with comment weight and 90-day half life, and drops posts older than a year", () => {
    assert.equal(igScore({ likes: 10, comments: 0, followers: 100, ageDays: 0 }), 0.1);
    assert.equal(igScore({ likes: 10, comments: 0, followers: 100, ageDays: 90 }), 0.05);
    assert.equal(igScore({ likes: 0, comments: 2, followers: 100, ageDays: 0 }), 0.06);
    const ranked = rankIgPosts(
      [
        post({ id: "today", likes: 10, postedAt: daysBefore(0) }),
        post({ id: "quarter", likes: 10, postedAt: daysBefore(90) }),
        post({ id: "old", likes: 1000, postedAt: daysBefore(366) }),
        post({ id: "edge", likes: 1, postedAt: daysBefore(365) }),
      ],
      { now: NOW, followers: 100, exclude: new Set() },
    );
    assert.deepEqual(ranked.map((row) => row.igMediaId), ["today", "quarter", "edge"]);
    assert.equal(ranked[0]?.score, 0.1);
    assert.equal(ranked[1]?.score, 0.05);
  });

  it("counts a carousel once, on its first video slide", () => {
    const album = post({
      id: "album",
      mediaType: "CAROUSEL_ALBUM",
      mediaProductType: "FEED",
      permalink: "https://www.instagram.com/p/album/",
      likes: 20,
      comments: 1,
          thumbWidth: 1080,
          thumbHeight: 1920,
          children: [
            { id: "slide-v", mediaType: "VIDEO", thumbnailUrl: null },
            { id: "slide-i", mediaType: "IMAGE", thumbnailUrl: null },
            { id: "slide-v2", mediaType: "VIDEO", thumbnailUrl: null },
          ],
        });
    const ranked = rankIgPosts([album], { now: NOW, followers: 100, exclude: new Set() });
    assert.deepEqual(ranked.map((row) => row.igMediaId), ["slide-v"]);
    assert.deepEqual(ranked[0]?.slideIds, ["slide-v2"]);
    assert.equal(ranked[0]?.permalink, "https://www.instagram.com/p/album/");
    assert.equal(ranked[0]?.score, igScore({ likes: 20, comments: 1, followers: 100, ageDays: 1 }));
    const held = rankIgPosts([album], { now: NOW, followers: 100, exclude: new Set(["slide-v2"]) });
    assert.equal(held.length, 0);
  });

  it("a 5-video carousel plus 7 reels is 8 distinct posts", () => {
    const carousel = post({
      id: "album",
      mediaType: "CAROUSEL_ALBUM",
      mediaProductType: "FEED",
      permalink: "https://www.instagram.com/p/album/",
      likes: 50,
      children: Array.from({ length: 5 }, (_, index) => ({ id: `slide-${index}`, mediaType: "VIDEO", thumbnailUrl: null })),
    });
    const reels = Array.from({ length: 7 }, (_, index) => post({ id: `reel-${index}`, likes: 10 + index }));
    const ranked = rankIgPosts([carousel, ...reels], { now: NOW, followers: 100, exclude: new Set() });
    assert.equal(ranked.length, 8);
    assert.equal(new Set(ranked.map((row) => row.igMediaId)).size, 8);
    assert.equal(new Set(ranked.map((row) => row.permalink)).size, 8);
    const album = ranked.find((row) => row.igMediaId === "slide-0");
    assert.deepEqual(album?.slideIds, ["slide-1", "slide-2", "slide-3", "slide-4"]);
    assert.equal(ranked.some((row) => row.igMediaId.startsWith("slide-") && row.igMediaId !== "slide-0"), false);
  });

  it("a 9:16 reel outranks an equal-engagement 16:9 slide, and the multiplier follows the decay", () => {
    const ranked = rankIgPosts(
      [
        post({ id: "wide", mediaType: "CAROUSEL_ALBUM", mediaProductType: "FEED", likes: 100, comments: 10, thumbWidth: 1920, thumbHeight: 1080, children: [{ id: "wide-slide", mediaType: "VIDEO", thumbnailUrl: null }] }),
        post({ id: "reel", likes: 100, comments: 10, thumbWidth: 1080, thumbHeight: 1920 }),
      ],
      { now: NOW, followers: 100, exclude: new Set() },
    );
    assert.deepEqual(ranked.map((row) => row.igMediaId), ["reel", "wide-slide"]);
    assert.equal(ranked[0]?.aspect, "9:16");
    assert.equal(ranked[1]?.aspect, "landscape");
    const decayed = igScore({ likes: 100, comments: 10, followers: 100, ageDays: 1 });
    assert.equal(ranked[0]?.score, decayed * 1);
    assert.equal(ranked[1]?.score, decayed * 0.3);

    const aged = rankIgPosts(
      [post({ id: "old", likes: 10, postedAt: daysBefore(90), thumbWidth: 1080, thumbHeight: 1350, mediaProductType: "FEED" })],
      { now: NOW, followers: 100, exclude: new Set() },
    );
    assert.equal(aged[0]?.aspect, "4:5");
    assert.equal(aged[0]?.score, igScore({ likes: 10, comments: 0, followers: 100, ageDays: 90 }) * 0.7);
    assert.equal(classifyAspect(1080, 1080, "FEED").multiplier, 0.55);
    assert.equal(classifyAspect(null, null, "REELS").aspect, "9:16");
    assert.equal(classifyAspect(null, null, "FEED").aspect, "unknown");
  });

  it("reads a JPEG or PNG header and nothing else", () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    png[16] = 0;
    png[17] = 0;
    png[18] = 4;
    png[19] = 56;
    png[20] = 0;
    png[21] = 0;
    png[22] = 7;
    png[23] = 128;
    assert.deepEqual(imageHeaderSize(png), { width: 1080, height: 1920 });
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x04, 0x38, 0x07, 0x80, 0x01, 0x01, 0x11, 0x00]);
    assert.deepEqual(imageHeaderSize(jpeg), { width: 1920, height: 1080 });
    assert.equal(imageHeaderSize(new Uint8Array([0x00, 0x01, 0x02])), null);
  });
});

describe("findArtistClips", () => {
  it("uses the own edge when it can be read, and does not store a media url", async () => {
    const posts = [post({ id: "reel-a", likes: 30 }), post({ id: "reel-b", likes: null, comments: 4 })];
    const graph = read(posts, { copyright: { "reel-a": true, "reel-b": false } });
    const fake = seed();
    const result = await findArtistClips(fake as unknown as ServiceRoleDb, { artistId: "artist-1", now: NOW, read: graph });
    assert.equal(result.source, "own_edge");
    assert.equal(result.error, null);
    assert.deepEqual(graph.calls.filter((call) => call === "discovery"), []);
    assert.deepEqual(result.candidates.map((row) => [row.igMediaId, row.hasFile, row.fileSource, row.audioMatch]), [
      ["reel-a", true, "own_edge", true],
      ["reel-b", true, "own_edge", false],
    ]);
    assert.equal(fake.tables.creative_lab_artists[0].ig_username, "enzosiragusa");
    assert.equal(fake.tables.creative_lab_artists[0].ig_last_error, null);
    const stored = fake.tables.creative_lab_ig_candidates;
    assert.equal(stored.length, 2);
    assert.equal(stored.some((row) => "media_url" in row), false);
    assert.equal(IG_MEDIA_FIELDS.includes("media_url"), false);
    assert.equal(IG_MEDIA_FIELDS.includes("thumbnail_url"), true);
    assert.equal(IG_MEDIA_FIELDS.includes("caption"), true);
  });

  it("measures the first video slide and does not store the thumbnail url", async () => {
    const posts = [post({
      id: "album",
      mediaType: "CAROUSEL_ALBUM",
      mediaProductType: "FEED",
      thumbnailUrl: "https://cdn.example/cover.jpg",
      children: [
        { id: "img", mediaType: "IMAGE", thumbnailUrl: "https://cdn.example/image.jpg" },
        { id: "vid", mediaType: "VIDEO", thumbnailUrl: "https://cdn.example/video.jpg" },
      ],
    })];
    const graph = read(posts);
    const seen: string[] = [];
    graph.thumb = async (url) => {
      seen.push(url);
      return { width: 1080, height: 1350 };
    };
    const fake = seed();
    const result = await findArtistClips(fake as unknown as ServiceRoleDb, { artistId: "artist-1", now: NOW, read: graph });
    assert.deepEqual(seen, ["https://cdn.example/video.jpg"]);
    assert.equal(result.candidates[0]?.aspect, "4:5");
    assert.equal(result.candidates[0]?.thumbWidth, 1080);
    assert.equal(result.candidates[0]?.thumbHeight, 1350);
    const stored = JSON.stringify(fake.tables.creative_lab_ig_candidates);
    assert.equal(stored.includes("cdn.example"), false);
    assert.equal(stored.includes("thumbnail_url"), false);
  });

  it("falls back to Business Discovery with no file when the own edge cannot be read", async () => {
    const graph = read([post({ id: "reel-a" })]);
    graph.media = async () => {
      graph.calls.push("media");
      return { ok: false, message: "https://graph.facebook.com/secret?access_token=EAASECRET own edge refused" };
    };
    const fake = seed();
    const own = await findArtistClips(fake as unknown as ServiceRoleDb, { artistId: "artist-1", now: NOW, read: graph });
    assert.equal(own.source, "none");
    assert.equal(own.candidates[0]?.hasFile, false);
    assert.equal(own.candidates[0]?.fileSource, "none");
    assert.equal(own.candidates[0]?.audioMatch, null);
    assert.equal(graph.calls.includes("discovery"), true);
    assert.equal(graph.calls.some((call) => call.startsWith("copyright:")), false);
    assert.equal(String(fake.tables.creative_lab_artists[0].ig_last_error ?? "").includes("http"), false);
  });

  it("asks for a copyright check once per listed post and skips one that is already imported or requested", async () => {
    const posts = Array.from({ length: 10 }, (_, index) => post({ id: `v${index}`, likes: index }));
    const graph = read(posts);
    const fake = seed({
      creative_lab_clips: [{ id: "clip-1", artist_id: "artist-1", external_id: "v9", source_file_id: null }],
      creative_lab_ig_candidates: [{ id: "held", artist_id: "artist-1", ig_media_id: "v8", status: "requested", score: 1 }],
    });
    const result = await findArtistClips(fake as unknown as ServiceRoleDb, { artistId: "artist-1", now: NOW, read: graph });
    assert.deepEqual(result.candidates.map((row) => row.igMediaId), ["v7", "v6", "v5", "v4", "v3", "v2", "v1", "v0"]);
    assert.deepEqual(graph.calls.filter((call) => call.startsWith("copyright:")), [
      "copyright:v7", "copyright:v6", "copyright:v5", "copyright:v4", "copyright:v3", "copyright:v2", "copyright:v1", "copyright:v0",
    ]);
    assert.equal(fake.tables.creative_lab_ig_candidates.find((row) => row.ig_media_id === "v8")?.status, "requested");
  });

  it("stores the caption verbatim from either edge and fills a null caption without changing a held status", async () => {
    const caption = "See you on the 27th 🔥\n";
    const parsed = parseIgPost({ id: "reel-a", media_type: "VIDEO", caption: `  ${caption}`, permalink: "https://www.instagram.com/reel/reel-a/" });
    assert.equal(parsed.caption, `  ${caption}`);
    const own = read([post({ id: "reel-a", caption, likes: 30 }), post({ id: "held-post", caption: "held words", likes: 1 })]);
    const fake = seed({
      creative_lab_ig_candidates: [{
        id: "held",
        artist_id: "artist-1",
        ig_media_id: "held-post",
        permalink: "https://www.instagram.com/reel/held-post/",
        status: "requested",
        caption: null,
        score: 1,
      }],
    });
    await findArtistClips(fake as unknown as ServiceRoleDb, { artistId: "artist-1", now: NOW, read: own });
    const stored = fake.tables.creative_lab_ig_candidates.find((row) => row.ig_media_id === "reel-a");
    assert.equal(stored?.caption, caption);
    assert.equal(typeof stored?.caption_fetched_at, "string");
    const held = fake.tables.creative_lab_ig_candidates.find((row) => row.ig_media_id === "held-post");
    assert.equal(held?.status, "requested");
    assert.equal(held?.caption, "held words");
    const discovery = read([post({ id: "reel-b", caption })]);
    discovery.media = async () => ({ ok: false, message: "own edge refused" });
    const found = seed();
    const result = await findArtistClips(found as unknown as ServiceRoleDb, { artistId: "artist-1", now: NOW, read: discovery });
    assert.equal(result.source, "none");
    assert.equal(found.tables.creative_lab_ig_candidates[0]?.caption, caption);
  });

  it("finds clips for an artist who is not ticked as cleared", async () => {
    const graph = read([post({ id: "reel-a", thumbWidth: 1080, thumbHeight: 1920 })]);
    const fake = seed();
    fake.tables.creative_lab_artists[0].approved_at = null;
    const result = await findArtistClips(fake as unknown as ServiceRoleDb, { artistId: "artist-1", now: NOW, read: graph });
    assert.equal(graph.calls.includes("media") || graph.calls.includes("profile"), true);
    assert.equal(result.candidates.some((row) => row.igMediaId === "reel-a"), true);
  });

  it("strips tokens and urls from a stored error", () => {
    const message = plainIgMessage("failed https://graph.facebook.com/v21.0/x?access_token=EAASECRETVALUE extra");
    assert.equal(message.includes("http"), false);
    assert.equal(message.includes("EAA"), false);
    assert.equal(message.includes("access_token"), false);
  });
});

describe("candidate thumbnails", () => {
  it("stores the thumbnail bytes and never the thumbnail url", async () => {
    const fake = seed();
    const graph = read([post({ id: "reel-a", thumbnailUrl: "https://cdn.example/thumb.jpg", likes: 10 })]);
    const bytes = new Uint8Array([1, 2, 3]);
    graph.thumb = async () => ({ width: 720, height: 1280, bytes });
    const stored: string[] = [];
    await findArtistClips(fake as unknown as ServiceRoleDb, {
      artistId: "artist-1",
      now: NOW,
      read: graph,
      storeThumb: async (path) => {
        stored.push(path);
      },
    });
    assert.deepEqual(stored, ["creative-lab/ig/artist-1/reel-a.jpg"]);
    const row = fake.tables.creative_lab_ig_candidates[0]!;
    assert.equal(row.thumbnail_path, "creative-lab/ig/artist-1/reel-a.jpg");
    assert.equal(JSON.stringify(row).includes("cdn.example"), false);
    assert.equal("thumbnail_url" in row, false);
  });

  it("stores a carousel slide's own thumbnail and leaves the tile dark when that slide has none", async () => {
    const coverOnly = post({
      id: "album",
      mediaType: "CAROUSEL_ALBUM",
      mediaProductType: "FEED",
      thumbnailUrl: "https://cdn.example/album-cover.jpg",
      likes: 40,
      children: [
        { id: "slide-cover", mediaType: "IMAGE", thumbnailUrl: "https://cdn.example/slide-cover.jpg" },
        { id: "slide-video", mediaType: "VIDEO", thumbnailUrl: null },
      ],
    });
    assert.equal(candidateThumb(coverOnly), null);
    const own = post({
      ...coverOnly,
      children: [
        { id: "slide-cover", mediaType: "IMAGE", thumbnailUrl: "https://cdn.example/slide-cover.jpg" },
        { id: "slide-video", mediaType: "VIDEO", thumbnailUrl: "https://cdn.example/slide-video.jpg" },
      ],
    });
    assert.deepEqual(candidateThumb(own), { mediaId: "slide-video", url: "https://cdn.example/slide-video.jpg" });

    const fake = seed({
      creative_lab_ig_candidates: [{
        artist_id: "artist-1",
        ig_media_id: "slide-video",
        status: "candidate",
        thumbnail_path: null,
      }],
    });
    const graph = read([coverOnly]);
    const fetched: string[] = [];
    graph.thumb = async (url: string) => {
      fetched.push(url);
      return { width: 1080, height: 1350, bytes: new Uint8Array([9]) };
    };
    await findArtistClips(fake as unknown as ServiceRoleDb, { artistId: "artist-1", now: NOW, read: graph });
    assert.deepEqual(fetched, []);
    const row = fake.tables.creative_lab_ig_candidates.find((item) => item.ig_media_id === "slide-video");
    assert.equal(row?.thumbnail_path, null);
  });
});

describe("promoter candidate thumbnails", () => {
  const puzzle = {
    id: "client-puzzle",
    user_id: "op",
    instagram_business_id: "178414000",
    instagram_handle: "puzzleofficialuk",
  };

  it("stores a thumbnail path when the client's own clips are found", async () => {
    const fake = seed({
      clients: [puzzle],
      creative_lab_ig_candidates: [{
        id: "artist-row",
        user_id: "op",
        artist_id: "artist-1",
        client_id: null,
        ig_media_id: "artist-reel",
        status: "candidate",
        thumbnail_path: "creative-lab/ig/artist-1/artist-reel.jpg",
      }],
    });
    const graph = read([post({ id: "reel-a", thumbnailUrl: "https://cdn.example/thumb.jpg", likes: 10 })]);
    const bytes = new Uint8Array([1, 2, 3]);
    graph.thumb = async () => ({ width: 720, height: 1280, bytes });
    const stored: string[] = [];
    await findPromoterClips(fake as unknown as ServiceRoleDb, {
      clientId: "client-puzzle",
      userId: "op",
      now: NOW,
      read: graph,
      storeThumb: async (path) => {
        stored.push(path);
      },
    });
    assert.deepEqual(stored, ["creative-lab/ig/client-puzzle/reel-a.jpg"]);
    const row = fake.tables.creative_lab_ig_candidates.find((item) => item.ig_media_id === "reel-a");
    assert.equal(row?.thumbnail_path, "creative-lab/ig/client-puzzle/reel-a.jpg");
    assert.equal(row?.artist_id, null);
    assert.equal(row?.client_id, "client-puzzle");
    assert.equal(JSON.stringify(row).includes("cdn.example"), false);
    assert.equal(
      fake.tables.creative_lab_ig_candidates.find((item) => item.id === "artist-row")?.thumbnail_path,
      "creative-lab/ig/artist-1/artist-reel.jpg",
    );
  });

  it("fills only this client's empty thumbnail paths, and a dry run writes nothing", async () => {
    const fake = seed({
      clients: [puzzle],
      creative_lab_ig_candidates: [
        { id: "p1", user_id: "op", artist_id: null, client_id: "client-puzzle", ig_media_id: "reel-a", status: "candidate", thumbnail_path: null },
        { id: "kept", user_id: "op", artist_id: null, client_id: "client-puzzle", ig_media_id: "reel-kept", status: "candidate", thumbnail_path: "already.jpg" },
        { id: "artist-row", user_id: "op", artist_id: "artist-1", client_id: "client-puzzle", ig_media_id: "artist-reel", status: "candidate", thumbnail_path: null },
        { id: "other", user_id: "op", artist_id: null, client_id: "other-client", ig_media_id: "reel-b", status: "candidate", thumbnail_path: null },
      ],
    });
    const graph = read([
      post({ id: "reel-a", thumbnailUrl: "https://cdn.example/a.jpg", likes: 10 }),
      post({ id: "reel-kept", thumbnailUrl: "https://cdn.example/kept.jpg", likes: 10 }),
      post({ id: "artist-reel", thumbnailUrl: "https://cdn.example/artist.jpg", likes: 10 }),
    ]);
    graph.thumb = async () => ({ width: 720, height: 1280, bytes: new Uint8Array([4]) });
    const dry = await fillMissingPromoterThumbs(fake as unknown as ServiceRoleDb, {
      clientId: "client-puzzle",
      userId: "op",
      read: graph,
      storeThumb: async () => undefined,
    });
    assert.deepEqual(dry.filled, [{ igMediaId: "reel-a", path: "creative-lab/ig/client-puzzle/reel-a.jpg" }]);
    assert.equal(fake.tables.creative_lab_ig_candidates.find((row) => row.id === "p1")?.thumbnail_path, null);
    const stored: string[] = [];
    const applied = await fillMissingPromoterThumbs(fake as unknown as ServiceRoleDb, {
      clientId: "client-puzzle",
      userId: "op",
      apply: true,
      read: graph,
      storeThumb: async (path) => {
        stored.push(path);
      },
    });
    assert.deepEqual(applied.filled, dry.filled);
    assert.deepEqual(stored, ["creative-lab/ig/client-puzzle/reel-a.jpg"]);
    assert.equal(fake.tables.creative_lab_ig_candidates.find((row) => row.id === "p1")?.thumbnail_path, "creative-lab/ig/client-puzzle/reel-a.jpg");
    assert.equal(fake.tables.creative_lab_ig_candidates.find((row) => row.id === "kept")?.thumbnail_path, "already.jpg");
    assert.equal(fake.tables.creative_lab_ig_candidates.find((row) => row.id === "artist-row")?.thumbnail_path, null);
    assert.equal(fake.tables.creative_lab_ig_candidates.find((row) => row.id === "other")?.thumbnail_path, null);
  });
});

describe("requestArtistClip", () => {
  it("marks a listed clip requested", async () => {
    const fake = seed({
      creative_lab_ig_candidates: [{ artist_id: "artist-1", ig_media_id: "reel-a", status: "candidate" }],
    });
    await requestArtistClip(fake as unknown as ServiceRoleDb, { userId: "op", artistId: "artist-1", igMediaId: "reel-a" });
    assert.equal(fake.tables.creative_lab_ig_candidates[0].status, "requested");
  });
});
