import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { fakeDb, op } from "../../launched-ads/__tests__/fake-db.ts";
import { confirmFromHits, spotifyConfirmer, type ArtistHit } from "../copy/artist-confirm.ts";
import { capitalisedRuns, compoundParts, extractArtists, initialsOf, namesInCampaignName, preferredCasing, primarySource, segments, type ExtractionEvent, type ExtractionWorld } from "../copy/artist-extraction.ts";
import { planArtistLibrary, storedCasing, writeArtistPlan, type ArtistPlan } from "../copy/artist-plan.ts";
import { artistExtractionInputs, buildCopyLibrary, type CopySources } from "../copy-performance.ts";
import { fact } from "./fixtures.ts";

const WORLD: ExtractionWorld = {
  venues: ["Electric Studios", "NX Newcastle", "Ironworks", "Skydive Dubai", "Unlocked"],
  cities: ["Sheffield", "Newcastle upon Tyne", "London", "Dubai", "Brighton"],
  clients: ["Electric Brixton", "IRONWORKS", "Deep House Bible", "Puzzle"],
  knownArtists: ["Enzo Siragusa"],
};

/** `n` ads that all ran `text`. */
function ads(id: string, text: string, n = 3): { metaAdId: string; texts: string[] }[] {
  return Array.from({ length: n }, (_, i) => ({ metaAdId: `${id}-${i}`, texts: [text] }));
}

function event(overrides: Partial<ExtractionEvent> = {}): ExtractionEvent {
  return {
    eventId: "e1",
    eventCode: "NX26-MF",
    eventName: "Modern Funktion",
    venueName: "NX Newcastle",
    venueCity: "Newcastle upon Tyne",
    clientName: "Electric Brixton",
    campaignNames: [],
    adSetNames: [],
    ads: [],
    labLineup: [],
    labHeadliners: [],
    linked: [],
    ...overrides,
  };
}

const names = (extraction: ReturnType<typeof extractArtists>) => extraction.candidates.map((c) => c.name);
const reason = (extraction: ReturnType<typeof extractArtists>, name: string) => extraction.rejected.find((r) => r.name === name)?.reason;

describe("artist extraction: ad copy", () => {
  it("a support act before a lineup verb, a list, and a name with a particle", () => {
    const found = extractArtists(
      event({
        ads: [
          ...ads("a", "Saoirse joins our stacked line-up at NX Newcastle for 5 years of Modern Funktion. Tickets on sale now."),
          ...ads("b", "Job de Jong joins our stacked line-up at NX Newcastle for 5 years of Modern Funktion. Tickets on sale 5th August 12PM."),
          ...ads("c", "Modern Funktion make their Newcastle debut. Boss Priester, Jamback, Job de Jong and Saoirse lead the takeover of NX on 16th October."),
        ],
      }),
      WORLD,
    );
    assert.deepEqual(names(found).sort(), ["Boss Priester", "Jamback", "Job de Jong", "Modern Funktion", "Saoirse"]);
    const headliner = found.candidates.find((c) => c.name === "Modern Funktion")!;
    assert.equal(headliner.isHeadliner, true);
    assert.equal(found.candidates.find((c) => c.name === "Saoirse")!.needsConfirmation, true);
    assert.equal(primarySource(found.candidates.find((c) => c.name === "Saoirse")!), "ad_copy");
  });

  it("the venue, the city, the client, a date word and an ad word are not names", () => {
    const found = extractArtists(
      event({
        ads: [
          ...ads("a", "Newcastle! Excited to be back in October for 5 years of Modern Funktion. Final tickets."),
          ...ads("b", "Dan Shake brings the biggest disco night Sheffield has seen in years to Electric Studios. Presale Friday."),
          ...ads("c", "Deep House Bible takes over Skydive Dubai on Saturday, 7 November. Parable presents."),
        ],
      }),
      { ...WORLD, clients: [...WORLD.clients, "Louder / Parable"] },
    );
    assert.equal(reason(found, "Electric Studios"), "venue");
    assert.equal(reason(found, "Skydive Dubai"), "venue");
    assert.equal(reason(found, "Deep House Bible"), "client");
    assert.equal(reason(found, "Parable"), "client");
    assert.ok(!names(found).includes("Newcastle"));
    assert.ok(!names(found).includes("Excited"));
    assert.ok(!names(found).includes("Friday"));
    assert.ok(!names(found).includes("Final"));
    assert.ok(!names(found).includes("Bible"), "a client's last word is not a name on its own");
  });

  it("a capitalised ad word inside a sentence-case name stays; an ALL-CAPS claim before a name does not", () => {
    const found = extractArtists(
      event({
        eventCode: "ES26-FEVER105",
        eventName: "Sheffield Fever 105",
        venueName: "Electric Studios",
        venueCity: "Sheffield",
        ads: [
          ...ads("a", "Catch me back up in Sheffield with Horse Meat Disco, MiNNA, Theon Bower and more."),
          ...ads("b", "Girls Don't Sync take over Electric Studios on Saturday 31st October."),
          ...ads("c", "SOLD OUT Jamie Jones. FINAL TICKETS WILL SELL OUT SOON Jamie Jones"),
          ...ads("d", "Pre-Sale Thursday with Appetite Halloween and Groove Armada."),
          ...ads("e", "DJ EZ returns with Special Request and Mella Dee."),
        ],
      }),
      WORLD,
    );
    assert.ok(names(found).includes("Horse Meat Disco"));
    assert.ok(names(found).includes("MiNNA"));
    assert.ok(names(found).includes("Theon Bower"));
    assert.ok(names(found).includes("Girls Don't Sync"));
    assert.ok(names(found).includes("Jamie Jones"));
    assert.ok(names(found).includes("Groove Armada"));
    assert.ok(names(found).includes("Special Request"));
    assert.ok(names(found).includes("DJ EZ"));
    assert.ok(!names(found).some((name) => /SOLD OUT|SELL OUT|Pre-Sale|Halloween/.test(name)), names(found).join(", "));
  });

  it("b2b splits a run; & more, friends and residents end it", () => {
    const runs = capitalisedRuns("So excited to be back with a world exclusive AZYR b2b Partiboi69 & more, Sweely & Friends and the Puzzle Residents");
    assert.deepEqual(runs.map((run) => run.name), ["AZYR", "Partiboi69", "Sweely", "Puzzle"]);
    assert.deepEqual(compoundParts("Eli & Fur"), ["Eli", "Fur"]);
    assert.deepEqual(compoundParts("Saoirse"), []);
  });

  it("a one-word name needs a list, a lineup verb, a campaign name or the event name; a show title is not an act", () => {
    const found = extractArtists(
      event({
        eventCode: "IRW0001",
        eventName: "Jamie Jones",
        venueName: "Ironworks",
        venueCity: "London",
        clientName: "IRONWORKS",
        ads: [
          ...ads("a", "From the records that shaped my early years, bringing it all together for Voyager.", 8),
          ...ads("b", "Joining Jamie Jones at Ironworks: Seth Troxler, Adam Ten and more.", 4),
          ...ads("c", "Jake is the production manager. Jake built the room.", 4),
        ],
      }),
      WORLD,
    );
    assert.equal(reason(found, "Voyager"), "one word with no list or lineup verb around it");
    assert.equal(reason(found, "Jake"), "one word that only opens a sentence");
    // Rule 3: "with" is not a lineup list, so "A Space With Purpose" never reaches Spotify; "and SUDIK" is one.
    const purpose = extractArtists(
      event({
        eventCode: "IRWOHD",
        eventName: "Brand Awareness (Always-On)",
        venueName: "Ironworks",
        venueCity: "London",
        clientName: "IRONWORKS",
        ads: [...ads("p", "A Space With Purpose\n\nDesigned by a selection of the best in their fields, Ironworks, London is almost ready to open its doors.", 12), ...ads("q", "Super excited to be back with a world exclusive AZYR b2b Partiboi69, with support from Sim0ne and SUDIK.", 40)],
      }),
      WORLD,
    );
    assert.equal(reason(purpose, "Purpose"), "one word with no list or lineup verb around it");
    assert.ok(names(purpose).includes("SUDIK"));
    assert.ok(names(purpose).includes("Sim0ne"));
    assert.ok(names(found).includes("Seth Troxler"));
    assert.ok(names(found).includes("Adam Ten"));
    assert.ok(names(found).includes("Jamie Jones"));
    assert.ok(!names(found).some((name) => name.startsWith("Joining")));
  });

  it("a name the copy only mentions in passing is not on the lineup; a name in a list in few ads is", () => {
    const filler = ads("f", "Join us for our new London headline show at Ironworks on Saturday 24th October.", 100);
    const found = extractArtists(
      event({
        eventCode: "IRW0004",
        eventName: "Camelphat",
        venueName: "Ironworks",
        venueCity: "London",
        clientName: "IRONWORKS",
        ads: [
          ...filler,
          ...ads("a", "Last weekend, Eric Prydz delivered one of the most incredible moments. Next Saturday CamelPhat make their Ironworks debut.", 3),
          ...ads("b", "Full lineup: CamelPhat, Avangart Tabldot, Hardt Antoine and more.", 3),
        ],
      }),
      WORLD,
    );
    assert.equal(reason(found, "Eric Prydz"), "mentioned in passing");
    assert.ok(names(found).includes("Avangart Tabldot"));
    assert.ok(names(found).includes("Hardt Antoine"));
    assert.equal(found.candidates.find((c) => c.name === "CamelPhat")?.isHeadliner, true, "the event's own name, spelled as the copy spells it");
  });

  it("fewer than three ads is not enough unless a campaign name carries the name too", () => {
    const found = extractArtists(
      event({
        campaignNames: ["[NX26-MF] Modern Funktion — Mella Dee - Signups"],
        ads: [...ads("a", "Mella Dee joins the bill.", 1), ...ads("b", "Kitty Hall joins the bill.", 1)],
      }),
      WORLD,
    );
    assert.ok(names(found).includes("Mella Dee"));
    assert.equal(reason(found, "Kitty Hall"), "in 1 ad, fewer than 3");
  });

  it("contractions, URLs, handles, hashtags and a sentence glued by a full stop", () => {
    assert.deepEqual(segments("Sheffield.Tickets on sale. See @camelphatmusic #DHBDubai https://x.y/z"), ["Sheffield", "Tickets on sale", "See"]);
    const runs = capitalisedRuns("I’ve got news: We’ll see D.O.D and Sim0ne");
    assert.deepEqual(runs.map((run) => run.name), ["D.O.D", "Sim0ne"]);
  });

  it("the Lab lineup is always accepted, a library name needs no Spotify, a linked name is skipped", () => {
    const found = extractArtists(
      event({
        labLineup: ["Enzo Siragusa", "Luke Dean", "Benji King"],
        labHeadliners: ["Enzo Siragusa"],
        linked: ["Luke Dean"],
        ads: ads("a", "Enzo Siragusa headlines. Benji King opens."),
      }),
      WORLD,
    );
    assert.deepEqual(found.alreadyLinked, ["Luke Dean"]);
    const enzo = found.candidates.find((c) => c.name === "Enzo Siragusa")!;
    assert.deepEqual(enzo.sources, ["lineup", "ad_copy"]);
    assert.equal(enzo.known, true);
    assert.equal(enzo.isHeadliner, true);
    assert.equal(enzo.needsConfirmation, false);
    assert.equal(primarySource(enzo), "lineup");
    assert.equal(found.candidates.find((c) => c.name === "Benji King")!.needsConfirmation, false);
  });

  it("a short all-caps name is an act only in a lineup list; the event's, client's or venue's initials never are", () => {
    assert.equal(initialsOf("Deep House Bible"), "dhb");
    assert.equal(initialsOf("Charlotte de Witte"), "cdw");
    assert.equal(initialsOf("Camelphat"), null);
    const found = extractArtists(
      event({
        eventCode: "DHB26-DUBAI",
        eventName: "Deep House Bible Dubai",
        venueName: "Skydive Dubai",
        venueCity: "Dubai",
        clientName: "Deep House Bible",
        ads: [...ads("a", "DHB lands in UAE on November 7. Full lineup with SHDW & Obscure Shape, Gawdat and more."), ...ads("b", "UAE here we come. SELL OUT expected. KMRU joins us. We thank IPC for the PA.")],
      }),
      WORLD,
    );
    assert.equal(reason(found, "DHB"), "initials of the event, client or venue");
    // "SHDW & Obscure Shape" is one run; the plan asks Spotify for the pair, then for SHDW and Obscure Shape.
    assert.ok(names(found).includes("SHDW & Obscure Shape"));
    assert.deepEqual(compoundParts("SHDW & Obscure Shape"), ["SHDW", "Obscure Shape"]);
    assert.ok(names(found).includes("Gawdat"));
    assert.ok(names(found).includes("KMRU"), "a short all-caps name before a lineup verb");
    assert.equal(reason(found, "IPC"), "abbreviation with no list or lineup verb around it");
    assert.equal(reason(found, "UAE"), undefined, "a place word never becomes a run");
    assert.ok(!names(found).includes("UAE"));
    assert.ok(!names(found).includes("SELL"));
  });

  it("the copy's mixed-case spelling wins over an all-caps one", () => {
    assert.equal(preferredCasing(new Map([["CAMELPHAT", 9], ["CamelPhat", 2]])), "CamelPhat");
    assert.equal(preferredCasing(new Map([["HAAi", 3], ["Haai", 1]])), "HAAi");
  });

  it("rule 4: the copy's casing is kept when Spotify differs only by case; a shouted name takes Spotify's", () => {
    assert.equal(storedCasing("MiNNA", { name: "Minna" }), "MiNNA");
    assert.equal(storedCasing("Job de Jong", { name: "Job De Jong" }), "Job de Jong");
    assert.equal(storedCasing("sim0ne", { name: "Sim0ne" }), "sim0ne");
    assert.equal(storedCasing("GROOVE ARMADA", { name: "Groove Armada" }), "Groove Armada");
    assert.equal(storedCasing("SHDW", { name: "SHDW" }), "SHDW");
    assert.equal(storedCasing("Saoirse", null), "Saoirse");
  });
});

describe("artist extraction: campaign and ad-set names", () => {
  it("drops the code, the date prefix and the ad-ops words; splits on b2b, +, & and dashes", () => {
    assert.deepEqual(namesInCampaignName("[NX26-AZYR] Azyr b2b PB69 - On Sale"), ["Azyr", "PB69"]);
    assert.deepEqual(namesInCampaignName("261107 Azyr b2b Partiboi69 | [NX26-AZYR] Azyr b2b PB69 - Reach"), ["Azyr", "Partiboi69", "Azyr", "PB69"]);
    assert.deepEqual(namesInCampaignName("Mid Top Funnel - Julian Anthony"), ["Julian Anthony"]);
    assert.deepEqual(namesInCampaignName("[IRW0005] APPETITE — Groove Armad - Signups"), ["APPETITE", "Groove Armad"]);
    assert.deepEqual(namesInCampaignName("Mathame + KASST"), ["Mathame", "KASST"]);
    assert.deepEqual(namesInCampaignName("DJ EZ + more – 1%LL –"), ["DJ EZ"]);
    assert.deepEqual(namesInCampaignName("[IG] Camelphat 1% LL- London 80km - 18-40"), ["Camelphat"]);
    assert.deepEqual(namesInCampaignName("Lineup + Retargeting – 100km"), []);
    assert.deepEqual(namesInCampaignName("[NX26-GLOBAL] Registration - Newcastle"), []);
  });

  it("a Meta interest list is skipped whole", () => {
    assert.deepEqual(namesInCampaignName("Techno (music), House music (music), Deep house — Primary"), []);
    assert.deepEqual(namesInCampaignName("Boiler Room, Glastonbury, Mixmag, Glastonbury Festival, Gala"), []);
  });

  it("a campaign-only name is a candidate that needs Spotify; a single word or an initialism there is not; an ad-set name never makes one", () => {
    const found = extractArtists(
      event({
        eventCode: "IRW0006",
        eventName: "Charlotte de Witte",
        venueName: "Ironworks",
        venueCity: "London",
        clientName: "IRONWORKS",
        campaignNames: ["[IRW0006] CDW — Awareness", "[IRW0006] CHARLOTTE DE WITTE - SIGNUP", "[IRW0006] Adam Ten - Signups", "[IRW0006] Solardo - Signups"],
        adSetNames: ["Paradise Official - EU", "[IG/FB] Jamie Jones & Paradise Lookalikes - London 30km - 18-35", "[IG/FB] LWE - London 30km - 18-45"],
        ads: ads("a", "Charlotte de Witte lands at Ironworks on 1st November."),
      }),
      WORLD,
    );
    const adam = found.candidates.find((c) => c.name === "Adam Ten")!;
    assert.deepEqual(adam.sources, ["campaign_name"]);
    assert.equal(adam.ads, 0);
    assert.equal(adam.needsConfirmation, true);
    assert.equal(reason(found, "CDW"), "initials of the event, client or venue");
    assert.equal(reason(found, "Solardo"), "one word only in a campaign name");
    assert.ok(!names(found).includes("Jamie Jones"), "an audience named after an artist is not the lineup");
    assert.ok(!names(found).includes("Paradise") && reason(found, "Paradise") == null);
    assert.equal(found.candidates.find((c) => c.name === "Charlotte de Witte")?.isHeadliner, true);
  });
});

describe("Spotify confirmation", () => {
  const hit = (name: string, followers: number | null, id = name.toLowerCase()): ArtistHit => ({ id, name, followers, popularity: 10, genres: [], imageUrl: null });

  it("rule 1: an exact name is a yes with no follower test — Spotify sends no follower counts to this app", () => {
    assert.deepEqual(confirmFromHits("Saoirse", [hit("Saoirse", null), hit("Saoirse Ronan", null)]), { kind: "yes", hit: hit("Saoirse", null), exact: [hit("Saoirse", null)] });
    assert.deepEqual(confirmFromHits("saoirse", [hit("Saoirse", 0)]), { kind: "yes", hit: hit("Saoirse", 0), exact: [hit("Saoirse", 0)] });
    assert.deepEqual(confirmFromHits("Groove Armad", [hit("Groove Armada", null)]), { kind: "no", reason: "no exact name" });
    assert.deepEqual(confirmFromHits("", [hit("Saoirse", null)]), { kind: "no", reason: "no exact name" });
  });

  it("rule 2: several exact names confirm the act with no id, and the hits are kept as candidates", () => {
    const several = confirmFromHits("Jamie Jones", [hit("Jamie Jones", null, "a"), hit("Jamie Jones", null, "b"), hit("Jamie Jones Trio", null, "c")]);
    assert.deepEqual(several, { kind: "yes", hit: null, exact: [hit("Jamie Jones", null, "a"), hit("Jamie Jones", null, "b")] });
  });

  it("no credentials → no confirmer; with credentials one token and one search per name, cached", async () => {
    assert.equal(spotifyConfirmer({}), null);
    const calls: string[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      calls.push(url);
      if (url.includes("accounts.spotify.com")) {
        assert.equal(init?.method, "POST");
        return new Response(JSON.stringify({ access_token: "tok" }), { status: 200 });
      }
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer tok");
      return new Response(JSON.stringify({ artists: { items: [{ id: "x1", name: "Saoirse", followers: { total: 42 }, popularity: 30, genres: ["house"], images: [{ url: "u" }] }] } }), { status: 200 });
    }) as typeof fetch;
    const confirm = spotifyConfirmer({ SPOTIFY_CLIENT_ID: "id", SPOTIFY_CLIENT_SECRET: "secret" }, fetchImpl)!;
    const first = await confirm("Saoirse");
    const again = await confirm("saoirse");
    assert.equal(first.kind, "yes");
    assert.equal(again.kind, "yes");
    assert.equal(calls.filter((url) => url.includes("api.spotify.com")).length, 1);
    assert.equal(calls.filter((url) => url.includes("accounts.spotify.com")).length, 1);
    const limited = spotifyConfirmer({ SPOTIFY_CLIENT_ID: "id", SPOTIFY_CLIENT_SECRET: "secret" }, (async (input: string | URL | Request) =>
      String(input).includes("accounts") ? new Response(JSON.stringify({ access_token: "t" })) : new Response("", { status: 429 })) as typeof fetch)!;
    assert.deepEqual(await limited("Anyone"), { kind: "unavailable", reason: "rate limited" });
  });
});

describe("artist plan", () => {
  const SAOIRSE: ArtistHit = { id: "sp-saoirse", name: "Saoirse", followers: 12000, popularity: 40, genres: ["house"], imageUrl: "img" };
  const events = [
    event({
      labLineup: ["Enzo Siragusa", "Luke Dean"],
      labHeadliners: ["Enzo Siragusa"],
      linked: ["Enzo Siragusa"],
      ads: [...ads("a", "Saoirse joins our stacked line-up at NX Newcastle."), ...ads("b", "Eli & Fur join the bill."), ...ads("c", "Boss Priester joins the bill.")],
    }),
  ];
  const existing = [{ id: "art-enzo", name: "Enzo Siragusa", spotify_id: null }, { id: "art-luke", name: "Luke Dean", spotify_id: "sp-luke" }];

  it("lineup and library names link without Spotify; copy names only when Spotify says yes; an unknown X & Y is tried as X and Y", async () => {
    const asked: string[] = [];
    const plan = await planArtistLibrary({
      events,
      world: WORLD,
      existing,
      maxSearches: 10,
      confirm: async (name) => {
        asked.push(name);
        if (name === "Saoirse") return { kind: "yes", hit: SAOIRSE, exact: [SAOIRSE] };
        if (name === "Fur") return { kind: "yes", hit: { ...SAOIRSE, id: "sp-fur", name: "Fur" }, exact: [{ ...SAOIRSE, id: "sp-fur", name: "Fur" }] };
        return { kind: "no", reason: "no exact name" };
      },
    });
    assert.deepEqual(asked, ["Boss Priester", "Eli & Fur", "Eli", "Fur", "Saoirse"]);
    assert.deepEqual(
      plan.links.map((link) => [link.name, link.source, link.via, link.isHeadliner]),
      [
        ["Luke Dean", "lineup", "lineup", false],
        ["Fur", "ad_copy", "spotify", false],
        ["Saoirse", "ad_copy", "spotify", false],
      ],
    );
    assert.deepEqual(plan.events[0]!.alreadyLinked, ["Enzo Siragusa"]);
    assert.deepEqual(plan.events[0]!.spotifyNo.map((row) => row.name), ["Boss Priester"]);
    assert.deepEqual(plan.lineups.get("e1"), ["Enzo Siragusa", "Luke Dean", "Fur", "Saoirse"]);
    assert.deepEqual(
      plan.artists.map((artist) => [artist.name, artist.existingId, artist.spotify?.id ?? null]),
      [["Luke Dean", "art-luke", null], ["Fur", null, "sp-fur"], ["Saoirse", null, "sp-saoirse"]],
    );
    assert.equal(plan.searches, 5);
    // Rule 2 in the plan: several exact names → no id, candidates kept for the Lab.
    const twoJamies = [{ ...SAOIRSE, id: "jj-a", name: "Jamie Jones" }, { ...SAOIRSE, id: "jj-b", name: "Jamie Jones" }];
    const ambiguous = await planArtistLibrary({
      events: [event({ ads: ads("j", "Jamie Jones joins the bill.") })],
      world: WORLD,
      existing: [],
      maxSearches: 10,
      confirm: async () => ({ kind: "yes", hit: null, exact: twoJamies }),
    });
    assert.deepEqual(ambiguous.artists.map((artist) => [artist.name, artist.spotify, artist.candidates.map((hit) => hit.id)]), [["Jamie Jones", null, ["jj-a", "jj-b"]]]);
    assert.deepEqual(ambiguous.links.map((link) => link.via), ["spotify"]);
    assert.equal(plan.counts.confirmed, 2);
    assert.equal(plan.counts.spotifyNo, 1);
  });

  it("no confirmer: copy names stay unconfirmed and are not planned; the search budget caps calls", async () => {
    const plan = await planArtistLibrary({ events, world: WORLD, existing, confirm: null, maxSearches: 10 });
    assert.deepEqual(plan.links.map((link) => link.name), ["Luke Dean"]);
    assert.deepEqual(plan.events[0]!.unconfirmed.map((row) => row.name).sort(), ["Boss Priester", "Eli & Fur", "Saoirse"]);
    assert.equal(plan.spotify, "missing");
    const assumed = await planArtistLibrary({ events, world: WORLD, existing, confirm: null, maxSearches: 10, assumeConfirmed: true });
    assert.deepEqual(assumed.links.map((link) => link.name).sort(), ["Boss Priester", "Eli & Fur", "Luke Dean", "Saoirse"]);
    let calls = 0;
    const capped = await planArtistLibrary({
      events,
      world: WORLD,
      existing,
      maxSearches: 1,
      confirm: async () => {
        calls += 1;
        return { kind: "yes", hit: SAOIRSE, exact: [SAOIRSE] };
      },
    });
    assert.equal(calls, 1);
    assert.equal(capped.counts.unconfirmed, 2);
  });

  it("writes new artists with the Spotify id, sets a missing id on an existing row, never replaces one, and inserts links after the existing billing order", async () => {
    const plan: ArtistPlan = {
      artists: [
        { name: "Saoirse", existingId: null, spotify: SAOIRSE, candidates: [], via: "spotify" },
        { name: "Enzo Siragusa", existingId: "art-enzo", spotify: { ...SAOIRSE, id: "sp-enzo", name: "Enzo Siragusa" }, candidates: [], via: "spotify" },
        { name: "Luke Dean", existingId: "art-luke", spotify: null, candidates: [], via: "lineup" },
        { name: "Jamie Jones", existingId: null, spotify: null, candidates: [{ ...SAOIRSE, id: "jj-a", name: "Jamie Jones" }, { ...SAOIRSE, id: "jj-b", name: "Jamie Jones" }], via: "spotify" },
      ],
      links: [
        { eventId: "e1", name: "Saoirse", source: "ad_copy", isHeadliner: false, via: "spotify", ads: 3 },
        { eventId: "e1", name: "Luke Dean", source: "lineup", isHeadliner: false, via: "lineup", ads: 0 },
        { eventId: "e1", name: "Enzo Siragusa", source: "lineup", isHeadliner: true, via: "spotify", ads: 0 },
        { eventId: "e1", name: "Jamie Jones", source: "ad_copy", isHeadliner: false, via: "spotify", ads: 4 },
      ],
      events: [],
      lineups: new Map(),
      searches: 0,
      counts: { events: 1, candidates: 3, confirmed: 2, known: 0, lineup: 1, assumed: 0, spotifyNo: 0, unconfirmed: 0, rejected: 0 },
      spotify: "configured",
    };
    let inserts = 0;
    const { db, calls } = fakeDb((call) => {
      if (call.table === "artists" && op(call, "insert")) return { data: { id: `art-new-${++inserts}` }, error: null };
      return { error: null };
    });
    const written = await writeArtistPlan(db, plan, {
      userId: "op",
      now: "2026-11-08T03:30:00.000Z",
      existingLinks: [{ event_id: "e1", artist_id: "art-enzo" }],
      existing,
    });
    assert.deepEqual(written, { artistsCreated: 2, spotifyIdsSet: 1, links: 3, skippedLinks: 1 });
    const inserted = calls.filter((c) => c.table === "artists" && op(c, "insert"));
    const row = op(inserted[0]!, "insert")![0] as Record<string, unknown>;
    assert.equal(row.user_id, "op");
    assert.equal(row.name, "Saoirse");
    assert.equal(row.spotify_id, "sp-saoirse");
    assert.deepEqual(row.genres, ["house"]);
    const several = op(inserted[1]!, "insert")![0] as Record<string, unknown>;
    assert.equal(several.name, "Jamie Jones");
    assert.equal("spotify_id" in several, false, "several exact names → spotify_id stays null");
    const profile = several.profile_jsonb as { spotify_lookup: string; spotify_candidates: { spotifyId: string }[] };
    assert.equal(profile.spotify_lookup, "several");
    assert.deepEqual(profile.spotify_candidates.map((c) => c.spotifyId), ["jj-a", "jj-b"]);
    const updated = calls.filter((c) => c.table === "artists" && op(c, "update"));
    assert.equal(updated.length, 1, "Luke Dean already has a Spotify id: no update");
    assert.deepEqual(op(updated[0]!, "eq"), ["id", "art-enzo"]);
    assert.deepEqual(op(updated[0]!, "is"), ["spotify_id", null]);
    const links = calls.find((c) => c.table === "event_artists" && op(c, "insert"))!;
    assert.deepEqual(
      (op(links, "insert")![0] as Record<string, unknown>[]).map((r) => [r.artist_id, r.billing_order, r.source, r.is_headliner]),
      [["art-new-1", 2, "ad_copy", false], ["art-luke", 3, "lineup", false], ["art-new-2", 4, "ad_copy", false]],
    );
    assert.ok(calls.every((c) => !op(c, "delete")), "never deletes a Lab row");
  });
});

describe("artist inputs and the copy library", () => {
  const sources: CopySources = {
    copies: [
      { meta_ad_id: "ad1", bodies: ["Saoirse joins our stacked line-up at NX Newcastle. Tickets on sale now."], titles: [], effective_object_story_id: "111_1", fetched_at: "2026-11-07T02:30:00Z" },
      { meta_ad_id: "ad2", bodies: ["Saoirse joins our stacked line-up at NX Newcastle. Tickets on sale now."], titles: [], effective_object_story_id: "111_2", fetched_at: "2026-10-01T02:30:00Z" },
      { meta_ad_id: "ad3", bodies: ["Saoirse joins our stacked line-up at NX Newcastle. Tickets on sale now."], titles: [], effective_object_story_id: "111_3", fetched_at: "2026-10-01T02:30:00Z" },
      { meta_ad_id: "old", bodies: ["Old copy"], titles: [], effective_object_story_id: null, fetched_at: "2026-09-01T00:00:00Z" },
    ],
    events: [
      { id: "e1", name: "Modern Funktion", event_code: "NX26-MF", event_date: "2026-10-16", venue_name: "NX Newcastle", venue_city: "Newcastle upon Tyne", venue_key: null, status: "live", client_id: "client-a", meta_ad_account_id: null },
      { id: "e2", name: "Other", event_code: "OTHER", event_date: "2026-10-17", venue_name: "NX Newcastle", venue_city: "Newcastle upon Tyne", venue_key: null, status: "live", client_id: "client-a", meta_ad_account_id: null },
    ],
    artists: [],
    memberships: [],
    labFacts: [],
    clientPages: [{ id: "client-a", default_page_ids: ["111"], meta_ad_account_id: "act_111" }],
    draftPages: [],
  };
  const clients = [{ id: "client-a", name: "Client A", vertical: "music", userId: "op" }];
  const facts = ["ad1", "ad2", "ad3"].map((id) =>
    fact({ meta_ad_id: id, campaign_name: "[NX26-MF] Modern Funktion - Signup", adset_name: "Lineup - Adv+", spend: 10, registrations: 2 }, { clientId: "client-a", eventId: "e1", stage: "registration" }),
  );
  facts.push(fact({ meta_ad_id: "old", campaign_name: "[OTHER] x", spend: 10, registrations: 2 }, { clientId: "client-a", eventId: "e2", stage: "registration" }));

  it("one event per placed ad with copy, with campaign and ad-set names; `since` keeps only events with fresh copy", () => {
    const all = artistExtractionInputs(sources, facts, clients, new Set());
    assert.deepEqual(all.events.map((e) => [e.eventCode, e.ads.length, e.campaignNames, e.adSetNames]), [
      ["NX26-MF", 3, ["[NX26-MF] Modern Funktion - Signup"], ["Lineup - Adv+"]],
      ["OTHER", 1, ["[OTHER] x"], []],
    ]);
    assert.deepEqual(all.world.clients, ["Client A"]);
    const fresh = artistExtractionInputs(sources, facts, clients, new Set(), { since: "2026-11-01T00:00:00Z" });
    assert.deepEqual(fresh.events.map((e) => e.eventCode), ["NX26-MF"]);
    const archived = artistExtractionInputs(sources, facts, clients, new Set(["client-a"]));
    assert.equal(archived.events.length, 0);
    assert.deepEqual(artistExtractionInputs(sources, facts, clients, new Set(), { eventCodes: ["other"] }).events.map((e) => e.eventCode), ["OTHER"]);
  });

  it("extra lineups slot the name as {artist} before anything is written", () => {
    const before = buildCopyLibrary(sources, facts, clients);
    const after = buildCopyLibrary(sources, facts, clients, { extraLineups: new Map([["e1", ["Saoirse"]]]) });
    const key = (library: ReturnType<typeof buildCopyLibrary>) => library.ads.find((ad) => ad.metaAdId === "ad1")!.lines[0]!.key;
    assert.match(key(before), /^saoirse joins/);
    assert.match(key(after), /^\{artist\} joins/);
  });

  it("the runner job reads adset_name and the migration adds a checked source column", () => {
    assert.match(readFileSync("lib/learning/joins.ts", "utf8"), /ad_name, adset_name, campaign_name/);
    const migration = readFileSync("supabase/migrations/212_event_artists_source.sql", "utf8");
    assert.match(migration, /add column if not exists source text not null default 'lab'/);
    assert.match(migration, /check \(source in \('lab', 'lineup', 'ad_copy', 'campaign_name'\)\)/);
    const runner = readFileSync("lib/learning/runner.ts", "utf8");
    assert.ok(runner.indexOf('job("artist_library"') < runner.indexOf('job("copy_performance"'), "names are linked before the templates are scored");
    assert.match(runner, /extraLineups: artistPlan\?\.lineups/);
  });
});
