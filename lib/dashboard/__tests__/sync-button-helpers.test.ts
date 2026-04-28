import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  extractErrorMessage,
  isSyncSuccessful,
  runWithConcurrency,
  type SyncResponseBody,
} from "../sync-button-helpers.ts";

describe("extractErrorMessage", () => {
  it("prefers metaError when present", () => {
    const body: SyncResponseBody = {
      summary: { metaError: "boom", allocatorError: "ignored" },
    };
    assert.equal(extractErrorMessage(body), "Meta: boom");
  });

  it("skips not_linked eventbrite errors", () => {
    const body: SyncResponseBody = {
      summary: {
        eventbriteError: "not bound",
        eventbriteReason: "not_linked",
      },
    };
    assert.equal(
      extractErrorMessage(body),
      "Sync failed (no error detail reported)",
    );
  });

  it("surfaces eventbrite errors when reason is something else", () => {
    const body: SyncResponseBody = {
      summary: {
        eventbriteError: "credentials_invalid",
        eventbriteReason: "credentials_invalid",
      },
    };
    assert.equal(
      extractErrorMessage(body),
      "Eventbrite: credentials_invalid",
    );
  });

  it("falls back to allocator, then top-level error", () => {
    assert.equal(
      extractErrorMessage({ summary: { allocatorError: "alloc" } }),
      "Allocator: alloc",
    );
    assert.equal(extractErrorMessage({ error: "top" }), "top");
    assert.equal(
      extractErrorMessage({}),
      "Sync failed (no error detail reported)",
    );
  });
});

describe("isSyncSuccessful", () => {
  it("prefers summary.synced over body.ok", () => {
    assert.equal(
      isSyncSuccessful({ ok: false, summary: { synced: true } }),
      true,
    );
    assert.equal(
      isSyncSuccessful({ ok: true, summary: { synced: false } }),
      false,
    );
  });

  it("falls back to body.ok when summary.synced is missing", () => {
    assert.equal(isSyncSuccessful({ ok: true }), true);
    assert.equal(isSyncSuccessful({ ok: false }), false);
  });

  it("treats missing ok + synced as success (legacy pre-#121 shape)", () => {
    // body.ok defaults to "not false" → the cron route historically
    // returned 200 with no body when there was nothing to do.
    assert.equal(isSyncSuccessful({}), true);
  });
});

describe("runWithConcurrency", () => {
  it("returns results in input order", async () => {
    const items = [1, 2, 3, 4, 5];
    const out = await runWithConcurrency(items, 2, async (n) => n * 2);
    assert.deepEqual(
      out.map((r) => (r.status === "fulfilled" ? r.value : null)),
      [2, 4, 6, 8, 10],
    );
  });

  it("caps concurrent in-flight tasks", async () => {
    let inFlight = 0;
    let maxSeen = 0;
    const items = new Array(10).fill(0).map((_, i) => i);
    await runWithConcurrency(items, 3, async () => {
      inFlight++;
      maxSeen = Math.max(maxSeen, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
    });
    assert.ok(maxSeen <= 3, `expected max 3 in-flight, saw ${maxSeen}`);
  });

  it("captures rejections as rejected settled results", async () => {
    const out = await runWithConcurrency([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error("boom");
      return n;
    });
    assert.equal(out[0].status, "fulfilled");
    assert.equal(out[1].status, "rejected");
    assert.equal(out[2].status, "fulfilled");
    if (out[1].status === "rejected") {
      assert.match(String(out[1].reason), /boom/);
    }
  });

  it("reports progress with completed/total counters", async () => {
    const items = [1, 2, 3, 4];
    const progress: Array<[number, number]> = [];
    await runWithConcurrency(
      items,
      2,
      async () => {
        await new Promise((r) => setTimeout(r, 1));
      },
      (c, t) => progress.push([c, t]),
    );
    assert.deepEqual(
      progress.map(([c, t]) => `${c}/${t}`),
      ["1/4", "2/4", "3/4", "4/4"],
    );
  });

  it("handles empty input without scheduling workers", async () => {
    const out = await runWithConcurrency([], 5, async () => "nope");
    assert.deepEqual(out, []);
  });
});
