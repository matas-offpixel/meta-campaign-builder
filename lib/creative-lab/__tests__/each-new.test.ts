import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { generateLabCaptions } from "../card-write.ts";
import { CAPTIONS_NOT_WRITTEN, LINES_ALREADY_ON_EVENT } from "../surface.ts";
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
  it("refills once for Each selected when fewer than n are kept, and does not pin a clip", async () => {
    const fake = eventWithClip(
      { id: "clip-5", artist_id: "enzo", clip_no: 5, in_s: null, out_s: null, creative_asset_id: "asset-5" },
      { id: "asset-5", duration_seconds: 31.625 },
    );
    let calls = 0;
    const once = {
      messages: {
        create: async () => {
          calls += 1;
          return claude().messages.create({});
        },
      },
    };
    const result = await generateLabCaptions(fake as unknown as ServiceRoleDb, {
      eventId: EVENT,
      style: "lineup",
      n: 3,
      each: true,
      artistId: "enzo",
    }, { anthropic: once });
    assert.equal(calls, 2);
    assert.equal(result.notice, null);
    assert.equal(result.captions.length, 2);
    assert.ok(result.captions.every((caption) => fake.tables.creative_lab_captions.find((row) => row.id === caption.id)?.clip_id == null));
  });

  it("says when every line the writer returned is already on the event", async () => {
    const fake = eventWithClip(
      { id: "clip-1", artist_id: "enzo", clip_no: 1, in_s: null, out_s: null, creative_asset_id: "asset-1" },
      { id: "asset-1", duration_seconds: 21.7 },
    );
    fake.tables.creative_lab_captions.push({
      id: "old",
      event_id: EVENT,
      text: "See Luke Dean at Circuit",
      status: "proposed",
    });
    const repeat = {
      messages: {
        create: async () => ({
          content: [{
            type: "tool_use",
            name: "submit_captions",
            input: { candidates: [{ overlay: "See {artist} at {venue}", primary_text: "Come through", declared_names: ["Luke Dean"] }] },
          }],
        }),
      },
    };
    const result = await generateLabCaptions(fake as unknown as ServiceRoleDb, {
      eventId: EVENT,
      style: "lineup",
      n: 1,
      pair: "each",
      artistId: "enzo",
    }, { anthropic: repeat });
    assert.equal(result.notice, LINES_ALREADY_ON_EVENT);
    assert.equal(result.captions.length, 0);
    assert.equal(fake.writes.some((write) => write.table === "creative_lab_captions" && write.op === "insert"), false);
  });

  it("writes once when the lineup clips have no filmed show", async () => {
    const fake = fakeDb({
      events: [{
        id: EVENT,
        client_id: "client-1",
        user_id: "op",
        name: "Puzzle 4th Birthday",
        event_date: "2026-12-27",
        venue_name: "Circuit",
        venue_city: "Southampton",
      }],
      creative_lab_event_facts: [{ event_id: EVENT, lineup: ["Enzo Siragusa", "Luke Dean"], headliners: ["Luke Dean"], allowed_dates: ["2026-10-30"] }],
      event_ticket_tiers: [],
      artists: [
        { id: "lib-enzo", name: "Enzo Siragusa" },
        { id: "lib-luke", name: "Luke Dean" },
        { id: "lib-other", name: "Reeshy" },
      ],
      event_artists: [
        { event_id: EVENT, artist_id: "lib-enzo" },
        { event_id: EVENT, artist_id: "lib-luke" },
      ],
      creative_lab_artists: [
        { id: "enzo", client_id: "client-1", artist_id: "lib-enzo", name: "Enzo Siragusa", approved_at: "2026-11-01" },
        { id: "luke", client_id: "client-1", artist_id: "lib-luke", name: "Luke Dean", approved_at: "2026-11-01" },
        { id: "other", client_id: "client-1", artist_id: "lib-other", name: "Reeshy", approved_at: "2026-11-01" },
      ],
      creative_lab_clips: [
        { id: "enzo-1", artist_id: "enzo", clip_no: 1, in_s: null, out_s: null, event_id: null, creative_asset_id: "a1" },
        { id: "enzo-5", artist_id: "enzo", clip_no: 5, in_s: null, out_s: null, event_id: null, creative_asset_id: "a5" },
        { id: "enzo-long", artist_id: "enzo", clip_no: 6, in_s: 0, out_s: 40, event_id: null, creative_asset_id: "along" },
        { id: "luke-1", artist_id: "luke", clip_no: 1, in_s: null, out_s: null, event_id: EVENT, creative_asset_id: "aluke" },
        { id: "off-bill", artist_id: "other", clip_no: 1, in_s: null, out_s: null, event_id: EVENT, creative_asset_id: "aother" },
      ],
      creative_assets: [
        { id: "a1", duration_seconds: 21.7 },
        { id: "a5", duration_seconds: 31.625 },
        { id: "along", duration_seconds: 40 },
        { id: "aluke", duration_seconds: 34.06 },
        { id: "aother", duration_seconds: 12 },
      ],
      creative_lab_captions: [],
    });
    let written = 0;
    const varied = {
      messages: {
        create: async () => {
          written += 1;
          return {
            content: [{
              type: "tool_use",
              name: "submit_captions",
              input: {
                candidates: [
                  { overlay: `Night ${written} with {artist} at {venue}`, primary_text: "Come through", declared_names: ["Luke Dean"] },
                ],
              },
            }],
          };
        },
      },
    };
    const result = await generateLabCaptions(fake as unknown as ServiceRoleDb, {
      eventId: EVENT,
      style: "lineup",
      n: 1,
      pair: "each",
      artistId: "luke",
    }, { anthropic: varied });
    assert.equal(written, 1);
    assert.equal(result.notice, null);
    assert.equal(result.captions.length, 1);
    assert.equal(fake.tables.creative_lab_captions.find((row) => row.id === result.captions[0]?.id)?.clip_id, undefined);
  });

  it("leaves a sentence when the selected clips produce no caption", async () => {
    const fake = eventWithClip(
      { id: "clip-1", artist_id: "enzo", clip_no: 1, in_s: null, out_s: null, event_id: null, creative_asset_id: "asset-1" },
      { id: "asset-1", duration_seconds: 21.7 },
    );
    const silent = {
      messages: {
        create: async () => ({
          content: [{ type: "tool_use", name: "submit_captions", input: { candidates: [] } }],
        }),
      },
    };
    const result = await generateLabCaptions(fake as unknown as ServiceRoleDb, {
      eventId: EVENT,
      style: "lineup",
      n: 1,
      pair: "each",
    }, { anthropic: silent });
    assert.equal(result.notice, CAPTIONS_NOT_WRITTEN);
    assert.equal(result.captions.length, 0);
  });
});
