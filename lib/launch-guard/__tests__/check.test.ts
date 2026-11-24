import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyLaunchCheckFix,
  blockedLaunchLabel,
  checkArtistCaptions,
  checkLaunchReferences,
  countLine,
  keepLink,
  listNames,
} from "../check.ts";
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
      "Account Electric Bristol Live isn’t NX Newcastle’s. NX27-GLITTERBOX runs on NX Promoter.",
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

  it("Dave Pearce with the PVD URL → other_show_reference (and the link warning)", () => {
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
    });
    // Blockers first, then the warning.
    assert.deepEqual(
      result.checks.map((check) => check.severity),
      ["blocker", "warning"],
    );
    const link = result.checks[1]!;
    assert.equal(
      link.sentence,
      "Link isn’t this event’s page: paulvandyk-newcastle.com in 6 ads. The event’s page is crqln.com/l/davepearce-sheffield.",
    );
    assert.deepEqual(
      link.fixes.map((fix) => fix.label),
      ["Use the event’s page", "Keep this link"],
    );
    // "Use the event's page" clears both.
    const fixed = applyLaunchCheckFix(draft, link.fixes[0]!, { keptBy: "matas", now: new Date() });
    assert.deepEqual(run(fixed, ES27_DAVEPEARCE).checks, []);
  });

  it("one hit uses the .one sentence", () => {
    const draft = glitterboxNxDraft();
    draft.creatives[0]!.headline = "As seen at Electric Bristol";
    const result = run(draft, NX27_GLITTERBOX);
    assert.equal(result.checks.length, 1);
    assert.equal(result.checks[0]!.sentence, "Still points to EBR27-GLITTERBOX: Electric Bristol in 1 headline.");
    assert.equal(result.checks[0]!.evidence, "Headlines in: Static 1");
    assert.equal(result.checks[0]!.fixes[0]!.label, "Show the 1 headline");
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

    const changed = {
      ...kept,
      creatives: kept.creatives.map((c) => ({ ...c, destinationUrl: "https://www.skiddle.com/e/99999" })),
    };
    const after = run(changed, NX27_GLITTERBOX);
    assert.deepEqual(after.checks.map((check) => check.key), ["link_not_event"]);
    assert.match(after.checks[0]!.sentence, /skiddle\.com\/e\/99999 in 3 ads/);
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
    assert.deepEqual(result.checks.map((check) => check.key), ["account_not_venue"]);
    assert.equal(result.checks[0]!.sentence, "Account …1334 isn’t the one set for P26-BDAY (…9790).");
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
