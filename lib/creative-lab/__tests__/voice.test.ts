import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { ServiceRoleDb } from "../load.ts";
import { saveVoiceSamples, voicePageRef } from "../voice-store.ts";
import { PUZZLE_SAMPLES, PUZZLE_VENUES, SIGN_OFF } from "../voice-fixtures.ts";
import {
  appendVoice,
  copiesVoice,
  extractTraits,
  fallbackSentence,
  hasSixWordRun,
  shapeLine,
  signOffLines,
  traitRows,
  traitsReady,
  voiceChipLabel,
  voicePromptBlock,
  VOICE_FLOOR,
} from "../voice-traits.ts";
import { generateCaptions, systemPrompt, type AnthropicLike } from "../writer.ts";
import { fakeDb } from "./fake-db.ts";

const drawn = JSON.parse(readFileSync(new URL("../../../docs/creative-lab/fixtures/voice-puzzle.json", import.meta.url), "utf8")) as {
  samples: { caption: string }[];
  venueNames: string[];
};

describe("voice traits", () => {
  const traits = extractTraits(PUZZLE_SAMPLES, PUZZLE_VENUES);

  it("matches the fixture file and the sheet's counts", () => {
    assert.equal(drawn.samples.length, 24);
    assert.equal(PUZZLE_SAMPLES.length, 24);
    assert.equal(traits.sampleN, 24);
    assert.equal(traits.emoji.count, 19);
    assert.equal(traits.emoji.set.slice(0, 3).join(" "), "🖤 🔥 👀");
    assert.equal(traits.emoji.position, "trail");
    assert.equal(traits.signOffs[0]?.line, SIGN_OFF);
    assert.equal(traits.signOffs[0]?.count, 9);
    assert.equal(traits.venue.find((row) => row.form === "Circuit")?.count, 11);
    assert.equal(traits.venue.find((row) => row.form === "Circuit Southampton")?.count, 0);
    assert.equal(traits.hashtags.posts, 3);
    assert.equal(traits.hashtags.position, "trailing");
    assert.equal(traits.punctuation.emDash, 0);
    assert.equal(traits.punctuation.exclamation, 2);
    assert.equal(traits.lineup.count, 8);
    assert.equal(traits.lineup.separator, "own lines");
    assert.equal(traits.mentions.posts, 14);
    assert.equal(traits.sentences.medianWords, 7);
    assert.equal(traits.caseHabit.habit, "sentence");
    const fileTraits = extractTraits(drawn.samples, drawn.venueNames);
    assert.equal(fileTraits.emoji.count, 19);
    assert.equal(fileTraits.signOffs[0]?.count, 9);
  });

  it("finds a sign-off at 3 and not at 2", () => {
    const line = "See you on the floor";
    assert.equal(signOffLines([{ caption: `A.\n${line}` }, { caption: `B.\n${line}` }]).length, 0);
    assert.equal(signOffLines([{ caption: `A.\n${line}` }, { caption: `B.\n${line}` }, { caption: `C.\n${line}` }])[0]?.count, 3);
  });

  it("does not compute a voice block under the floor of 8", () => {
    assert.equal(traitsReady(7), false);
    assert.equal(traitsReady(VOICE_FLOOR), true);
    assert.equal(voicePromptBlock({ handle: "puzzle", pageKind: "promoter", samples: PUZZLE_SAMPLES.slice(0, 7), traits, hashtagsEnabled: false }), null);
    const block = voicePromptBlock({ handle: "puzzle", pageKind: "promoter", samples: PUZZLE_SAMPLES, traits, hashtagsEnabled: false, shape: shapeLine({ feature: "opener", value: "question" }, "lineup") });
    assert.ok(block);
    assert.match(block ?? "", /Puzzle turns 4/);
    assert.match(block ?? "", /Shape: opener is question/);
    assert.match(block ?? "", /do not write either/);
    const on = voicePromptBlock({ handle: "puzzle", pageKind: "promoter", samples: PUZZLE_SAMPLES, traits, hashtagsEnabled: true });
    assert.match(on ?? "", /Hashtags may close the primary text only/);
    assert.equal(voiceChipLabel({ handle: "reeshy", sampleN: 2, error: null }), "Not enough posts yet · 2 of 8");
    assert.equal(voiceChipLabel({ handle: null, sampleN: 0, error: null }), "No posts read yet — Read posts");
  });

  it("drops six consecutive words and keeps a sign-off that closes the primary text", () => {
    const sample = "the room opens early for the ones who already know this well tonight";
    assert.equal(hasSixWordRun("The room opens early for the ones tonight", sample), true);
    assert.equal(hasSixWordRun("Come through if you can", sample), false);
    const sign = "see you down on the floor tonight";
    assert.equal(copiesVoice("Come through", `Doors at ten. ${sign}`, [sample, sign], sign), false);
    assert.equal(copiesVoice(`Come through ${sign}`, "Doors at ten", [sign], sign), true);
    assert.equal(copiesVoice("Come through", `${sign} and then another line`, [sign], sign), true);
  });

  it("routes promoter and artist exemplars apart and falls back to the seed", () => {
    assert.deepEqual(voicePageRef("lineup", "client-1", "artist-1"), { pageKind: "promoter", pageRef: "client-1" });
    assert.deepEqual(voicePageRef("artist_first_person", "client-1", "artist-1"), { pageKind: "artist", pageRef: "artist-1" });
    assert.equal(voicePageRef("artist_first_person", "client-1", null), null);
    assert.match(fallbackSentence("empty"), /house voice/);
    assert.match(shapeLine({ feature: "opener", value: "question" }, "lineup"), /Shape: opener is question/);
    assert.match(shapeLine(null, "lineup"), /seed examples/);
    const rows = traitRows(traits, "wide");
    assert.equal(rows.find((row) => row.label === "Hashtags")?.off, true);
    assert.equal(rows.find((row) => row.label === "Emoji")?.evidence, "19 of 24");
  });
});

describe("voice store and writer", () => {
  it("stores captions only and leaves the prompt unchanged under 8", async () => {
    const fake = fakeDb({ clients: [{ id: "client-puzzle", instagram_handle: "puzzle", voice_hashtags_enabled: false }] });
    const saved = await saveVoiceSamples(fake as unknown as ServiceRoleDb, {
      userId: "op",
      pageKind: "promoter",
      pageRef: "client-puzzle",
      now: new Date("2026-11-08T09:12:00Z"),
      posts: [
        { id: "one", permalink: "https://www.instagram.com/p/one/", caption: "Hello room", postedAt: "2026-11-01T00:00:00Z", likes: 1, comments: 0 },
        { id: "blank", permalink: null, caption: "  ", postedAt: "2026-11-02T00:00:00Z", likes: 0, comments: 0 },
      ],
    });
    assert.equal(saved.traits, null);
    assert.equal(fake.tables.voice_samples.length, 1);
    assert.equal("media_url" in fake.tables.voice_samples[0], false);
    const plain = systemPrompt("lineup", { eventName: "Night", lineup: [], headliners: ["Ada"], allowedDates: [] }, [], "on_sale", []);
    assert.equal(appendVoice(plain, null), plain);
  });

  it("puts the promoter exemplars in the prompt, states the shape, and refuses a hashtag while the switch is off", async () => {
    const captions = PUZZLE_SAMPLES.map((sample, index) => ({
      page_kind: "artist",
      page_ref: "artist-1",
      caption: sample.caption,
      posted_at: sample.postedAt,
      ig_media_id: `m${index}`,
    }));
    const fake = fakeDb({
      events: [{ id: "evt-day", client_id: "client-puzzle", user_id: "op", name: "Puzzle", event_date: "2026-12-27", venue_name: "Circuit", venue_city: "Southampton", status: "on_sale" }],
      creative_lab_event_facts: [{ event_id: "evt-day", lineup: ["Luke Dean"], headliners: ["Luke Dean"], allowed_dates: ["2026-12-27"] }],
      event_ticket_tiers: [],
      creative_lab_artists: [{ id: "artist-1", name: "Luke Dean", ig_username: "lukedean" }],
      creative_lab_captions: [],
      creative_lab_clips: [],
      clients: [{ id: "client-puzzle", instagram_handle: "puzzle", voice_hashtags_enabled: false }],
      voice_samples: captions.map((row) => ({ ...row, page_kind: "promoter", page_ref: "client-puzzle" })),
      events_venues: [],
    });
    const calls: Record<string, unknown>[] = [];
    const rejected: string[] = [];
    const anthropic: AnthropicLike = {
      messages: {
        create: async (args) => {
          calls.push(args);
          return {
            content: [{
              type: "tool_use",
              name: "submit_captions",
              input: {
                candidates: [
                  { overlay: "{artist} at {venue}", primary_text: "Puzzle turns 4. Lineup drops Monday and more", declared_names: ["Luke Dean"] },
                  { overlay: "{artist} at {venue}", primary_text: "Come through #puzzle", declared_names: ["Luke Dean"] },
                  { overlay: "{artist} at {venue}", primary_text: "You in?", declared_names: ["Luke Dean"] },
                ],
              },
            }],
          };
        },
      },
    };
    const written = await generateCaptions(fake as unknown as ServiceRoleDb, {
      eventId: "evt-day",
      artistId: "artist-1",
      style: "lineup",
      n: 1,
      now: new Date("2026-11-08T09:12:00Z"),
    }, {
      anthropic,
      loadShape: async () => ({ feature: "opener", value: "question" }),
      onReject: (_overlay, _primary, errors) => rejected.push(errors.map((error) => error.code).join(",")),
    });
    const system = String(calls[0]?.system ?? "");
    assert.match(system, /VOICE — @puzzle \(promoter\)/);
    assert.match(system, /Shape: opener is question/);
    assert.doesNotMatch(system, /VOICE — @lukedean \(artist\)/);
    assert.ok(rejected.includes("voice_copy"));
    assert.ok(rejected.includes("voice_hashtag"));
    assert.equal(written.length, 1);
    assert.match(written[0]?.shapeNote ?? "", /Shape: opener is question/);
  });
});
