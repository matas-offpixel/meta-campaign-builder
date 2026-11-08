import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { importIgCandidate, requeueClipOnFocusChange } from "../ig-import.ts";
import type { ServiceRoleDb } from "../load.ts";
import { LOW_QUALITY_AFTER_CROP } from "../../../src/remotion/caption-style/profile.ts";
import { fakeDb, type FakeDb } from "./fake-db.ts";

const USER = "op";

function seed(candidate: Record<string, unknown>, artist: Record<string, unknown> = {}): FakeDb {
  return fakeDb({
    creative_lab_ig_candidates: [{
      id: "cand-1",
      user_id: USER,
      artist_id: "artist-1",
      ig_media_id: "media-1",
      permalink: "https://www.instagram.com/reel/media-1/",
      likes: 10,
      comments: 2,
      followers_at_fetch: 100,
      posted_at: "2026-11-01T00:00:00Z",
      has_file: true,
      file_source: "own_edge",
      audio_match: true,
      status: "candidate",
      asset_id: null,
      clip_id: null,
      overlay_check: null,
      ...candidate,
    }],
    creative_lab_artists: [{
      id: "artist-1",
      user_id: USER,
      name: "Enzo Siragusa",
      ig_username: "enzosiragusa",
      approved_at: null,
      rights_doc_ref: "",
      ...artist,
    }],
    creative_lab_clips: [],
    creative_assets: [],
    creative_lab_renders: [],
  });
}

function deps(probe: { width: number; height: number; durationInSeconds: number }, verdict = "clean") {
  const steps: string[] = [];
  return {
    steps,
    mediaUrl: async () => {
      steps.push("url");
      return "https://cdn.example/video.mp4";
    },
    download: async () => {
      steps.push("bytes");
      return new Uint8Array([1, 2, 3, 4]);
    },
    upload: async () => {
      steps.push("upload");
    },
    probe: () => probe,
    check: async () => ({ verdict, frames: [{ t: 0.5, text: verdict === "text_overlay", what: "" }] }),
  };
}

describe("instagram import", () => {
  it("downloads, registers, checks, then writes a clip, and a second Add does nothing", async () => {
    const fake = seed({});
    const first = deps({ width: 1080, height: 1920, durationInSeconds: 12 });
    const result = await importIgCandidate(fake as unknown as ServiceRoleDb, { candidateId: "cand-1", userId: USER, ...first });
    assert.equal(result.outcome, "imported");
    assert.deepEqual(result.steps, ["download", "register", "check", "clip"]);
    const clip = fake.tables.creative_lab_clips[0]!;
    assert.equal(clip.source, "instagram");
    assert.equal(clip.external_id, "media-1");
    assert.equal(clip.audio_status, "original");
    assert.equal(clip.rights_ref, "Instagram @enzosiragusa, own feed");
    assert.equal(clip.audio_match, true);
    const again = await importIgCandidate(fake as unknown as ServiceRoleDb, { candidateId: "cand-1", userId: USER, ...deps({ width: 1080, height: 1920, durationInSeconds: 12 }) });
    assert.equal(again.outcome, "noop");
    assert.equal(again.steps.length, 0);
    assert.equal(fake.tables.creative_lab_clips.length, 1);
  });

  it("imports an uncleared artist", async () => {
    const fake = seed({}, { approved_at: null });
    const result = await importIgCandidate(fake as unknown as ServiceRoleDb, {
      candidateId: "cand-1",
      userId: USER,
      ...deps({ width: 1080, height: 1920, durationInSeconds: 8 }),
    });
    assert.equal(result.outcome, "imported");
  });

  it("does not download a Business Discovery candidate", async () => {
    const fake = seed({ has_file: false, file_source: "none" });
    const called = deps({ width: 1080, height: 1920, durationInSeconds: 8 });
    const result = await importIgCandidate(fake as unknown as ServiceRoleDb, { candidateId: "cand-1", userId: USER, ...called });
    assert.equal(result.outcome, "refused");
    assert.equal(called.steps.length, 0);
    assert.equal(fake.tables.creative_lab_clips.length, 0);
  });

  it("refuses a crop under 540 px and writes no clip", async () => {
    const fake = seed({});
    const result = await importIgCandidate(fake as unknown as ServiceRoleDb, {
      candidateId: "cand-1",
      userId: USER,
      ...deps({ width: 800, height: 450, durationInSeconds: 8 }),
    });
    assert.equal(result.outcome, "skipped");
    assert.equal(result.reason, LOW_QUALITY_AFTER_CROP);
    assert.equal(fake.tables.creative_lab_clips.length, 0);
    assert.equal(result.steps.includes("check"), false);
  });

  it("trims a 31.6s source to the first 30s on the clip", async () => {
    const fake = seed({});
    const result = await importIgCandidate(fake as unknown as ServiceRoleDb, {
      candidateId: "cand-1",
      userId: USER,
      ...deps({ width: 1080, height: 1920, durationInSeconds: 31.6 }),
    });
    assert.equal(result.outcome, "imported");
    const clip = fake.tables.creative_lab_clips[0]!;
    assert.equal(clip.in_s, 0);
    assert.equal(clip.out_s, 30);
    assert.equal(fake.tables.creative_assets[0]?.duration_seconds, 31.6);
  });

  it("trims import-anyway from the asset duration when it does not probe again", async () => {
    const fake = seed({
      asset_id: "asset-1",
      status: "skipped",
      overlay_check: { verdict: "check_by_eye", frames: [], reason: "Check this one by eye.", flagged: 0 },
    });
    fake.tables.creative_assets.push({
      id: "asset-1",
      user_id: USER,
      storage_path: "videos/creative-lab/artist-1/x.mp4",
      duration_seconds: 31.625,
    });
    const called = deps({ width: 1080, height: 1920, durationInSeconds: 31.625 });
    const result = await importIgCandidate(fake as unknown as ServiceRoleDb, { candidateId: "cand-1", userId: USER, anyway: true, ...called });
    assert.equal(result.outcome, "imported");
    assert.equal(called.steps.length, 0);
    const clip = fake.tables.creative_lab_clips[0]!;
    assert.equal(clip.in_s, 0);
    assert.equal(clip.out_s, 30);
  });

  it("imports anyway from the stored file without downloading or checking", async () => {
    const fake = seed({
      asset_id: "asset-1",
      status: "skipped",
      overlay_check: { verdict: "text_overlay", frames: [], reason: "Text burned into 3 of 8 frames", flagged: 3 },
    });
    fake.tables.creative_assets.push({ id: "asset-1", user_id: USER, storage_path: "videos/creative-lab/artist-1/x.mp4" });
    const called = deps({ width: 1080, height: 1920, durationInSeconds: 8 });
    const result = await importIgCandidate(fake as unknown as ServiceRoleDb, { candidateId: "cand-1", userId: USER, anyway: true, ...called });
    assert.equal(result.outcome, "imported");
    assert.deepEqual(result.steps, ["clip"]);
    assert.equal(called.steps.length, 0);
  });

  it("re-queues a finished render when the crop moves and leaves a running one", async () => {
    const fake = seed({});
    fake.tables.creative_lab_clips.push({ id: "clip-1", user_id: USER, crop_focus_x: 0.5 });
    fake.tables.creative_lab_renders.push(
      { id: "done", clip_id: "clip-1", status: "done", error: "old" },
      { id: "run", clip_id: "clip-1", status: "rendering", error: null },
    );
    const queued = await requeueClipOnFocusChange(fake as unknown as ServiceRoleDb, { clipId: "clip-1", userId: USER, cropFocusX: 0 });
    assert.equal(queued, 1);
    assert.equal(fake.tables.creative_lab_renders.find((row) => row.id === "done")?.status, "queued");
    assert.equal(fake.tables.creative_lab_renders.find((row) => row.id === "run")?.status, "rendering");
    assert.equal(fake.tables.creative_lab_clips[0]?.crop_focus_x, 0);
  });
});
