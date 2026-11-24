import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  applyLaunchCheckFix,
  blockedLaunchLabel,
  checkArtistCaptions,
  checkLaunchReferences,
  countLine,
  draftIdentities,
  keepLink,
  keptLinkLines,
  listNames,
  renderArtistCaptionCheck,
} from "../check.ts";
import { identityOwnershipFrom } from "../load.ts";
import { textHasTerm } from "../references.ts";
import type { GuardEvent } from "../types.ts";
import { venueDefaultsFromMap } from "../venue-defaults.ts";
import {
  EBR27_GLITTERBOX,
  ES27_DAVEPEARCE,
  NX27_GLITTERBOX,
  NX27_PAULVANDYK,
  creative,
  electricEvent,
  glitterboxNxDraft,
  othersThan,
} from "./fixtures.ts";

function run(draft: ReturnType<typeof glitterboxNxDraft>, event: GuardEvent, others = othersThan(event)) {
  return checkLaunchReferences(draft, event, venueDefaultsFromMap(event), others);
}

function daveDraft(pixel = "1987031252241238") {
  const draft = glitterboxNxDraft();
  return {
    ...draft,
    settings: {
      ...draft.settings,
      eventId: ES27_DAVEPEARCE.id,
      campaignCode: "ES27-DAVEPEARCE",
      campaignName: "[ES27-DAVEPEARCE] On Sale",
      metaAdAccountId: "act_1073273492854557",
      adAccountId: "act_1073273492854557",
      metaPixelId: pixel,
    },
    creatives: draft.creatives.map((c) => ({
      ...c,
      destinationUrl: "https://crqln.com/l/davepearce-sheffield",
      headline: "Dave Pearce · Electric Studios",
      captions: [{ id: `${c.id}-c`, text: "Dave Pearce brings Trance Anthems to Sheffield." }],
    })),
  };
}

describe("checkLaunchReferences", () => {
  it("a clean copy finds nothing", () => {
    const result = run(glitterboxNxDraft(), NX27_GLITTERBOX);
    assert.deepEqual(result.checks, []);
    assert.equal(result.blockers, 0);
    assert.deepEqual(countLine(result), ["● Nothing to fix"]);
    assert.equal(blockedLaunchLabel(result.blockers), null);
  });

  it("Glitterbox: the NX event with the Bristol account and pixel → 2 blockers", () => {
    const draft = glitterboxNxDraft();
    draft.settings.metaAdAccountId = "act_2011069725849568";
    draft.settings.adAccountId = "act_2011069725849568";
    draft.settings.metaPixelId = "800268622344093";
    const result = run(draft, NX27_GLITTERBOX);
    assert.deepEqual(
      result.checks.map((check) => check.key),
      ["pixel_not_venue", "account_not_venue"],
    );
    const [pixel, account] = result.checks;
    assert.equal(pixel!.sentence, "Pixel …4093 is Electric Bristol’s. NX27-GLITTERBOX is at NX Newcastle (…2763).");
    assert.equal(pixel!.evidence, "Ad sets: all 3");
    assert.deepEqual(pixel!.fixes, [{ action: "set_pixel", label: "Use …2763", pixelId: "645185673672763" }]);
    assert.deepEqual(pixel!.findings, [{ field: "pixel", adName: null, value: "800268622344093" }]);
    assert.equal(
      account!.sentence,
      "Account Electric Bristol Live (Electric Bristol) isn’t NX Newcastle’s. NX27-GLITTERBOX runs on NX Promoter (NX Newcastle).",
    );
    assert.equal(account!.evidence, "Campaign: [NX27-GLITTERBOX] SIGNUP");
    assert.equal(account!.fixes[0]!.label, "Use NX Promoter");
    assert.equal(result.blockers, 2);
    assert.equal(blockedLaunchLabel(result.blockers), "Launch · 2 to fix");
    assert.deepEqual(countLine(result), ["● 2 to fix before launch"]);
  });

  it("the fixes clear the Glitterbox blockers", () => {
    const draft = glitterboxNxDraft();
    draft.settings.metaAdAccountId = "act_2011069725849568";
    draft.settings.metaPixelId = "800268622344093";
    let fixed = draft;
    for (const check of run(draft, NX27_GLITTERBOX).checks) {
      fixed = applyLaunchCheckFix(fixed, check.fixes[0]!, { keptBy: "matas", now: new Date() });
    }
    assert.deepEqual(run(fixed, NX27_GLITTERBOX).checks, []);
  });

  it("Dave Pearce with the PVD URL → other_show_reference, and no second link warning (RC-C)", () => {
    const draft = daveDraft();
    draft.creatives = ["Static 1", "Static 2", "Video 1", "Video 2", "Lineup Adv+", "Carousel"].map((name) =>
      creative({ name, destinationUrl: "https://www.paulvandyk-newcastle.com/", headline: "Trance Anthems" }),
    );
    const result = run(draft, ES27_DAVEPEARCE);
    const other = result.checks.find((check) => check.key === "other_show_reference");
    assert.ok(other, "expected other_show_reference");
    assert.equal(other!.severity, "blocker");
    assert.equal(other!.sentence, "Still points to Paul van Dyk: paulvandyk-newcastle.com in 6 ads.");
    assert.equal(other!.evidence, "Links in: Static 1, Static 2, Video 1, Video 2 … and 2 more");
    assert.equal(other!.fixes[0]!.label, "Show the 6 ads");
    assert.equal(other!.findings.length, 6);
    assert.deepEqual(other!.findings[0], {
      field: "link",
      adName: "Static 1",
      value: "paulvandyk-newcastle.com",
      source: "https://www.paulvandyk-newcastle.com/",
    });
    // The link is already a blocker as another show's: no link warning on top.
    assert.deepEqual(result.checks.map((check) => check.key), ["other_show_reference"]);
    // Pointing the ads at the event's page clears it.
    const fixed = {
      ...draft,
      creatives: draft.creatives.map((c) => ({ ...c, destinationUrl: "https://crqln.com/l/davepearce-sheffield" })),
    };
    assert.deepEqual(run(fixed, ES27_DAVEPEARCE).checks, []);
  });

  it("one hit uses the .one sentence", () => {
    const draft = glitterboxNxDraft();
    draft.creatives[0]!.headline = "As seen at Electric Bristol";
    const result = run(draft, NX27_GLITTERBOX);
    assert.equal(result.checks.length, 1);
    assert.equal(result.checks[0]!.sentence, "Still points to EBR27-GLITTERBOX: Electric Bristol in 1 headline.");
    assert.equal(result.checks[0]!.evidence, "Headlines in: Static 1");
    assert.equal(result.checks[0]!.fixes[0]!.label, "Show the headline");
  });

  it("an artist who plays two shows is never a hit", () => {
    // Glitterbox plays NX and Bristol; Dave Pearce also plays the PVD show.
    const pvdWithDave = { ...NX27_PAULVANDYK, artists: ["Paul van Dyk", "Dave Pearce"] };
    const others = [NX27_GLITTERBOX, EBR27_GLITTERBOX, pvdWithDave];
    assert.deepEqual(run(glitterboxNxDraft(), NX27_GLITTERBOX).checks, []);
    assert.deepEqual(run(daveDraft(), ES27_DAVEPEARCE, others).checks, []);
  });

  it("a name under 4 characters is never a term", () => {
    const djez = electricEvent({ id: "e9f7", code: "NX26-DJEZ", name: "DJ EZ", artists: ["EZ", "DJ EZ"], venueKey: "nx newcastle" });
    const draft = glitterboxNxDraft();
    draft.creatives[0]!.captions = [{ id: "x", text: "EZ does it. Glitterbox at NX Newcastle." }];
    assert.deepEqual(run(draft, NX27_GLITTERBOX, [djez]).checks, []);
  });

  it("an event-level pixel override (Sheffield Skiddle) is not a hit", () => {
    assert.deepEqual(run(daveDraft("1987031252241238"), ES27_DAVEPEARCE).checks, []);
    // The venue's pixel on that show is the hit, in the override's words.
    const venuePixel = run(daveDraft("2261755947685271"), ES27_DAVEPEARCE);
    assert.deepEqual(venuePixel.checks.map((check) => check.key), ["pixel_not_venue"]);
    assert.equal(venuePixel.checks[0]!.sentence, "Pixel …5271 isn’t the one set for ES27-DAVEPEARCE (…1238).");
    assert.equal(venuePixel.checks[0]!.fixes[0]!.label, "Use …1238");
  });

  it("a campaign name under another show's code → name_code_mismatch", () => {
    const draft = glitterboxNxDraft();
    draft.settings.campaignName = "[EBR27-GLITTERBOX] SIGNUP";
    const result = run(draft, NX27_GLITTERBOX);
    const name = result.checks.find((check) => check.key === "name_code_mismatch");
    assert.ok(name);
    assert.equal(name!.sentence, "The campaign name says EBR27-GLITTERBOX. This event is NX27-GLITTERBOX.");
    assert.equal(name!.evidence, "[EBR27-GLITTERBOX] SIGNUP");
    assert.equal(name!.fixes[0]!.label, "Rename to [NX27-GLITTERBOX] SIGNUP");
    // The ad set and other names don't carry the code, so this is the only check:
    // the code as a word in the campaign name is the name check's, not another show's.
    assert.deepEqual(result.checks.map((check) => check.key), ["name_code_mismatch"]);
    const fixed = applyLaunchCheckFix(draft, name!.fixes[0]!, { keptBy: "m", now: new Date() });
    assert.deepEqual(run(fixed, NX27_GLITTERBOX).checks, []);
  });

  it("Keep this link: kept → no warning; the link changed after → warning again", () => {
    const draft = glitterboxNxDraft();
    draft.creatives = draft.creatives.map((c) => ({ ...c, destinationUrl: "https://www.skiddle.com/e/41877" }));
    const before = run(draft, NX27_GLITTERBOX);
    assert.deepEqual(before.checks.map((check) => check.key), ["link_not_event"]);
    assert.equal(before.blockers, 0);
    assert.deepEqual(countLine(before), ["● 1 to check"]);
    assert.equal(blockedLaunchLabel(before.blockers), null);

    const now = new Date("2026-11-24T16:40:00Z");
    const kept = applyLaunchCheckFix(draft, before.checks[0]!.fixes[1]!, { keptBy: "matas@offpixel", now });
    assert.deepEqual(kept.settings.launchGuard?.keptLinks, [
      { url: "https://www.skiddle.com/e/41877", keptBy: "matas@offpixel", keptAt: "2026-11-24T16:40:00.000Z" },
    ]);
    assert.deepEqual(run(kept, NX27_GLITTERBOX).checks, []);
    // The muted line under the list: who, when (London), which link.
    assert.deepEqual(keptLinkLines(kept), [
      tsvWord("link_not_event.kept")
        .replace("{name}", "matas@offpixel")
        .replace("{date, time}", "Tue 24 Nov, 16:40")
        .replace("{url}", "skiddle.com/e/41877"),
    ]);

    const changed = {
      ...kept,
      creatives: kept.creatives.map((c) => ({ ...c, destinationUrl: "https://www.skiddle.com/e/99999" })),
    };
    const after = run(changed, NX27_GLITTERBOX);
    assert.deepEqual(after.checks.map((check) => check.key), ["link_not_event"]);
    assert.match(after.checks[0]!.sentence, /skiddle\.com\/e\/99999 in 3 ads/);
    // No ad uses the kept link any more, so its line goes too.
    assert.deepEqual(keptLinkLines(changed), []);
  });

  it("keeping twice replaces the entry for that link", () => {
    const draft = keepLink(glitterboxNxDraft(), "https://x.com/a", "a", new Date(0));
    const again = keepLink(draft, "https://www.x.com/a/", "b", new Date(1000));
    assert.equal(again.settings.launchGuard?.keptLinks?.length, 1);
    assert.equal(again.settings.launchGuard?.keptLinks?.[0]!.keptBy, "b");
  });

  it("the ticket link and the crqln.com page are this event's page", () => {
    const draft = daveDraft();
    draft.creatives[0]!.destinationUrl = ES27_DAVEPEARCE.ticketUrl!;
    assert.deepEqual(run(draft, ES27_DAVEPEARCE).checks, []);
  });

  it("the artist-caption check is a stub until R8b", () => {
    assert.deepEqual(checkArtistCaptions(glitterboxNxDraft(), NX27_GLITTERBOX), []);
  });

  it("a draft with no event has nothing to check", () => {
    const result = checkLaunchReferences(glitterboxNxDraft(), null, venueDefaultsFromMap(NX27_GLITTERBOX), []);
    assert.equal(result.checks.length, 0);
  });

  it("a client with no venue values falls back to the event's own account", () => {
    const other = electricEvent({ id: "p26", code: "P26-BDAY", name: "Puzzle 4th Birthday", clientId: "puzzle", metaAdAccountId: "1058599195559790" });
    const draft = glitterboxNxDraft();
    draft.settings.eventId = "p26";
    draft.settings.campaignName = "[P26-BDAY] SIGNUP";
    const result = run(draft, other, []);
    // No venue values: the pixel can't be checked, so the venue warning shows too (ruling 4).
    assert.deepEqual(result.checks.map((check) => check.key), ["account_not_venue", "venue_not_set"]);
    assert.equal(result.checks[0]!.sentence, "Account …1334 isn’t the one set for P26-BDAY: …9790.");
  });
});

describe("helpers", () => {
  it("lists four names, then … and n more", () => {
    assert.equal(listNames(["a", "b", "c", "d", "e", "f", "g"]), "a, b, c, d … and 3 more");
    assert.equal(listNames(["a", "a", "b"]), "a, b");
  });

  it("matches whole words only", () => {
    assert.equal(textHasTerm("Live in Bristol!", { kind: "city", value: "Bristol" }), true);
    assert.equal(textHasTerm("Bristolian nights", { kind: "city", value: "Bristol" }), false);
    assert.equal(textHasTerm("crqln.com/l/glitterbox-bristol-2", { kind: "slug", value: "glitterbox-bristol" }), false);
    assert.equal(textHasTerm("https://www.paulvandyk-newcastle.com/", { kind: "domain", value: "paulvandyk-newcastle.com" }), true);
  });
});

describe("audience names", () => {
  it("another show's artist in an audience name is targeting, not a hit; its code is a hit", () => {
    const draft = glitterboxNxDraft();
    draft.adSetSuggestions = [
      { ...draft.adSetSuggestions[0]!, name: "Paul van Dyk · FB + IG engagers" },
      { ...draft.adSetSuggestions[1]!, name: "[NX27-PAULVANDYK] signups 180d" },
    ];
    const result = run(draft, NX27_GLITTERBOX);
    assert.deepEqual(result.checks.map((check) => check.sentence), [
      "Still points to Paul van Dyk: NX27-PAULVANDYK in 1 audience name.",
    ]);
    assert.equal(result.checks[0]!.evidence, "Audience names in: [NX27-PAULVANDYK] signups 180d");
  });

  it("the target's own name is own even without a stored lineup", () => {
    const draft = glitterboxNxDraft();
    draft.creatives[0]!.name = "Glitterbox static";
    const target = { ...NX27_GLITTERBOX, artists: [] };
    assert.deepEqual(run(draft, target, [EBR27_GLITTERBOX]).checks, []);
  });
});

/**
 * Ops' rulings 3 and 4 (24 Nov, #1359 amendment). The expected words are the
 * fixture TSV's rows, never typed here.
 */
function tsvWord(key: string): string {
  const text = readFileSync(new URL("./fixtures/words-rc-2026-11-24.tsv", import.meta.url), "utf8");
  const row = text.split("\n").map((line) => line.split("\t")).find((cols) => cols[0] === key);
  assert.ok(row, `the word list has no ${key} row`);
  return row![2]!;
}

describe("one ad reads in the singular (ruling 3)", () => {
  it("link_not_event: one ad uses link_not_event.one, more use the plural row", () => {
    const draft = glitterboxNxDraft();
    draft.creatives[0]!.destinationUrl = "https://skiddle.com/e/41877";
    const one = run(draft, NX27_GLITTERBOX).checks[0]!;
    assert.equal(
      one.sentence,
      tsvWord("link_not_event.one")
        .replace("{url}", "skiddle.com/e/41877")
        .replace("{n}", "1")
        .replace("{signup url}", "glitterbox-newcastle.com"),
    );
    draft.creatives[1]!.destinationUrl = "https://skiddle.com/e/41877";
    const two = run(draft, NX27_GLITTERBOX).checks[0]!;
    assert.equal(
      two.sentence,
      "Link isn’t this event’s page: skiddle.com/e/41877 in 2 ads. The event’s page is glitterbox-newcastle.com.",
    );
  });

  it("artist_caption_not_approved: one ad uses its .one row", () => {
    const check = renderArtistCaptionCheck({ artist: "Glitterbox", adNames: ["Static 1"], captionLabels: "Artist · teaser 1" });
    assert.equal(
      check.sentence,
      tsvWord("artist_caption_not_approved.one").replace("{artist}", "Glitterbox").replace("{n}", "1"),
    );
    const four = renderArtistCaptionCheck({ artist: "Glitterbox", adNames: ["a", "b", "c", "d"], captionLabels: "x" });
    assert.equal(four.sentence, "Artist-voice caption with no OK from Glitterbox’s team: 4 ads.");
  });

  it("other_show_reference and its fix: one ad uses the .one rows, more the plural", () => {
    const draft = glitterboxNxDraft();
    draft.creatives[0]!.destinationUrl = "https://www.paulvandyk-newcastle.com";
    const check = run(draft, NX27_GLITTERBOX).checks.find((c) => c.key === "other_show_reference")!;
    assert.equal(
      check.sentence,
      tsvWord("other_show_reference.one")
        .replace("{other show}", "Paul van Dyk")
        .replace("{value}", "paulvandyk-newcastle.com")
        .replace("{ad | headline | primary text | ad name | audience name}", "ad"),
    );
    assert.equal(check.fixes[0]!.label, tsvWord("other_show_reference.fix.one").replace("{ad | headline | …}", "ad"));
    draft.creatives[1]!.destinationUrl = "https://www.paulvandyk-newcastle.com";
    const two = run(draft, NX27_GLITTERBOX).checks.find((c) => c.key === "other_show_reference")!;
    assert.equal(two.sentence, "Still points to Paul van Dyk: paulvandyk-newcastle.com in 2 ads.");
    assert.equal(two.fixes[0]!.label, "Show the 2 ads");
  });
});

describe("a venue with no account or pixel stored (ruling 4)", () => {
  const brixton = electricEvent({
    id: "brixton-show",
    code: "EBX27-TEST",
    name: "Test Night",
    venueName: "Electric Brixton",
    venueKey: "electric brixton",
    signupUrl: "https://crqln.com/l/test-brixton",
  });

  function brixtonDraft() {
    const draft = glitterboxNxDraft();
    draft.settings.eventId = brixton.id;
    draft.settings.campaignName = "[EBX27-TEST] SIGNUP";
    draft.creatives = draft.creatives.map((c) => ({
      ...c,
      destinationUrl: "https://crqln.com/l/test-brixton",
      headline: "Test Night",
      captions: [{ id: `${c.id}-c`, text: "Test Night. Sign up." }],
    }));
    return draft;
  }

  it("gives the warning and no blocker, and never holds Launch", () => {
    const result = run(brixtonDraft(), brixton, []);
    assert.deepEqual(result.checks.map((c) => [c.key, c.severity]), [["venue_not_set", "warning"]]);
    assert.equal(result.blockers, 0);
    assert.equal(blockedLaunchLabel(result.blockers), null);
    assert.equal(result.checks[0]!.sentence, tsvWord("venue_not_set").replace("{venue}", "Electric Brixton"));
    assert.equal(result.checks[0]!.label, tsvWord("venue_not_set.key"));
    assert.equal(result.checks[0]!.evidence, tsvWord("venue_not_set.evidence"));
    assert.deepEqual(result.checks[0]!.fixes, [
      { action: "open_venue_card", label: tsvWord("venue_not_set.fix"), clientId: brixton.clientId },
    ]);
  });

  it("only the account missing reads .account; only the pixel missing reads .pixel", () => {
    const venueOnly = (patch: { adAccountId?: string | null; pixelId?: string | null }) => {
      const defaults = venueDefaultsFromMap(brixton);
      const eventVenue = { ...defaults.eventVenue!, adAccountName: "Brixton Ads", ...patch };
      return checkLaunchReferences(brixtonDraft(), brixton, { ...defaults, eventVenue, venues: [eventVenue] }, []);
    };
    const venueRow = (r: ReturnType<typeof venueOnly>) => r.checks.find((c) => c.key === "venue_not_set")!;
    const noAccount = venueOnly({ pixelId: "645185673672763" });
    assert.equal(venueRow(noAccount).sentence, tsvWord("venue_not_set.account").replace("{venue}", "Electric Brixton"));
    const noPixel = venueOnly({ adAccountId: "606252931141334" });
    assert.equal(venueRow(noPixel).sentence, tsvWord("venue_not_set.pixel").replace("{venue}", "Electric Brixton"));
    assert.equal(venueRow(noPixel).severity, "warning");
  });

  it("is a warning beside the other warnings, after every blocker", () => {
    const draft = brixtonDraft();
    draft.settings.campaignName = "[NX27-GLITTERBOX] SIGNUP";
    draft.creatives[0]!.destinationUrl = "https://skiddle.com/e/1";
    const result = run(draft, brixton, []);
    assert.deepEqual(
      result.checks.map((c) => c.key),
      ["name_code_mismatch", "venue_not_set", "link_not_event"],
    );
    assert.equal(result.blockers, 1);
  });

  it("a seeded venue doesn't give it", () => {
    assert.ok(!run(glitterboxNxDraft(), NX27_GLITTERBOX).checks.some((c) => c.key === "venue_not_set"));
    assert.ok(!run(daveDraft(), ES27_DAVEPEARCE).checks.some((c) => c.key === "venue_not_set"));
  });
});

/**
 * page_other_client (RC3, 24 Nov amendment) on the NX26-DOD On sale draft,
 * 20909b86: its settings hold LWE's Ironworks London page and Puzzle's
 * Instagram; its two ads carry Electric's NX LOVES page and nxloves. The
 * rows are production's, read 24 Nov (clients defaults, the BM scan).
 */
describe("page_other_client", () => {
  const ELECTRIC = "f9045034-2788-4b1d-94d1-1a5ab7fa5ac8";
  const NX26_DOD = electricEvent({
    id: "f0b5636b-dod",
    code: "NX26-DOD",
    name: "DOD",
    venueName: "NX Newcastle",
    venueKey: "nx newcastle",
    signupUrl: "https://dod-newcastle.com",
    metaAdAccountId: "606252931141334",
  });
  const clients = [
    { id: ELECTRIC, name: "Electric Brixton", default_page_ids: [], default_instagram_actor_id: null, meta_business_id: "1927009767586803" },
    { id: "92f7334b", name: "Puzzle", default_page_ids: ["103824529223927"], default_instagram_actor_id: "17841456620568454", meta_business_id: "1297062077498960" },
    { id: "f7ed8aef", name: "IRONWORKS", default_page_ids: ["1157874844068425"], default_instagram_actor_id: "17841446090086018", meta_business_id: "741799859254067" },
  ];
  const bmPages = [
    { id: "p1", business_id: "741799859254067", page_id: "1157874844068425", page_name: "Ironworks London", is_owned_by_bm: true },
    { id: "p2", business_id: "1927009767586803", page_id: "259905047197071", page_name: "NX LOVES ", is_owned_by_bm: true },
  ];
  const bmIgs = [
    { id: "i1", business_id: "1297062077498960", ig_asset_id: "a1", ig_user_id: "17841456620568454", ig_username: "puzzleofficialuk", is_owned_by_bm: true },
    { id: "i2", business_id: "1927009767586803", ig_asset_id: "114480535065424", ig_user_id: "17841460869627228", ig_username: "nxloves", is_owned_by_bm: true },
  ];
  const bms = [
    { business_id: "741799859254067", client_id: null },
    { business_id: "1297062077498960", client_id: null },
    { business_id: "1927009767586803", client_id: null },
  ];

  function dodDraft() {
    const draft = glitterboxNxDraft();
    draft.settings = {
      ...draft.settings,
      clientId: ELECTRIC,
      eventId: NX26_DOD.id,
      campaignName: "[NX26-DOD] DOD - On sale",
      metaPageId: "1157874844068425",
      metaIGAccountId: "17841456620568454",
    };
    draft.creatives = ["Teaser - Motion  No Text", "Teaser - Motion"].map((name) =>
      creative({
        name,
        destinationUrl: "https://dod-newcastle.com?ref=meta",
        headline: "DOD",
        identity: { pageId: "259905047197071", instagramAccountId: "17841460869627228", instagramActorId: "17841460869627228" },
      }),
    );
    return draft;
  }

  function ownership(draft: ReturnType<typeof dodDraft>, artistRows: Array<{ meta_page_id: string | null; instagram_handle: string | null }> = []) {
    return identityOwnershipFrom({
      event: { ...NX26_DOD, clientId: ELECTRIC },
      pageIds: [...draftIdentities(draft).pages.keys()],
      igIds: [...draftIdentities(draft).instagram.keys()],
      clients,
      bmPages,
      bmIgs,
      bms,
      artistRows,
    });
  }

  function runDod(draft = dodDraft(), artists: Parameters<typeof ownership>[1] = []) {
    const event = { ...NX26_DOD, clientId: ELECTRIC };
    return checkLaunchReferences(draft, event, venueDefaultsFromMap(event), [], ownership(draft, artists));
  }

  it("NX26-DOD: LWE's page and Puzzle's Instagram are two blockers; Electric's own ones aren't", () => {
    const result = runDod();
    assert.deepEqual(
      result.checks.map((c) => [c.label, c.sentence, c.evidence, c.fixes.map((f) => f.label)]),
      [
        [
          tsvWord("page_other_client.key"),
          "Ads run from Ironworks London, which is IRONWORKS’s page. NX26-DOD is Electric Brixton’s show.",
          "Ads: all 2",
          [tsvWord("page_other_client.fix")],
        ],
        [
          tsvWord("page_other_client.instagram.key"),
          "Ads run on Instagram as @puzzleofficialuk, Puzzle’s account. NX26-DOD is Electric Brixton’s show.",
          "Ads: all 2",
          [tsvWord("page_other_client.instagram.fix")],
        ],
      ],
    );
    assert.equal(result.blockers, 2);
    assert.equal(blockedLaunchLabel(result.blockers), "Launch · 2 to fix");
  });

  it("only some ads on another client's page: the evidence names them", () => {
    const draft = dodDraft();
    draft.settings.metaPageId = "259905047197071";
    draft.settings.metaIGAccountId = "17841460869627228";
    draft.creatives[1]!.identity = { pageId: "1157874844068425", instagramAccountId: "17841460869627228" };
    const result = runDod(draft);
    assert.deepEqual(result.checks.map((c) => c.evidence), ["1 ads: Teaser - Motion"]);
    assert.deepEqual(result.checks[0]!.fixes[0], {
      action: "change_identity",
      label: tsvWord("page_other_client.fix"),
      field: "page",
      where: "creatives",
    });
  });

  it("a page or Instagram stored as an artist's never fires", () => {
    const result = runDod(dodDraft(), [
      { meta_page_id: "1157874844068425", instagram_handle: null },
      { meta_page_id: null, instagram_handle: "@PuzzleOfficialUK" },
    ]);
    assert.deepEqual(result.checks, []);
  });

  it("a page only shared into another client's BM (how artist pages arrive) never fires", () => {
    const draft = dodDraft();
    const event = { ...NX26_DOD, clientId: ELECTRIC };
    const owners = identityOwnershipFrom({
      event,
      pageIds: ["1157874844068425"],
      igIds: [],
      clients: clients.map((c) => ({ ...c, default_page_ids: [] })),
      bmPages: bmPages.map((p) => ({ ...p, is_owned_by_bm: false })),
      bmIgs: [],
      bms,
      artistRows: [],
    });
    draft.settings.metaIGAccountId = undefined;
    const result = checkLaunchReferences(draft, event, venueDefaultsFromMap(event), [], owners);
    assert.ok(!result.checks.some((c) => c.key === "page_other_client"));
  });

  it("a page the event's client also holds never fires", () => {
    const shared = clients.map((c) => (c.id === ELECTRIC ? { ...c, default_page_ids: ["1157874844068425"] } : c));
    const draft = dodDraft();
    draft.settings.metaIGAccountId = undefined;
    const event = { ...NX26_DOD, clientId: ELECTRIC };
    const owners = identityOwnershipFrom({
      event,
      pageIds: ["1157874844068425", "259905047197071"],
      igIds: ["17841460869627228"],
      clients: shared,
      bmPages,
      bmIgs,
      bms,
      artistRows: [],
    });
    assert.deepEqual(checkLaunchReferences(draft, event, venueDefaultsFromMap(event), [], owners).checks, []);
  });

  it("without ownership data the check is silent", () => {
    const event = { ...NX26_DOD, clientId: ELECTRIC };
    assert.deepEqual(checkLaunchReferences(dodDraft(), event, venueDefaultsFromMap(event), []).checks, []);
  });
});

/**
 * page_other_client on ops' sources (24 Nov): another client's defaults,
 * its venues' pages, its earlier drafts. This client's own drafts don't
 * count; its defaults, venues and BM do.
 */
describe("page_other_client: ops' sources", () => {
  const ELECTRIC = "f9045034-2788-4b1d-94d1-1a5ab7fa5ac8";
  const event = electricEvent({ id: "dod", code: "NX26-DOD", name: "DOD", venueName: "NX Newcastle", venueKey: "nx newcastle", signupUrl: "https://dod-newcastle.com", clientId: ELECTRIC });
  const clients = [
    { id: ELECTRIC, name: "Electric Brixton", default_page_ids: [], default_instagram_actor_id: null, meta_business_id: "1927009767586803" },
    { id: "lwe", name: "IRONWORKS", default_page_ids: [], default_instagram_actor_id: null, meta_business_id: null },
    { id: "puzzle", name: "Puzzle", default_page_ids: [], default_instagram_actor_id: null, meta_business_id: null },
  ];
  function draftOn(page: string, ig: string) {
    const draft = glitterboxNxDraft();
    draft.id = "this-draft";
    draft.settings = { ...draft.settings, clientId: ELECTRIC, eventId: event.id, campaignName: "[NX26-DOD] On sale", metaPageId: page, metaIGAccountId: ig };
    draft.creatives = draft.creatives.slice(0, 2).map((c) => ({ ...c, destinationUrl: "https://dod-newcastle.com", headline: "DOD", captions: [], identity: { pageId: page, instagramAccountId: ig } }));
    return draft;
  }
  function check(draft: ReturnType<typeof draftOn>, extra: Partial<Parameters<typeof identityOwnershipFrom>[0]> = {}) {
    const ids = draftIdentities(draft);
    const ownership = identityOwnershipFrom({
      event,
      pageIds: [...ids.pages.keys()],
      igIds: [...ids.instagram.keys()],
      clients,
      bmPages: [{ id: "b1", business_id: "1927009767586803", page_id: "259905047197071", page_name: "NX LOVES", is_owned_by_bm: true }],
      bmIgs: [{ id: "b2", business_id: "1927009767586803", ig_asset_id: "102392272513389", ig_user_id: "17841400834660844", ig_username: "dj_dod", is_owned_by_bm: false }],
      bms: [],
      artistRows: [],
      // Production, 24 Nov: IRONWORKS has 27 drafts on Ironworks London, Puzzle 16 on its Instagram;
      // Electric's own 16 + 14 are the copies.
      draftClaims: [
        { client_id: "lwe", page_id: "1157874844068425", ig_id: null },
        { client_id: "puzzle", page_id: null, ig_id: "17841456620568454" },
        { client_id: ELECTRIC, page_id: "1157874844068425", ig_id: "17841456620568454" },
      ],
      ...extra,
    });
    return checkLaunchReferences(draft, event, venueDefaultsFromMap(event), [], ownership);
  }

  it("Ironworks London + @puzzleofficialuk, held by other clients' drafts: both fire", () => {
    const result = check(draftOn("1157874844068425", "17841456620568454"));
    assert.deepEqual(result.checks.map((c) => c.label), ["Page", "Instagram"]);
    assert.match(result.checks[0]!.sentence, /^Ads run from 1157874844068425, which is IRONWORKS’s page\./);
  });

  it("NX LOVES + dj_dod: nothing fires", () => {
    assert.deepEqual(check(draftOn("259905047197071", "17841400834660844")).checks, []);
  });

  it("this client's own drafts never make a page its own", () => {
    const only = check(draftOn("1157874844068425", "17841400834660844"), {
      draftClaims: [{ client_id: ELECTRIC, page_id: "1157874844068425", ig_id: null }],
    });
    assert.deepEqual(only.checks, []);
  });

  it("a venue's page belongs to the clients whose events are at it", () => {
    const result = check(draftOn("555", "17841400834660844"), {
      draftClaims: [],
      venueClaims: [{ page_id: "555", client_id: "lwe" }],
    });
    assert.deepEqual(result.checks.map((c) => c.label), ["Page"]);
    const shared = check(draftOn("555", "17841400834660844"), {
      draftClaims: [],
      venueClaims: [{ page_id: "555", client_id: "lwe" }, { page_id: "555", client_id: ELECTRIC }],
    });
    assert.deepEqual(shared.checks, []);
  });
});
