import assert from "node:assert/strict";
import { test } from "node:test";

import {
  resolveArtworkChain,
  AssetUnresolvedError,
  type ArtworkStep,
} from "../assets/chain.ts";

const EVENT_ID = "evt-1";

test("returns the first non-empty URL and stops", async () => {
  const calls: string[] = [];
  const steps: ArtworkStep[] = [
    async () => {
      calls.push("a");
      return null;
    },
    async () => {
      calls.push("b");
      return "https://cdn.example.com/poster.jpg";
    },
    async () => {
      calls.push("c");
      return "https://cdn.example.com/other.jpg";
    },
  ];
  const url = await resolveArtworkChain(EVENT_ID, steps);
  assert.equal(url, "https://cdn.example.com/poster.jpg");
  assert.deepEqual(calls, ["a", "b"]);
});

test("treats a throwing step as a miss and continues", async () => {
  const steps: ArtworkStep[] = [
    async () => {
      throw new Error("boom");
    },
    async () => "https://cdn.example.com/fallback.png",
  ];
  const url = await resolveArtworkChain(EVENT_ID, steps);
  assert.equal(url, "https://cdn.example.com/fallback.png");
});

test("ignores empty/whitespace results", async () => {
  const steps: ArtworkStep[] = [
    async () => "",
    async () => "   ",
    async () => "https://cdn.example.com/real.webp",
  ];
  const url = await resolveArtworkChain(EVENT_ID, steps);
  assert.equal(url, "https://cdn.example.com/real.webp");
});

test("throws AssetUnresolvedError when every step misses", async () => {
  const steps: ArtworkStep[] = [async () => null, async () => null];
  await assert.rejects(
    () => resolveArtworkChain(EVENT_ID, steps),
    (err: unknown) => {
      assert.ok(err instanceof AssetUnresolvedError);
      assert.equal(err.eventId, EVENT_ID);
      return true;
    },
  );
});
