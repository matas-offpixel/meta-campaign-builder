import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { saveLabArtist } from "../card-write.ts";
import type { ServiceRoleDb } from "../load.ts";
import { fakeDb } from "./fake-db.ts";

const USER = "op";
const CLIENT = "client-1";

function artist() {
  return fakeDb({
    creative_lab_artists: [
      {
        id: "artist-1",
        user_id: USER,
        client_id: CLIENT,
        name: "Enzo Siragusa",
        rights_doc_ref: "rights",
        starting_caption: "Back in Southampton on 27th December to close out the year w/ Puzzle.",
        meta_page_id: "page-enzo",
        instagram_actor_id: "ig-enzo",
        played_cities: [],
      },
    ],
  });
}

describe("saveLabArtist", () => {
  it("keeps instagram_actor_id when the Page is unchanged", async () => {
    const fake = artist();
    await saveLabArtist(fake as unknown as ServiceRoleDb, {
      userId: USER,
      clientId: CLIENT,
      artistId: "artist-1",
      name: "Enzo Siragusa",
      rightsDocRef: "rights",
      startingCaption: "",
      metaPageId: "page-enzo",
      instagramActorId: null,
      playedCities: ["Southampton", " Bristol "],
    });
    const row = fake.tables.creative_lab_artists[0];
    assert.equal(row.instagram_actor_id, "ig-enzo");
    assert.equal(row.meta_page_id, "page-enzo");
    assert.deepEqual(row.played_cities, ["Southampton", "Bristol"]);
  });

  it("replaces instagram_actor_id when a different Page is chosen", async () => {
    const fake = artist();
    await saveLabArtist(fake as unknown as ServiceRoleDb, {
      userId: USER,
      clientId: CLIENT,
      artistId: "artist-1",
      name: "Enzo Siragusa",
      rightsDocRef: "rights",
      startingCaption: "",
      metaPageId: "page-other",
      instagramActorId: "",
    });
    assert.equal(fake.tables.creative_lab_artists[0].instagram_actor_id, null);
  });
});
