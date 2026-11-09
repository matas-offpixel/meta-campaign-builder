import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runLoggedGenerate } from "../card-write.ts";
import { generateLogLine } from "../generate-log.ts";
import type { ServiceRoleDb } from "../load.ts";
import { loadStoredVoice } from "../voice-store.ts";
import type { AnthropicLike } from "../writer.ts";
import { fakeDb, type FakeDb } from "./fake-db.ts";

const EVENT = "a092aca8-7d9d-4ccd-9eb8-1ada0a62d3d8";
const UUID_NULL = 'invalid input syntax for type uuid: "null"';

/**
 * PostgREST sends `.eq(column, null)` as the string "null". A uuid column
 * rejects that. `.is(column, null)` is the read that matches.
 */
function rejectNullEq(fake: FakeDb): FakeDb {
  const from = fake.from.bind(fake);
  fake.from = (table: string) => {
    const api = from(table) as {
      eq: (column: string, value: unknown) => unknown;
      is?: (column: string, value: unknown) => unknown;
      then: (resolve: (value: unknown) => unknown, reject?: (err: unknown) => unknown) => unknown;
    };
    const eq = api.eq.bind(api);
    let bad = false;
    api.is = (column: string, value: unknown) => eq(column, value);
    api.eq = (column: string, value: unknown) => {
      if (value == null) bad = true;
      return eq(column, value);
    };
    const then = api.then.bind(api);
    api.then = (resolve, reject) => {
      if (!bad) return then(resolve, reject);
      return Promise.resolve({ data: null, error: { message: UUID_NULL } }).then(resolve, reject);
    };
    return api;
  };
  return fake;
}

function puzzle(): FakeDb {
  return fakeDb({
    events: [{
      id: EVENT,
      client_id: "client-puzzle",
      user_id: "op",
      name: "Puzzle 4th Birthday",
      event_date: "2026-12-27",
      venue_name: "Circuit",
      venue_city: "Southampton",
      status: "on_sale",
      clip_selection_mode: "chosen",
    }],
    creative_lab_event_facts: [{
      event_id: EVENT,
      lineup: ["Enzo Siragusa", "Luke Dean", "Reeshy"],
      headliners: ["Enzo Siragusa", "Luke Dean", "Reeshy"],
      allowed_dates: ["2026-12-27"],
    }],
    event_ticket_tiers: [],
    creative_lab_artists: [{ id: "lab-enzo", name: "Enzo Siragusa", client_id: "client-puzzle" }],
    creative_lab_clips: [
      { id: "clip-a", artist_id: "lab-enzo", clip_no: 2 },
      { id: "clip-b", artist_id: "lab-enzo", clip_no: 5 },
      { id: "clip-c", artist_id: "lab-enzo", clip_no: 1 },
    ],
    creative_lab_clip_selections: [
      { event_id: EVENT, clip_id: "clip-a", selected: true },
      { event_id: EVENT, clip_id: "clip-b", selected: true },
      { event_id: EVENT, clip_id: "clip-c", selected: false },
    ],
    creative_lab_captions: [],
    clients: [{ id: "client-puzzle", instagram_handle: "puzzle", voice_hashtags_enabled: false }],
    voice_samples: [],
  });
}

function claude(): AnthropicLike {
  return {
    messages: {
      create: async () => ({
        content: [{
          type: "tool_use",
          name: "submit_captions",
          input: {
            candidates: [{ overlay: "{lineup} at {venue}", primary_text: "You in?", declared_names: ["Enzo Siragusa", "Luke Dean", "Reeshy"] }],
          },
        }],
      }),
    },
  };
}

describe("Puzzle generate", () => {
  it("reads a promoter page whose artist id is null, which eq(null) cannot", async () => {
    const db = rejectNullEq(fakeDb({
      voice_samples: [{
        page_kind: "promoter",
        client_id: "client-puzzle",
        artist_id: null,
        caption: "See you at Circuit",
        posted_at: "2026-11-01T00:00:00Z",
      }],
    }));
    const probe = db.from("voice_samples") as { eq: (column: string, value: unknown) => Promise<{ error: { message: string } | null }> };
    const failed = await probe.eq("artist_id", null);
    assert.match(failed.error?.message ?? "", /invalid input syntax for type uuid: "null"/);

    const voice = await loadStoredVoice(db as unknown as ServiceRoleDb, "promoter", "client-puzzle", null);
    assert.equal(voice.samples.length, 1);
    assert.equal(voice.samples[0]?.caption, "See you at Circuit");
  });

  it("writes a lineup for the two chosen clips and logs the call", async () => {
    const db = rejectNullEq(puzzle());
    const lines: string[] = [];
    const original = console.info;
    console.info = (line?: unknown) => { lines.push(String(line)); };
    try {
      const result = await runLoggedGenerate(db as unknown as ServiceRoleDb, {
        eventId: EVENT,
        style: "lineup",
        n: 1,
        pair: "each",
      }, { anthropic: claude() });
      assert.equal(result.captions.length, 1);
      assert.equal(result.notice, null);
    } finally {
      console.info = original;
    }
    assert.equal(lines.length, 1);
    assert.equal(lines[0], generateLogLine({
      eventId: EVENT,
      mode: "each",
      clips: 2,
      writerResultCount: 1,
      error: null,
    }));
  });

  it("logs the error class when Generate throws", async () => {
    const lines: string[] = [];
    const original = console.info;
    console.info = (line?: unknown) => { lines.push(String(line)); };
    try {
      await assert.rejects(
        () => runLoggedGenerate(puzzle() as unknown as ServiceRoleDb, { eventId: EVENT, style: "nope", n: 1, pair: "best" }),
        /Unknown caption style/,
      );
    } finally {
      console.info = original;
    }
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]!) as { event: string; mode: string; clips: number | null; writerResultCount: number; errorClass: string };
    assert.equal(parsed.event, EVENT);
    assert.equal(parsed.mode, "best");
    assert.equal(parsed.clips, null);
    assert.equal(parsed.writerResultCount, 0);
    assert.equal(parsed.errorClass, "Unknown caption style.");
  });
});
