import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { generateLabCaptions } from "../card-write.ts";
import { NO_NEW_CLIPS } from "../surface.ts";
import type { ServiceRoleDb } from "../load.ts";
import { fakeDb } from "./fake-db.ts";

describe("each new clip", () => {
  it("says why when the only Untested clip is over 30s and writes nothing", async () => {
    const fake = fakeDb({
      events: [{ id: "event-1", client_id: "client-1" }],
      creative_lab_artists: [{ id: "enzo", client_id: "client-1", name: "Enzo Siragusa", approved_at: "2026-11-01" }],
      creative_lab_clips: [{
        id: "clip-5",
        artist_id: "enzo",
        clip_no: 5,
        in_s: 0,
        out_s: 31.625,
        creative_asset_id: "asset-5",
      }],
      creative_assets: [{ id: "asset-5", duration_seconds: 31.625 }],
      creative_lab_captions: [],
    });
    const result = await generateLabCaptions(fake as unknown as ServiceRoleDb, {
      eventId: "event-1",
      style: "lineup",
      n: 3,
      each: true,
    });
    assert.equal(result.notice, NO_NEW_CLIPS);
    assert.deepEqual(result.captions, []);
    assert.equal(fake.writes.some((write) => write.table === "creative_lab_captions"), false);
  });

  it("says why when every usable Untested clip already has a preview", async () => {
    const fake = fakeDb({
      events: [{ id: "event-1", client_id: "client-1" }],
      creative_lab_artists: [{ id: "enzo", client_id: "client-1", name: "Enzo Siragusa", approved_at: "2026-11-01" }],
      creative_lab_clips: [{
        id: "clip-1",
        artist_id: "enzo",
        clip_no: 1,
        in_s: 0,
        out_s: 21.7,
        creative_asset_id: "asset-1",
      }],
      creative_assets: [{ id: "asset-1", duration_seconds: 21.7 }],
      creative_lab_captions: [{ id: "cap-1", event_id: "event-1", clip_id: "clip-1", status: "proposed" }],
    });
    const result = await generateLabCaptions(fake as unknown as ServiceRoleDb, {
      eventId: "event-1",
      style: "lineup",
      n: 3,
      each: true,
    });
    assert.equal(result.notice, NO_NEW_CLIPS);
    assert.equal(fake.writes.some((write) => write.table === "creative_lab_captions" && write.op === "insert"), false);
  });
});
