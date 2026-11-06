import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { styleVersion } from "../../../src/remotion/caption-style/profile.ts";
import type { ServiceRoleDb } from "../load.ts";
import { generateCaptions, substitutePlaceholders, type AnthropicLike, type CaptionCandidate } from "../writer.ts";
import { fakeDb, type FakeDb } from "./fake-db.ts";

const EVENT = "evt-day";

function eventDb(captions: Record<string, unknown>[] = []): FakeDb {
  return fakeDb({
    events: [
      {
        id: EVENT,
        client_id: "client-puzzle",
        user_id: "op",
        name: "Puzzle 4th Birthday Part 1",
        event_date: "2026-12-27",
        venue_name: "Circuit",
        venue_city: "Southampton",
      },
    ],
    creative_lab_event_facts: [{ event_id: EVENT, lineup: ["Luke Dean", "Reeshy"], headliners: ["Luke Dean"], allowed_dates: ["2026-10-30"] }],
    event_ticket_tiers: [],
    creative_lab_artists: [{ id: "artist-1", name: "Luke Dean" }],
    creative_lab_captions: captions,
    creative_lab_clips: [],
  });
}

function claude(candidates: CaptionCandidate[], seen: Record<string, unknown>[]): AnthropicLike {
  return {
    messages: {
      create: async (args) => {
        seen.push(args);
        return {
          content: [
            {
              type: "tool_use",
              name: "submit_captions",
              input: {
                candidates: candidates.map((c) => ({
                  overlay: c.overlay,
                  primary_text: c.primaryText,
                  declared_names: c.declaredNames,
                })),
              },
            },
          ],
        };
      },
    },
  };
}

function clashOnce(fake: FakeDb): ServiceRoleDb {
  let armed = true;
  return {
    from(table: string) {
      const builder = fake.from(table) as { insert: (payload: Record<string, unknown>) => unknown };
      if (table !== "creative_lab_captions") return builder;
      const insert = builder.insert.bind(builder);
      builder.insert = (payload: Record<string, unknown>) => {
        if (!armed) return insert(payload);
        armed = false;
        fake.tables.creative_lab_captions.push({
          id: "race",
          event_id: payload.event_id,
          style: payload.style,
          caption_no: payload.caption_no,
          text: "raced",
        });
        return {
          select: () => ({
            single: async () => ({ data: null, error: { message: "duplicate key value violates unique constraint (23505)" } }),
          }),
        };
      };
      return builder;
    },
  } as unknown as ServiceRoleDb;
}

describe("generateCaptions", () => {
  it("fills placeholders from the record and keeps the first n that pass", async () => {
    assert.equal(
      substitutePlaceholders("{artist} at {venue} on {date}", {
        artist: "Luke Dean",
        venue: "Circuit",
        city: "Southampton",
        date: "27 December",
        lineup: "Luke Dean",
        next3: "",
      }),
      "Luke Dean at Circuit on 27 December",
    );
    const fake = eventDb([{ id: "old", event_id: EVENT, style: "lineup", caption_no: 3, text: "See Luke Dean at Circuit" }]);
    const calls: Record<string, unknown>[] = [];
    const written = await generateCaptions(fake as unknown as ServiceRoleDb, { eventId: EVENT, artistId: "artist-1", style: "lineup", n: 1, now: new Date("2026-11-06T12:00:00Z") }, {
      anthropic: claude(
        [
          { overlay: "🔥 {artist}", primaryText: "Come", declaredNames: ["Luke Dean"] },
          { overlay: "See {artist} at {venue}", primaryText: "Come through", declaredNames: ["Luke Dean"] },
          { overlay: "{artist} at {venue}", primaryText: "You in?", declaredNames: ["Luke Dean"] },
          { overlay: "{artist} at {venue}!", primaryText: "You in?", declaredNames: ["Luke Dean"] },
          { overlay: "With {artist} at {venue}", primaryText: "You in?", declaredNames: ["Luke Dean"] },
        ],
        calls,
      ),
    });
    const asked = ((calls[0].messages as { content: string }[])[0].content);
    assert.match(asked, /Write 5 different lineup/);
    assert.equal(calls[0].temperature, 0.7);
    assert.equal(written.length, 1);
    assert.equal(written[0].text, "Luke Dean at Circuit");
    assert.equal(written[0].primaryText, "You in?");
    assert.equal(written[0].sizeVariant, "default");
    assert.equal(written[0].captionNo, 4);
    assert.equal(fake.tables.creative_lab_captions.filter((row) => row.status === "proposed").length, 1);
    assert.equal(fake.tables.creative_lab_captions.find((row) => row.id === written[0].id)?.style_version, await styleVersion());
  });

  it("does not write a generated caption that has no primary text", async () => {
    const fake = eventDb();
    const rejected: string[] = [];
    const written = await generateCaptions(fake as unknown as ServiceRoleDb, { eventId: EVENT, artistId: "artist-1", style: "lineup", n: 1, now: new Date("2026-11-06T12:00:00Z") }, {
      anthropic: claude([
        { overlay: "{artist} at {venue}", primaryText: "   ", declaredNames: ["Luke Dean"] },
        { overlay: "{artist} at {venue}!", primaryText: "You in?", declaredNames: ["Luke Dean"] },
      ], []),
      onReject: (_overlay, _primary, errors) => rejected.push(errors.map((error) => error.code).join(",")),
    });
    assert.deepEqual(rejected, ["primary_missing"]);
    assert.equal(written.length, 1);
    assert.equal(written[0].primaryText, "You in?");
    assert.equal(fake.tables.creative_lab_captions.some((row) => !String(row.primary_text ?? "").trim()), false);
  });

  it("retries a caption_no clash once and takes the next number", async () => {
    const fake = eventDb();
    const written = await generateCaptions(clashOnce(fake), { eventId: EVENT, artistId: "artist-1", style: "lineup", n: 1, now: new Date("2026-11-06T12:00:00Z") }, {
      anthropic: claude([{ overlay: "{artist} at {venue}", primaryText: "You in?", declaredNames: ["Luke Dean"] }], []),
    });
    assert.equal(written[0].captionNo, 2);
    assert.equal(fake.tables.creative_lab_captions.find((row) => row.id === written[0].id)?.caption_no, 2);
  });

  it("refuses a missing facts row and empty headliners before calling the model", async () => {
    const missing = eventDb();
    missing.tables.creative_lab_event_facts = [];
    const calls: Record<string, unknown>[] = [];
    await assert.rejects(
      generateCaptions(missing as unknown as ServiceRoleDb, { eventId: EVENT, style: "lineup", n: 1 }, { anthropic: claude([], calls) }),
      /no event facts/,
    );
    const blank = eventDb();
    blank.tables.creative_lab_event_facts[0].headliners = [];
    await assert.rejects(
      generateCaptions(blank as unknown as ServiceRoleDb, { eventId: EVENT, style: "lineup", n: 1 }, { anthropic: claude([], calls) }),
      /headliners not set/,
    );
    assert.equal(calls.length, 0);
  });

  it("uses the stage override for CTAs when events.status still says upcoming", async () => {
    const fake = eventDb();
    fake.tables.events[0].status = "upcoming";
    const written = await generateCaptions(fake as unknown as ServiceRoleDb, {
      eventId: EVENT,
      artistId: "artist-1",
      style: "lineup",
      n: 1,
      stageOverride: "on_sale",
      now: new Date("2026-11-06T12:00:00Z"),
    }, {
      anthropic: claude([
        { overlay: "{artist} at {venue}", primaryText: "Sign up for presale", declaredNames: ["Luke Dean"] },
        { overlay: "{artist} at {venue}", primaryText: "Who's coming?", declaredNames: ["Luke Dean"] },
      ], []),
    });
    assert.equal(written.length, 1);
    assert.equal(written[0].primaryText, "Who's coming?");
  });
});
