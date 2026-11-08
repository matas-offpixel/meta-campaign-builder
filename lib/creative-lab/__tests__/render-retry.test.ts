import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { ServiceRoleDb } from "../load.ts";
import { RenderRetryError, retryRender } from "../propose.ts";
import { renderFailureLine, renderRetryable, renderRoundOpen } from "../surface.ts";
import { fakeDb, type FakeDb } from "./fake-db.ts";

function read(path: string): string {
  return readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
}

const OP = "op";

/** Two failed renders in one round, plus a done render, so "nothing else touched" has something to check. */
function world(roundStatus: string, error = "Lambda render failed"): FakeDb {
  return fakeDb({
    creative_lab_renders: [
      { id: "r1", user_id: OP, clip_id: "clip-1", caption_id: "cap-1", style_version: "v3", aspect: "9:16", kind: "video", status: "failed", error, attempt: 1 },
      { id: "r2", user_id: OP, clip_id: "clip-2", caption_id: "cap-1", style_version: "v3", aspect: "9:16", kind: "video", status: "failed", error: "Lambda render failed", attempt: 1 },
      { id: "r3", user_id: OP, clip_id: "clip-3", caption_id: "cap-1", style_version: "v3", aspect: "9:16", kind: "video", status: "done", error: null, attempt: 1 },
    ],
    creative_lab_round_ads: [
      { id: "ad1", user_id: OP, round_id: "round-1", render_id: "r1", launch_state: "render_failed", launch_error: error },
      { id: "ad2", user_id: OP, round_id: "round-1", render_id: "r2", launch_state: "render_failed", launch_error: "Lambda render failed" },
      { id: "ad3", user_id: OP, round_id: "round-1", render_id: "r3", launch_state: "ready", launch_error: null },
    ],
    creative_lab_rounds: [{ id: "round-1", user_id: OP, status: roundStatus }],
  });
}

function snapshot(fake: FakeDb, table: string, id: string) {
  return JSON.stringify(fake.tables[table]!.find((row) => row.id === id));
}

describe("retry on a failed render row", () => {
  it("'try it again' is the link on the three retry sentences while the round is open", () => {
    assert.deepEqual(renderFailureLine("The renderer failed — try it again.", true), { lead: "The renderer failed — ", link: "try it again", tail: "." });
    assert.deepEqual(renderFailureLine("The render timed out — try it again.", true), { lead: "The render timed out — ", link: "try it again", tail: "." });
    assert.deepEqual(renderFailureLine("The finished render didn't save — try it again.", true), {
      lead: "The finished render didn't save — ",
      link: "try it again",
      tail: ".",
    });
  });

  it("with the round past rendering there is no link and the sentence ends '— propose the round again'", () => {
    assert.deepEqual(renderFailureLine("The renderer failed — try it again.", false), { lead: "The renderer failed — propose the round again.", link: null, tail: "" });
    assert.deepEqual(renderFailureLine("The render timed out — try it again.", false), { lead: "The render timed out — propose the round again.", link: null, tail: "" });
  });

  it("'import it again' and 'generate it again' sentences never get a link", () => {
    for (const sentence of [
      "This clip's file couldn't be read — import it again.",
      "This clip has no file — import it again.",
      "This caption has no lines — generate it again.",
      "This caption is on an old style — generate it again.",
    ]) {
      assert.deepEqual(renderFailureLine(sentence, true), { lead: sentence, link: null, tail: "" });
    }
    assert.equal(renderRetryable("clip has no source asset"), false);
    assert.equal(renderRetryable("fetch failed"), true);
  });

  it("a round is open while draft or rendering, or when the render is in none", () => {
    assert.equal(renderRoundOpen([]), true);
    assert.equal(renderRoundOpen(["draft"]), true);
    assert.equal(renderRoundOpen(["rendering"]), true);
    for (const status of ["approved", "rejected", "launched", "judged"]) assert.equal(renderRoundOpen([status]), false, status);
    assert.equal(renderRoundOpen(["launched", "draft"]), true);
  });

  it("re-queues that one render and its ad; no other render, ad or round is touched", async () => {
    const fake = world("rendering");
    const before = { r2: snapshot(fake, "creative_lab_renders", "r2"), r3: snapshot(fake, "creative_lab_renders", "r3"), ad2: snapshot(fake, "creative_lab_round_ads", "ad2"), ad3: snapshot(fake, "creative_lab_round_ads", "ad3") };
    const result = await retryRender(fake as unknown as ServiceRoleDb, { renderId: "r1", userId: OP });
    assert.deepEqual(result, { renderId: "r1" });
    const r1 = fake.tables.creative_lab_renders!.find((row) => row.id === "r1")!;
    assert.equal(r1.status, "queued");
    assert.equal(r1.attempt, 2);
    assert.equal(r1.error, null);
    const ad1 = fake.tables.creative_lab_round_ads!.find((row) => row.id === "ad1")!;
    assert.equal(ad1.launch_state, "pending");
    assert.equal(ad1.launch_error, null);
    assert.equal(snapshot(fake, "creative_lab_renders", "r2"), before.r2);
    assert.equal(snapshot(fake, "creative_lab_renders", "r3"), before.r3);
    assert.equal(snapshot(fake, "creative_lab_round_ads", "ad2"), before.ad2);
    assert.equal(snapshot(fake, "creative_lab_round_ads", "ad3"), before.ad3);
    assert.equal(fake.tables.creative_lab_rounds![0]!.status, "rendering");
    assert.equal(fake.tables.creative_lab_renders!.length, 3, "no new render row");
  });

  it("a settled draft round reads as rendering again until the queue settles it", async () => {
    const fake = world("draft", "timeout");
    await retryRender(fake as unknown as ServiceRoleDb, { renderId: "r1", userId: OP });
    assert.equal(fake.tables.creative_lab_rounds![0]!.status, "rendering");
  });

  it("refuses once the round has moved past rendering, and writes nothing", async () => {
    for (const status of ["approved", "launched", "judged", "rejected"]) {
      const fake = world(status);
      await assert.rejects(
        retryRender(fake as unknown as ServiceRoleDb, { renderId: "r1", userId: OP }),
        (err: unknown) => err instanceof RenderRetryError && err.status === 409 && err.message === "This round has moved on — propose the round again.",
      );
      assert.equal(fake.writes.length, 0, status);
    }
  });

  it("refuses another user's render, a render that isn't failed, and a failure a retry can't fix", async () => {
    const theirs = world("rendering");
    await assert.rejects(retryRender(theirs as unknown as ServiceRoleDb, { renderId: "r1", userId: "someone-else" }), (err: unknown) => err instanceof RenderRetryError && err.status === 404);
    assert.equal(theirs.writes.length, 0);

    const done = world("rendering");
    await assert.rejects(retryRender(done as unknown as ServiceRoleDb, { renderId: "r3", userId: OP }), (err: unknown) => err instanceof RenderRetryError && err.status === 409);
    assert.equal(done.writes.length, 0);

    const clip = world("rendering", "clip has no source asset");
    await assert.rejects(
      retryRender(clip as unknown as ServiceRoleDb, { renderId: "r1", userId: OP }),
      (err: unknown) => err instanceof RenderRetryError && err.message === "This clip has no file — import it again.",
    );
    assert.equal(clip.writes.length, 0);
  });

  it("the row draws the link from the card's roundOpen and posts to the retry route", () => {
    const src = read("components/dashboard/events/creative-lab/render-rows.tsx");
    assert.match(src, /renderFailureLine\(sentence, roundOpen\)/);
    assert.match(src, /roundOpen=\{row\.roundOpen && !refused\[row\.id\]\}/);
    assert.match(src, /fetch\(`\/api\/creative-lab\/renders\/\$\{id\}\/retry`, \{ method: "POST" \}\)/);
    assert.match(src, /className="underline underline-offset-2/);
    const route = read("app/api/creative-lab/renders/[id]/retry/route.ts");
    assert.match(route, /supabase\.auth\.getUser\(\)/);
    assert.match(route, /status: 401/);
    assert.match(route, /retryRender\(createServiceRoleClient\(\), \{ renderId: id, userId: user\.id \}\)/);
    const card = read("lib/db/creative-lab.ts");
    assert.match(card, /roundOpen: renderRoundOpen\(/);
  });
});
