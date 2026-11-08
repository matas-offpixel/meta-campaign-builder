import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { generateLabCaptions } from "../card-write.ts";
import { NO_NEW_CLIPS } from "../surface.ts";
import type { ServiceRoleDb } from "../load.ts";
import type { AnthropicLike } from "../writer.ts";
import { fakeDb } from "./fake-db.ts";

const EVENT = "event-1";

function claude(): AnthropicLike {
  return {
    messages: {
      create: async () => ({
        content: [{
          type: "tool_use",
          name: "submit_captions",
          input: {
            candidates: [
              { overlay: "🔥 {artist}", primary_text: "Come", declared_names: ["Luke Dean"] },
              { overlay: "See {artist} at {venue}", primary_text: "Come through", declared_names: ["Luke Dean"] },
              { overlay: "{artist} at {venue}", primary_text: "You in?", declared_names: ["Luke Dean"] },
            ],
          },
        }],
      }),
    },
  };
}

function eventWithClip(clip: Record<string, unknown>, asset: Record<string, unknown>) {
  return fakeDb({
    events: [{
      id: EVENT,
      client_id: "client-1",
      user_id: "op",
      name: "Puzzle 4th Birthday Part 1",
      event_date: "2026-12-27",
      venue_name: "Circuit",
      venue_city: "Southampton",
    }],
    creative_lab_event_facts: [{ event_id: EVENT, lineup: ["Luke Dean"], headliners: ["Luke Dean"], allowed_dates: ["2026-10-30"] }],
    event_ticket_tiers: [],
    creative_lab_artists: [{ id: "enzo", client_id: "client-1", name: "Luke Dean", approved_at: "2026-11-01" }],
    creative_lab_clips: [clip],
    creative_assets: [asset],
    creative_lab_captions: [],
  });
}

describe("each new clip", () => {
  it("previews a 31.6s import at its trimmed 30s", async () => {
    const fake = eventWithClip(
      { id: "clip-5", artist_id: "enzo", clip_no: 5, in_s: null, out_s: null, creative_asset_id: "asset-5" },
      { id: "asset-5", duration_seconds: 31.625 },
    );
    const result = await generateLabCaptions(fake as unknown as ServiceRoleDb, {
      eventId: EVENT,
      style: "lineup",
      n: 3,
      each: true,
      artistId: "enzo",
    }, { anthropic: claude() });
    assert.equal(result.notice, null);
    assert.equal(result.captions.length, 2);
    assert.ok(result.captions.every((caption) => fake.tables.creative_lab_captions.find((row) => row.id === caption.id)?.clip_id === "clip-5"));
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
