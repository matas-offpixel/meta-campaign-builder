import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runClipSync } from "../clip-sync.ts";
import { fortnightRoom, igAutoImportEnabled, planAutoImport } from "../ig-auto.ts";
import type { ServiceRoleDb } from "../load.ts";
import { fakeDb } from "./fake-db.ts";

const NOW = new Date("2026-11-06T00:00:00.000Z");

describe("instagram auto import", () => {
  it("is on only when the env is exactly 1", () => {
    assert.equal(igAutoImportEnabled(undefined), false);
    assert.equal(igAutoImportEnabled("true"), false);
    assert.equal(igAutoImportEnabled("1"), true);
  });

  it("allows 3 new imports in a fortnight and 10 checks in a run", () => {
    const recent = ["2026-11-05T00:00:00Z", "2026-11-04T00:00:00Z", "2026-10-01T00:00:00Z"];
    assert.equal(fortnightRoom(recent, NOW), 1);
    const plan = planAutoImport({
      now: NOW,
      checksLeft: 2,
      artists: [
        {
          artistId: "a",
          name: "Ada",
          importedAt: [],
          candidates: [
            { igMediaId: "one", hasFile: true, status: "candidate", score: 3 },
            { igMediaId: "two", hasFile: true, status: "candidate", score: 2 },
            { igMediaId: "none", hasFile: false, status: "candidate", score: 9 },
            { igMediaId: "three", hasFile: true, status: "candidate", score: 1 },
          ],
        },
      ],
    });
    assert.deepEqual(plan.artists[0]?.download, ["one", "two"]);
    assert.deepEqual(plan.artists[0]?.capped, ["three"]);
    assert.equal(plan.artists[0]?.check.includes("none"), false);
  });

  it("lists without importing when the gate is unset, and stops at the fortnight", async () => {
    const fake = fakeDb({
      creative_lab_artists: [{ id: "artist-1", user_id: "op", client_id: "live", ig_username: "ada", clip_folder_url: null }],
      creative_lab_clips: [
        { artist_id: "artist-1", source: "instagram", fetched_at: "2026-11-05T00:00:00Z" },
        { artist_id: "artist-1", source: "instagram", fetched_at: "2026-11-04T00:00:00Z" },
        { artist_id: "artist-1", source: "instagram", fetched_at: "2026-11-03T00:00:00Z" },
      ],
    });
    const imported: string[] = [];
    const off = await runClipSync(fake as unknown as ServiceRoleDb, {
      now: NOW,
      archivedClientIds: new Set(),
      findClips: async () => ({ candidates: [{ igMediaId: "one", hasFile: true, score: 1 }] }),
      importCandidate: async (_artist, media) => {
        imported.push(media);
      },
    });
    assert.equal(off.instagram.enabled, false);
    assert.equal(imported.length, 0);
    const on = await runClipSync(fake as unknown as ServiceRoleDb, {
      now: NOW,
      autoImport: "1",
      archivedClientIds: new Set(),
      findClips: async () => ({ candidates: [{ igMediaId: "one", hasFile: true, score: 1 }, { igMediaId: "two", hasFile: false, score: 2 }] }),
      importCandidate: async (_artist, media) => {
        imported.push(media);
      },
    });
    assert.equal(on.instagram.enabled, true);
    assert.deepEqual(imported, []);
    assert.equal(on.instagram.artists[0]?.capped, 1);
  });
});
