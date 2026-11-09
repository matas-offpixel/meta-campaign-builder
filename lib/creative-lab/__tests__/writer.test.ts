import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { styleVersion } from "../../../src/remotion/caption-style/profile.ts";
import type { ServiceRoleDb } from "../load.ts";
import { emptyYield, generateLogLine } from "../generate-log.ts";
import { normaliseCaption } from "../caption-facts.ts";
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

  it("stores the clip the preview was written for", async () => {
    const fake = eventDb();
    const written = await generateCaptions(fake as unknown as ServiceRoleDb, {
      eventId: EVENT,
      artistId: "artist-1",
      style: "lineup",
      n: 1,
      clipId: "clip-5",
      now: new Date("2026-11-06T12:00:00Z"),
    }, {
      anthropic: claude([{ overlay: "{artist} at {venue}", primaryText: "You in?", declaredNames: ["Luke Dean"] }], []),
    });
    assert.equal(written.length, 1);
    assert.equal(fake.tables.creative_lab_captions.find((row) => row.id === written[0].id)?.clip_id, "clip-5");
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

  it("lists the 14 stored lineup overlays and refills once when the model repeats them", async () => {
    const stored = storedLineups(14);
    stored.push({
      id: "other-style",
      event_id: EVENT,
      style: "question",
      caption_no: 1,
      text: "Question overlay stays off this list",
      created_at: "2026-11-09T18:00:00.000Z",
    });
    const repeats = stored
      .filter((row) => row.style === "lineup")
      .map((row) => ({ overlay: String(row.text), primaryText: "You in?", declaredNames: ["Luke Dean"] }));
    const fresh = [
      { overlay: "Luke Dean at Circuit", primaryText: "You in?", declaredNames: ["Luke Dean"] },
      { overlay: "With Luke Dean at Circuit", primaryText: "You in?", declaredNames: ["Luke Dean"] },
    ];
    const { client, calls } = scripted([repeats, fresh, fresh]);
    const counted = emptyYield();
    const written = await generateCaptions(eventDb(stored) as unknown as ServiceRoleDb, {
      eventId: EVENT,
      artistId: "artist-1",
      style: "lineup",
      n: 2,
      now: new Date("2026-11-06T12:00:00Z"),
    }, { anthropic: client, yield: counted });
    assert.equal(calls.length, 2);
    assert.equal(written.length, 2);
    const first = userText(calls[0]);
    assert.match(first, /Write 6 different lineup/);
    const listed = first.split("These are already on the event and must not be repeated or lightly reworded.\n")[1]!.split("\n");
    assert.equal(listed.length, 14);
    assert.equal(listed[0], normaliseCaption("Stored lineup caption 14"));
    assert.equal(listed[13], normaliseCaption("Stored lineup caption 1"));
    assert.equal(first.includes("Question overlay"), false);
    const second = userText(calls[1]);
    assert.match(second, /These are already on the event and must not be repeated or lightly reworded/);
    assert.equal(second.includes(normaliseCaption("Stored lineup caption 14")), true);
    const line = generateLogLine({
      eventId: EVENT,
      mode: "best",
      clips: null,
      writerResultCount: written.length,
      error: null,
      yield: counted,
    });
    const parsed = JSON.parse(line) as { calls: number; candidates: number; duplicates: number; rejects: Record<string, number> };
    assert.equal(parsed.calls, 2);
    assert.equal(parsed.candidates, 16);
    assert.equal(parsed.duplicates, 14);
    assert.deepEqual(parsed.rejects, {});
    assert.equal(line.includes("Stored lineup"), false);
    assert.equal(line.includes("Luke Dean"), false);
  });

  it("does not refill when the first call keeps n", async () => {
    const { client, calls } = scripted([[
      { overlay: "Luke Dean at Circuit", primaryText: "You in?", declaredNames: ["Luke Dean"] },
    ]]);
    const written = await generateCaptions(eventDb() as unknown as ServiceRoleDb, {
      eventId: EVENT,
      artistId: "artist-1",
      style: "lineup",
      n: 1,
      now: new Date("2026-11-06T12:00:00Z"),
    }, { anthropic: client });
    assert.equal(calls.length, 1);
    assert.equal(written.length, 1);
    assert.equal(userText(calls[0]).includes("already on the event"), false);
  });

  it("never makes a second refill", async () => {
    const stored = storedLineups(14);
    const repeats = stored.map((row) => ({ overlay: String(row.text), primaryText: "You in?", declaredNames: ["Luke Dean"] }));
    const { client, calls } = scripted([
      [...repeats, { overlay: "Luke Dean at Circuit", primaryText: "You in?", declaredNames: ["Luke Dean"] }],
      [{ overlay: "With Luke Dean at Circuit", primaryText: "You in?", declaredNames: ["Luke Dean"] }],
      [{ overlay: "See Luke Dean at Circuit", primaryText: "You in?", declaredNames: ["Luke Dean"] }],
    ]);
    const written = await generateCaptions(eventDb(stored) as unknown as ServiceRoleDb, {
      eventId: EVENT,
      artistId: "artist-1",
      style: "lineup",
      n: 3,
      now: new Date("2026-11-06T12:00:00Z"),
    }, { anthropic: client });
    assert.equal(calls.length, 2);
    assert.equal(written.length, 2);
    const second = userText(calls[1]);
    assert.match(second, /Write 6 different lineup/);
    assert.equal(second.includes(normaliseCaption("Luke Dean at Circuit")), true);
    assert.equal(second.includes(normaliseCaption("Stored lineup caption 14")), true);
  });

  it("names only the 20 newest lineup overlays", async () => {
    const { client, calls } = scripted([[
      { overlay: "Luke Dean at Circuit", primaryText: "You in?", declaredNames: ["Luke Dean"] },
    ]]);
    await generateCaptions(eventDb(storedLineups(21)) as unknown as ServiceRoleDb, {
      eventId: EVENT,
      artistId: "artist-1",
      style: "lineup",
      n: 1,
      now: new Date("2026-11-06T12:00:00Z"),
    }, { anthropic: client });
    const listed = userText(calls[0]).split("These are already on the event and must not be repeated or lightly reworded.\n")[1]!.split("\n");
    assert.equal(listed.length, 20);
    assert.equal(listed[0], normaliseCaption("Stored lineup caption 21"));
    assert.equal(listed.includes(normaliseCaption("Stored lineup caption 1")), false);
  });

  it("leaves {artist} out of a lineup prompt when the write has no artist", async () => {
    const without: Record<string, unknown>[] = [];
    await generateCaptions(eventDb() as unknown as ServiceRoleDb, {
      eventId: EVENT,
      style: "lineup",
      n: 1,
      now: new Date("2026-11-06T12:00:00Z"),
    }, {
      anthropic: claude([{ overlay: "Luke Dean at Circuit", primaryText: "You in?", declaredNames: ["Luke Dean"] }], without),
    });
    const bare = `${String(without[0].system)}\n${userText(without[0])}`;
    assert.equal(bare.includes("{artist}"), false);
    assert.match(bare, /\{venue\}/);
    assert.match(bare, /\{lineup\}/);

    const withArtist: Record<string, unknown>[] = [];
    await generateCaptions(eventDb() as unknown as ServiceRoleDb, {
      eventId: EVENT,
      artistId: "artist-1",
      style: "lineup",
      n: 1,
      now: new Date("2026-11-06T12:00:00Z"),
    }, {
      anthropic: claude([{ overlay: "{artist} at {venue}", primaryText: "You in?", declaredNames: ["Luke Dean"] }], withArtist),
    });
    assert.match(String(withArtist[0].system), /\{artist\}/);
  });
});

function userText(call: Record<string, unknown>): string {
  return (call.messages as { content: string }[])[0].content;
}

function storedLineups(count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `stored-${i + 1}`,
    event_id: EVENT,
    style: "lineup",
    caption_no: i + 1,
    text: `Stored lineup caption ${i + 1}`,
    created_at: new Date(Date.UTC(2026, 10, 9, 12, i)).toISOString(),
  }));
}

function scripted(batches: CaptionCandidate[][]): { client: AnthropicLike; calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    client: {
      messages: {
        create: async (args) => {
          calls.push(args);
          if (calls.length > batches.length) throw new Error("second refill");
          const batch = batches[calls.length - 1] ?? [];
          return {
            content: [{
              type: "tool_use",
              name: "submit_captions",
              input: {
                candidates: batch.map((candidate) => ({
                  overlay: candidate.overlay,
                  primary_text: candidate.primaryText,
                  declared_names: candidate.declaredNames,
                })),
              },
            }],
          };
        },
      },
    },
  };
}
