import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ServiceRoleDb } from "../load.ts";
import {
  findArtistClips,
  IG_MEDIA_FIELDS,
  IgDiscoveryError,
  igScore,
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
    postedAt: daysBefore(1),
    likes: 10,
    comments: 0,
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

  it("counts carousel video slides and skips image slides", () => {
    const ranked = rankIgPosts(
      [
        post({
          id: "album",
          mediaType: "CAROUSEL_ALBUM",
          mediaProductType: "FEED",
          permalink: "https://www.instagram.com/p/album/",
          likes: 20,
          comments: 1,
          children: [
            { id: "slide-v", mediaType: "VIDEO" },
            { id: "slide-i", mediaType: "IMAGE" },
            { id: "slide-v2", mediaType: "VIDEO" },
          ],
        }),
      ],
      { now: NOW, followers: 100, exclude: new Set() },
    );
    assert.deepEqual(ranked.map((row) => row.igMediaId), ["slide-v", "slide-v2"]);
    assert.equal(ranked[0]?.permalink, "https://www.instagram.com/p/album/");
    assert.equal(ranked[0]?.score, igScore({ likes: 20, comments: 1, followers: 100, ageDays: 1 }));
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

  it("refuses an artist who is not ticked as cleared", async () => {
    const graph = read([post({ id: "reel-a" })]);
    const fake = seed();
    fake.tables.creative_lab_artists[0].approved_at = null;
    await assert.rejects(
      findArtistClips(fake as unknown as ServiceRoleDb, { artistId: "artist-1", now: NOW, read: graph }),
      (err: unknown) => err instanceof IgDiscoveryError && err.code === "not_cleared",
    );
    assert.deepEqual(graph.calls, []);
    assert.match(String(fake.tables.creative_lab_artists[0].ig_last_error), /cleared/);
  });

  it("strips tokens and urls from a stored error", () => {
    const message = plainIgMessage("failed https://graph.facebook.com/v21.0/x?access_token=EAASECRETVALUE extra");
    assert.equal(message.includes("http"), false);
    assert.equal(message.includes("EAA"), false);
    assert.equal(message.includes("access_token"), false);
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
