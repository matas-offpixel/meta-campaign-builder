import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadEventFacts } from "../caption-facts.ts";
import {
  addSpotifyToLineup,
  labArtistForLibrary,
  lineupFacts,
  planLineupBackfill,
  P26_BDAY_LINEUP,
  saveLabLineup,
  tagSuggestions,
} from "../lineup.ts";
import type { ServiceRoleDb } from "../load.ts";
import { fakeDb } from "./fake-db.ts";

const USER = "user-1";
const EVENT = "a092aca8-7d9d-4ccd-9eb8-1ada0a62d3d8";
const CLIENT = "92f7334b-ef76-4095-88d6-f422ba1ff3f2";

describe("creative lab lineup", () => {
  it("saves event artists and the facts arrays in billing order", async () => {
    const db = fakeDb({
      artists: [
        { id: "enzo", user_id: USER, name: "Enzo Siragusa" },
        { id: "luke", user_id: USER, name: "Luke Dean" },
        { id: "reeshy", user_id: USER, name: "Reeshy" },
      ],
      event_artists: [{ id: "old", event_id: EVENT, artist_id: "someone-else", billing_order: 1 }],
      creative_lab_event_facts: [{ event_id: EVENT, user_id: USER, lineup: [], headliners: [], allowed_dates: ["2026-10-30"] }],
    });
    const facts = await saveLabLineup(db as unknown as ServiceRoleDb, {
      userId: USER,
      eventId: EVENT,
      slots: [
        { artistId: "enzo", isHeadliner: true },
        { artistId: "luke", isHeadliner: true },
        { artistId: "reeshy", isHeadliner: false },
      ],
    });
    assert.deepEqual(facts, lineupFacts([
      { artistId: "enzo", name: "Enzo Siragusa", isHeadliner: true },
      { artistId: "luke", name: "Luke Dean", isHeadliner: true },
      { artistId: "reeshy", name: "Reeshy", isHeadliner: false },
    ]));
    assert.deepEqual(facts.headliners, ["Enzo Siragusa", "Luke Dean"]);
    const roster = db.tables.event_artists.filter((row) => row.event_id === EVENT);
    assert.deepEqual(roster.map((row) => row.artist_id), ["enzo", "luke", "reeshy"]);
    assert.deepEqual(roster.map((row) => row.billing_order), [1, 2, 3]);
    assert.deepEqual(roster.map((row) => row.is_headliner), [true, true, false]);
    const stored = db.tables.creative_lab_event_facts[0];
    assert.deepEqual(stored?.lineup, facts.lineup);
    assert.deepEqual(stored?.headliners, facts.headliners);
    assert.deepEqual(stored?.allowed_dates, ["2026-10-30"]);
  });

  it("marks an artist who is already on the lineup", () => {
    const suggestions = tagSuggestions({
      query: "",
      library: [
        { id: "enzo", name: "Enzo Siragusa", spotifyId: "spot-enzo", imageUrl: null },
        { id: "luke", name: "Luke Dean", spotifyId: null, imageUrl: null },
      ],
      spotify: [{ spotifyId: "spot-enzo", name: "Enzo Siragusa", imageUrl: null, genres: [], instagramHandle: null, tiktokHandle: null, musicbrainzId: null }],
      onLineupIds: new Set(["enzo"]),
    });
    assert.equal(suggestions.library[0]?.added, true);
    assert.equal(suggestions.library[1]?.added, false);
    assert.equal(suggestions.spotify.length, 0);
  });

  it("creates a library artist from a Spotify pick and adds them to the lineup", async () => {
    const db = fakeDb({ artists: [], event_artists: [], creative_lab_event_facts: [] });
    const result = await addSpotifyToLineup(db as unknown as ServiceRoleDb, {
      userId: USER,
      eventId: EVENT,
      now: new Date("2026-11-06T12:00:00Z"),
      pick: {
        name: "Reeshy",
        spotifyId: "spot-reeshy",
        imageUrl: "https://i.scdn.co/image/reeshy",
        genres: ["tech house"],
        instagramHandle: "reeshy",
        tiktokHandle: null,
        musicbrainzId: null,
        profileJson: { spotify: { id: "spot-reeshy", name: "Reeshy", genres: ["tech house"] } },
      },
    });
    assert.equal(db.tables.artists.length, 1);
    assert.equal(db.tables.artists[0]?.spotify_id, "spot-reeshy");
    assert.equal(db.tables.artists[0]?.id, result.artistId);
    assert.equal(db.tables.event_artists[0]?.artist_id, result.artistId);
    assert.deepEqual(db.tables.creative_lab_event_facts[0]?.lineup, ["Reeshy"]);
    assert.equal(db.tables.creative_lab_artists?.length ?? 0, 0);
  });

  it("keeps one Lab row per client artist and carries the clearance", async () => {
    const db = fakeDb({
      creative_lab_artists: [{
        id: "lab-enzo",
        user_id: USER,
        client_id: CLIENT,
        name: "Enzo Siragusa",
        artist_id: null,
        approved_at: "2026-11-06T11:31:21Z",
        approved_by: USER,
        clip_source: "file",
        played_cities: [],
      }],
    });
    const first = await labArtistForLibrary(db as unknown as ServiceRoleDb, {
      userId: USER,
      clientId: CLIENT,
      libraryArtistId: "lib-enzo",
      name: "Enzo Siragusa",
    });
    const second = await labArtistForLibrary(db as unknown as ServiceRoleDb, {
      userId: USER,
      clientId: CLIENT,
      libraryArtistId: "lib-enzo",
      name: "Enzo Siragusa",
    });
    assert.equal(first, "lab-enzo");
    assert.equal(second, "lab-enzo");
    assert.equal(db.tables.creative_lab_artists.length, 1);
    assert.equal(db.tables.creative_lab_artists[0]?.artist_id, "lib-enzo");
    assert.equal(db.tables.creative_lab_artists[0]?.approved_at, "2026-11-06T11:31:21Z");
  });

  it("reads presale and general sale from the event", async () => {
    const db = fakeDb({
      events: [{
        id: "evt-day",
        name: "Puzzle 4th Birthday",
        event_date: "2026-12-27",
        venue_name: "Circuit",
        venue_city: "Southampton",
        presale_at: "2026-10-30T18:00:00Z",
        general_sale_at: "2026-11-06T10:00:00Z",
      }],
      creative_lab_event_facts: [{ event_id: "evt-day", lineup: ["Luke Dean"], allowed_dates: ["2026-01-01"] }],
      event_ticket_tiers: [],
    });
    const facts = await loadEventFacts(db as unknown as ServiceRoleDb, "evt-day");
    assert.equal(facts.eventDate, "2026-12-27");
    assert.deepEqual(facts.allowedDates, ["2026-10-30", "2026-11-06"]);
  });

  it("plans the Puzzle 4th Birthday backfill without writing", () => {
    const plan = planLineupBackfill({
      eventId: EVENT,
      names: P26_BDAY_LINEUP,
      artists: [],
      labArtists: [
        { id: "7bc3e3fa-b4e2-4b99-bc92-f76f9da04365", name: "Enzo Siragusa" },
        { id: "fe3736d8-4252-4282-bb32-de1e3fdfb359", name: "Luke Dean" },
      ],
    });
    assert.deepEqual(plan.rows.map((row) => row.name), P26_BDAY_LINEUP.map((row) => row.name));
    assert.deepEqual(plan.rows.map((row) => row.isHeadliner), [true, true, true, false, false]);
    assert.deepEqual(plan.rows.map((row) => row.billingOrder), [1, 2, 3, 4, 5]);
    assert.deepEqual(plan.createArtists, P26_BDAY_LINEUP.map((row) => row.name));
    assert.deepEqual(plan.links.map((row) => row.name), ["Enzo Siragusa", "Luke Dean"]);
    assert.equal(plan.rows.every((row) => row.artistId == null), true);
  });
});
