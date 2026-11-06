import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { metaAdName, withCreativeVariationSuffix } from "../../creative-name-from-filename.ts";
import type { ServiceRoleDb } from "../load.ts";
import { AD_NAME_PATTERN, buildAdName, createRound, parseAdName, RoundRefusedError } from "../rounds.ts";
import { fakeDb } from "./fake-db.ts";

const EVENT = { id: "evt-day", client_id: "client-puzzle" };
const CLEARED = {
  id: "artist-luke",
  client_id: "client-puzzle",
  name: "Luke Dean",
  rights_doc_ref: "drive://puzzle/rights/luke-dean-2026-11.pdf",
  approved_at: "2026-11-05T10:00:00Z",
};

function db(artist: Record<string, unknown>) {
  return fakeDb({ events: [EVENT], creative_lab_artists: [artist], creative_lab_rounds: [] });
}

async function refusal(artist: Record<string, unknown>): Promise<string> {
  try {
    await createRound(db(artist) as unknown as ServiceRoleDb, { userId: "op", eventId: "evt-day", artistId: String(artist.id) });
  } catch (err) {
    assert.ok(err instanceof RoundRefusedError);
    return err.code;
  }
  throw new Error("expected a refusal");
}

describe("creative lab rounds: rights gate", () => {
  it("refuses an artist with no written permission stored", async () => {
    assert.equal(await refusal({ ...CLEARED, rights_doc_ref: null, approved_at: null }), "no_rights_doc");
    assert.equal(await refusal({ ...CLEARED, rights_doc_ref: "  " }), "no_rights_doc");
  });

  it("refuses an artist whose permission is stored but not approved", async () => {
    assert.equal(await refusal({ ...CLEARED, approved_at: null }), "not_approved");
  });

  it("refuses an artist cleared for another client", async () => {
    assert.equal(await refusal({ ...CLEARED, client_id: "client-ironworks" }), "artist_client_mismatch");
  });

  it("builds draft rounds numbered per event and artist", async () => {
    const fake = db(CLEARED);
    const first = await createRound(fake as unknown as ServiceRoleDb, { userId: "op", eventId: "evt-day", artistId: "artist-luke" });
    const second = await createRound(fake as unknown as ServiceRoleDb, { userId: "op", eventId: "evt-day", artistId: "artist-luke" });
    assert.deepEqual([first.round_no, first.status, first.channel], [1, "draft", "meta"]);
    assert.equal(second.round_no, 2);
  });
});

describe("creative lab rounds: ad names", () => {
  it("are ASCII <ARTIST>-clip<NN>_cap-<style><N> and survive metaAdName unchanged", () => {
    const name = buildAdName({ artistName: "Luke Dean", clipNo: 1, style: "lineup", captionNo: 1 });
    assert.equal(name, "LUKEDEAN-clip01_cap-lineup1");
    assert.equal(metaAdName(name), name);
    assert.match(name, AD_NAME_PATTERN);
    const accented = buildAdName({ artistName: "Phill de Janeiro", clipNo: 12, style: "social_proof", captionNo: 3 });
    assert.equal(accented, "PHILLDEJANEIRO-clip12_cap-social_proof3");
    assert.deepEqual(parseAdName(accented), { artist: "PHILLDEJANEIRO", clipNo: 12, style: "social_proof", captionNo: 3 });
    assert.deepEqual(parseAdName("LUKEDEAN-clip01_cap-whats_next1"), { artist: "LUKEDEAN", clipNo: 1, style: "whats_next", captionNo: 1 });
    assert.deepEqual(parseAdName("LUKEDEAN-clip02_cap-artist_first_person1"), {
      artist: "LUKEDEAN",
      clipNo: 2,
      style: "artist_first_person",
      captionNo: 1,
    });
  });

  it("a variation suffix would break the pattern, so a Lab creative launches with one variation", () => {
    const name = buildAdName({ artistName: "Luke Dean", clipNo: 1, style: "lineup", captionNo: 1 });
    assert.doesNotMatch(withCreativeVariationSuffix(name, 2), AD_NAME_PATTERN);
  });
});
