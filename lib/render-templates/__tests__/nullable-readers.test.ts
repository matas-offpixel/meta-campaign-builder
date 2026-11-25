/**
 * Migration 270 makes creative_lab_renders.clip_id and caption_id nullable,
 * for render package files only. Every caption-render path that could meet
 * such a row: it is skipped, refused, or never selected, and is left as it was.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { fakeDb } from "../../mcp/__tests__/fake-db.ts";
import { runRenderTick } from "../../creative-lab/render-queue.ts";
import { renderCaptionOnClip } from "../../creative-lab/render.ts";
import { retryRender } from "../../creative-lab/propose.ts";
import { loadFilingContext, wantsFiling } from "../../drive/filing.ts";
import { MATAS } from "./fixtures.ts";

const pkgRow = (over: Record<string, unknown> = {}) => ({
  id: "pkg-file-1",
  user_id: MATAS,
  clip_id: null,
  caption_id: null,
  recipe: "montage",
  package_id: "pkg-1",
  file_name: "P26-BDAY__promoter-puzzle__montage__teaser__tickets__r1__9x16.mp4",
  variant: "teaser",
  aspect: "9:16",
  kind: "video",
  style_version: "m4-montage-v1",
  status: "queued",
  attempt: 1,
  error: null,
  drive_status: null,
  created_at: "2026-11-25T12:00:00Z",
  updated_at: "2026-11-25T12:00:00Z",
  ...over,
});

test("the caption render tick never claims a queued package file", async () => {
  const db = fakeDb({ creative_lab_renders: [pkgRow()], creative_lab_clips: [], creative_lab_captions: [], creative_lab_round_ads: [], creative_lab_rounds: [] });
  const rendered: string[] = [];
  const out = await runRenderTick(db as never, { archivedEventIds: new Set(), remotionEnabled: true, render: async (id) => void rendered.push(id), maxAtOnce: 4 });
  assert.equal(out.claimed, 0);
  assert.deepEqual(rendered, []);
  const row = ((await db.from("creative_lab_renders").select("*")).data as Record<string, unknown>[])[0]!;
  assert.equal(row.status, "queued");
});

test("renderCaptionOnClip refuses a package file before touching it", async () => {
  const db = fakeDb({ creative_lab_renders: [pkgRow()] });
  await assert.rejects(renderCaptionOnClip(db as never, { renderId: "pkg-file-1", userId: MATAS }), /render package file/);
  assert.deepEqual(db.writes, []);
});

test("the caption Try again refuses a package file in its existing words", async () => {
  const db = fakeDb({ creative_lab_renders: [pkgRow({ status: "failed", error: "timeout" })] });
  await assert.rejects(retryRender(db as never, { renderId: "pkg-file-1", userId: MATAS }), /This render isn’t on your Lab|This render isn't on your Lab/);
  assert.deepEqual(db.writes, []);
});

test("Drive filing: a package file the worker filed isn't filed again; one it didn't is skipped as not in a round", async () => {
  const now = new Date("2026-11-25T12:00:00Z");
  assert.equal(wantsFiling(pkgRow({ status: "done", drive_status: "copied", drive_render_attempt: 1 }) as never, now), false);
  assert.equal(wantsFiling(pkgRow({ status: "done", drive_status: "failed" }) as never, now), false);
  const db = fakeDb({ creative_lab_round_ads: [], creative_lab_rounds: [] });
  assert.deepEqual(await loadFilingContext(db as never, pkgRow({ status: "done" }) as never), { skip: "not_in_a_round" });
});
