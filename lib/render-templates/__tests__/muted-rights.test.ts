/**
 * The muted cards (roll-call, top tracks, artist card) offer only material
 * this show can use: the same rule as the montage's picks and get_artist
 * (usableOn: shareable, or the show's client's own). Name, date and venue
 * are the event's own, never the client's name.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { fakeDb } from "../../mcp/__tests__/fake-db.ts";
import { loadPackageState } from "../load.ts";
import { mutedInputs, recipeCards, type CardMaterial } from "../package-view.ts";
import { ELECTRIC, ENZO, EVENT, NOW, PUZZLE, TODAY, fakeStartDeps, fixtureTables } from "./fixtures.ts";

const MATERIALS: CardMaterial[] = [
  { kind: "press_shot", name: "Enzo Siragusa.jpg", shareable: true, clientId: null },
  { kind: "story_artwork", name: "PUZZLE BIRTHDAY 1 STORY", shareable: false, clientId: PUZZLE },
  { kind: "raw_clip", name: "Puzzle crowd 3.mp4", shareable: false, clientId: PUZZLE },
];

test("a Puzzle-owned story artwork and crowd clip are refused for an Electric Brixton show, offered for Puzzle's own", () => {
  const event = { date: "2027-02-19", venueName: "Electric Studios", venueCity: "Sheffield" };
  const electric = mutedInputs({ eventClientId: ELECTRIC, lead: "Enzo Siragusa", materials: MATERIALS, tracks: 0, snippets: 0, event });
  assert.equal(electric.artwork, null);
  assert.equal(electric.rawClip, null);
  assert.equal(electric.pressShot, "Enzo Siragusa.jpg", "shareable material travels");
  const puzzle = mutedInputs({ eventClientId: PUZZLE, lead: "Enzo Siragusa", materials: MATERIALS, tracks: 0, snippets: 0, event });
  assert.equal(puzzle.artwork, "PUZZLE BIRTHDAY 1 STORY");
  assert.equal(puzzle.rawClip, "Puzzle crowd 3.mp4");
});

test("the artist card's name, date and venue come from the event: venue and city, never the client's name", () => {
  const m = mutedInputs({ eventClientId: ELECTRIC, lead: "Enzo Siragusa", materials: [], tracks: 0, snippets: 0, event: { date: "2027-02-19", venueName: "Electric Studios", venueCity: "Sheffield" } });
  assert.equal(m.details, "Enzo Siragusa · Fri 19 Feb · Electric Studios, Sheffield");
  assert.doesNotMatch(m.details!, /Electric Brixton/);
});

test("through the loader: an Electric show's cards refuse Puzzle's held artwork from the library, and read the event's venue", async () => {
  const tables = fixtureTables();
  const ev = tables.events![0]!;
  Object.assign(ev, { client_id: ELECTRIC, event_code: "ES27-ENZOSIRAGUSA", venue_name: "Electric Studios", venue_city: "Sheffield", event_date: "2027-02-19", status: "announced", general_sale_at: null, presale_at: null });
  tables.artist_assets = [
    { id: "a1", artist_id: ENZO, kind: "static", name: "PUZZLE BIRTHDAY 1 STORY", shareable: false, source_client_id: PUZZLE },
    { id: "a2", artist_id: ENZO, kind: "static", name: "Enzo Siragusa.jpg", shareable: true, source_client_id: null },
  ];
  const loaded = (await loadPackageState(fakeDb(tables), EVENT, fakeStartDeps(false), NOW, TODAY))!;
  assert.equal(loaded.muted.artwork, null);
  assert.equal(loaded.muted.pressShot, "Enzo Siragusa.jpg");
  assert.equal(loaded.muted.details, "Enzo Siragusa · Fri 19 Feb · Electric Studios, Sheffield");
  // Puzzle's crowd footage isn't a raw clip for this show either.
  assert.ok(!String(loaded.muted.rawClip ?? "").startsWith("puzzle-"));
  const cards = recipeCards(loaded.state, loaded.muted);
  const top = cards.find((c) => c.recipe === "top-tracks")!;
  assert.equal(top.needs.find((n) => n.key === "artwork")!.state, "missing");
  assert.ok(!JSON.stringify(cards).includes("PUZZLE BIRTHDAY"));
});
