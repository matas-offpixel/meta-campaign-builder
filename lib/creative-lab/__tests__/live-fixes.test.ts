import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { ServiceRoleDb } from "../load.ts";
import { runRenderTick } from "../render-queue.ts";
import {
  findClipsErrorSentence,
  findClipsReadingLine,
  importErrorSentence,
  renderRefusalSentence,
  renderRowWord,
  visibleRenderRows,
} from "../surface.ts";
import { fakeDb, type FakeDb } from "./fake-db.ts";

/**
 * Two live-use defects from the first P26-BDAY run (8 Nov 2026):
 *  1. Find clips, Add and Import had no working state and swallowed errors.
 *  2. A render row read "This render failed — try it again." with no cause.
 *     The row was P26-BDAY's old 4:5 render, superseded when video went
 *     9:16-only; the queue stores a reason on every real failure.
 */

const NOW = "2026-11-08T12:00:00.000Z";

function read(path: string): string {
  return readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
}

describe("render failure sentences (defect 2)", () => {
  it("names each stored failure class in one sentence", () => {
    assert.equal(renderRefusalSentence("Lambda render failed"), "The renderer failed — try it again.");
    assert.equal(renderRefusalSentence("Lambda render finished without an output file"), "The renderer failed — try it again.");
    assert.equal(renderRefusalSentence("REMOTION_LAMBDA_SERVE_URL is not set. Run scripts/remotion-lambda-deploy.mts and set the printed serve URL."), "The renderer failed — try it again.");
    // Lambda's own "no file" is the renderer, not the clip.
    assert.equal(renderRefusalSentence("Lambda render produced no file"), "The renderer failed — try it again.");
    assert.equal(renderRefusalSentence("Lambda render timed out"), "The render timed out — try it again.");
    assert.equal(renderRefusalSentence("timeout"), "The render timed out — try it again.");
    assert.equal(renderRefusalSentence("signed url for videos/a.mp4: Object not found"), "This clip's file couldn't be read — import it again.");
    assert.equal(renderRefusalSentence("clip fetch failed (404)"), "This clip's file couldn't be read — import it again.");
    assert.equal(renderRefusalSentence("mp4 has no moov atom"), "This clip's file couldn't be read — import it again.");
    assert.equal(renderRefusalSentence("clip has no source asset"), "This clip has no file — import it again.");
    assert.equal(renderRefusalSentence("storage upload: The resource already exists"), "The finished render didn't save — try it again.");
    assert.equal(renderRefusalSentence("caption lines are missing"), "This caption has no lines — generate it again.");
    // The text check on the caption still reads as the caption being too long.
    assert.equal(renderRefusalSentence('"FIXTURE HALL TONIGHT" exceeds 18 characters'), "This caption is too long — shorten it.");
    assert.equal(renderRefusalSentence("aspect '4:5' with kind 'video' is not rendered"), "This clip isn't vertical — use a 9:16 file.");
  });

  it("bare fetch failed is a network error, so it reads as the renderer, not the clip", () => {
    assert.equal(renderRefusalSentence("fetch failed"), "The renderer failed — try it again.");
    assert.equal(renderRefusalSentence("TypeError: fetch failed"), "The renderer failed — try it again.");
    // Tied to the clip's file, it still blames the file.
    assert.equal(renderRefusalSentence("signed url for videos/a.mp4: fetch failed"), "This clip's file couldn't be read — import it again.");
    assert.equal(renderRefusalSentence("clip fetch failed (403)"), "This clip's file couldn't be read — import it again.");
  });

  it("a superseded row is not a refusal and is not listed", () => {
    assert.equal(renderRefusalSentence("superseded: 9:16 only"), null);
    const rows = [
      { id: "old", status: "failed", error: "superseded: 9:16 only" },
      { id: "new", status: "done", error: null },
      { id: "bad", status: "failed", error: "Lambda render failed" },
      { id: "draft", status: "draft", error: null },
    ];
    assert.deepEqual(visibleRenderRows(rows).map((row) => row.id), ["new", "bad"]);
  });

  it("the row's word for a failed render is its sentence", () => {
    const failed = { id: "f", status: "failed", renderMs: null, updatedAt: NOW, error: "Lambda render failed" };
    assert.equal(renderRowWord(failed, [failed], NOW), "The renderer failed — try it again.");
  });

  it("the queue stores the thrown reason on the render and the ad, and the row reads it", async () => {
    const fake: FakeDb = fakeDb({
      creative_lab_renders: [{ id: "r1", status: "queued", created_at: "2026-11-08", caption_id: "c1", user_id: "op" }],
      creative_lab_captions: [{ id: "c1", event_id: "evt" }],
      creative_lab_round_ads: [{ id: "ad1", render_id: "r1", launch_state: "pending", round_id: "round-1", verdict: null }],
      creative_lab_rounds: [{ id: "round-1", status: "rendering" }],
    });
    await runRenderTick(fake as unknown as ServiceRoleDb, {
      now: new Date(NOW),
      archivedEventIds: new Set(),
      render: async () => {
        throw new Error("Lambda render failed");
      },
    });
    const row = fake.tables.creative_lab_renders[0]!;
    assert.equal(row.status, "failed");
    assert.equal(row.error, "Lambda render failed");
    assert.equal(fake.tables.creative_lab_round_ads[0]!.launch_error, "Lambda render failed");
    assert.equal(renderRefusalSentence(String(row.error)), "The renderer failed — try it again.");
  });
});

describe("Find clips, Add and Import pending and error states (defect 1)", () => {
  it("the lineup row says whose posts are being read", () => {
    assert.equal(findClipsReadingLine("enzosiragusa"), "reading @enzosiragusa's posts");
    assert.equal(findClipsReadingLine("@enzosiragusa"), "reading @enzosiragusa's posts");
    assert.equal(findClipsReadingLine(null), "reading their posts");
  });

  it("a route's own sentence is shown; anything raw becomes one sentence that says what to do", () => {
    assert.equal(findClipsErrorSentence("Connect Facebook in Account Setup.", "adanorth"), "Connect Facebook in Account Setup.");
    assert.equal(findClipsErrorSentence("creative_lab_ig_candidates: duplicate key value", "adanorth"), "Couldn't read @adanorth's posts — try Find clips again.");
    assert.equal(findClipsErrorSentence(undefined, null), "Couldn't read the posts — try Find clips again.");
    assert.equal(importErrorSentence("Import isn't available."), "Import isn't available.");
    assert.equal(importErrorSentence("The file isn't stored yet."), "The file isn't stored yet.");
    assert.equal(importErrorSentence("fetch failed"), "This clip didn't import — try again.");
    assert.equal(importErrorSentence("TypeError: Cannot read properties of undefined"), "This clip didn't import — try again.");
    assert.equal(importErrorSentence({ message: "x" }), "This clip didn't import — try again.");
  });

  it("the lineup row shows Finding… with the spinner, the reading line, and the error sentence", () => {
    const src = read("components/dashboard/events/creative-lab/lineup.tsx");
    assert.match(src, /Finding…/);
    assert.match(src, /Loader2 className="h-3\.5 w-3\.5 animate-spin"/);
    assert.match(src, /disabled=\{busy \|\| finding\}/);
    assert.match(src, /findClipsReadingLine\(row\.instagramHandle\)/);
    assert.match(src, /findClipsErrorSentence\(json\.error, row\.instagramHandle\)/);
    // The response is read, not ignored.
    assert.match(src, /if \(!res\.ok\)/);
  });

  it("Add, Import and Import anyway all read Importing… with the spinner and leave a sentence on failure", () => {
    const src = read("components/dashboard/events/creative-lab/clips.tsx");
    assert.match(src, /Loader2 className="h-3\.5 w-3\.5 animate-spin"/);
    assert.equal((src.match(/pending \? <Importing \/>/g) ?? []).length, 2);
    assert.match(src, /importing === open\.id \? <Importing \/> : "Import anyway"/);
    assert.match(src, /importErrorSentence\(json\.error\)/);
    assert.match(src, /if \(!res\.ok\)/);
  });

  it("render rows list only visible rows and put a failed row's sentence under its label", () => {
    const src = read("components/dashboard/events/creative-lab/render-rows.tsx");
    assert.match(src, /visibleRenderRows\(rows\)/);
    assert.match(src, /failed \? \(\s*<FailureLine/);
    assert.match(src, /<p data-render-failure className="mt-0\.5 text-xs text-destructive">/);
  });

  it("does not touch the four files Cursor is editing today", () => {
    for (const path of ["components/dashboard/events/creative-lab/captions.tsx", "lib/creative-lab/writer.ts", "lib/creative-lab/ig-discovery.ts", "app/api/cron/creative-lab-clip-sync/route.ts"]) {
      assert.doesNotMatch(read(path), /findClipsReadingLine|importErrorSentence|visibleRenderRows/, path);
    }
  });
});
