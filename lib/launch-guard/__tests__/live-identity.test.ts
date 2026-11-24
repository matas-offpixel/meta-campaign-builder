import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyLaunchCheckFix, checkLaunchReferences, countLine, keptIdentityLines } from "../check.ts";
import { createLiveIdentityReader, majorityIdentity, readLiveIdentity } from "../live-identity.ts";
import { identityOwnershipFrom } from "../load.ts";
import type { GuardEvent, LiveIdentity } from "../types.ts";
import { venueDefaultsFromMap } from "../venue-defaults.ts";
import { creative, electricEvent, glitterboxNxDraft } from "./fixtures.ts";

/**
 * RC8 / RC8a (#1362). The NX26-DOD On sale draft (20909b86): settings on
 * Ironworks London + @puzzleofficialuk on its ads (RC-H's case); the live
 * ads as the Graph read them on 24 Nov: NX LOVES + @nxloves (record #1362).
 * Ownership rows are production's (24 Nov).
 */
const ELECTRIC = "f9045034-2788-4b1d-94d1-1a5ab7fa5ac8";
const EVENT: GuardEvent = electricEvent({
  id: "f0b5636b",
  code: "NX26-DOD",
  name: "DOD",
  venueName: "NX Newcastle",
  venueKey: "nx newcastle",
  signupUrl: "https://dod-newcastle.com",
  metaAdAccountId: "606252931141334",
  clientId: ELECTRIC,
});
const PAGES = { ironworks: "1157874844068425", nxLoves: "259905047197071", nxNewcastle: "900000000000001" };
const IGS = { puzzle: "17841456620568454", nxloves: "17841460869627228", nxNewcastle: "17840000000000001" };
const READ_AT = "2026-11-24T15:02:00.000Z";

function published(page: string, ig: string) {
  const draft = glitterboxNxDraft();
  draft.id = "20909b86";
  draft.status = "published";
  draft.metaCampaignId = "120251748789350755";
  draft.settings = {
    ...draft.settings,
    clientId: ELECTRIC,
    eventId: EVENT.id,
    campaignName: "[NX26-DOD] DOD - On sale",
    metaPageId: page,
    metaIGAccountId: ig,
  };
  draft.creatives = Array.from({ length: 9 }, (_, i) =>
    creative({ name: `On sale ${i + 1}`, destinationUrl: "https://dod-newcastle.com", headline: "DOD", identity: { pageId: page, instagramAccountId: ig } }),
  );
  return draft;
}

function ownershipFor(draft: ReturnType<typeof published>) {
  const ids = [draft.settings.metaPageId!, draft.settings.metaIGAccountId!];
  return identityOwnershipFrom({
    event: EVENT,
    pageIds: [ids[0]!],
    igIds: [ids[1]!],
    clients: [
      { id: ELECTRIC, name: "Electric Brixton", default_page_ids: [], default_instagram_actor_id: null, meta_business_id: "1927009767586803" },
      { id: "puzzle", name: "Puzzle", default_page_ids: ["103824529223927"], default_instagram_actor_id: IGS.puzzle, meta_business_id: null },
      { id: "ironworks", name: "IRONWORKS", default_page_ids: [PAGES.ironworks], default_instagram_actor_id: null, meta_business_id: null },
    ],
    bmPages: [{ id: "a", business_id: "741799859254067", page_id: PAGES.ironworks, page_name: "Ironworks London", is_owned_by_bm: true }],
    bmIgs: [{ id: "b", business_id: "1297062077498960", ig_asset_id: "x", ig_user_id: IGS.puzzle, ig_username: "puzzleofficialuk", is_owned_by_bm: true }],
    bms: [],
    artistRows: [],
  });
}

function live(patch: Partial<LiveIdentity> = {}): LiveIdentity {
  return {
    campaignId: "120251748789350755",
    readAt: READ_AT,
    page: { id: PAGES.nxLoves, name: "NX LOVES", count: 9, otherClient: false },
    instagram: { id: IGS.nxloves, name: "nxloves", count: 9, otherClient: false },
    draftNames: { [PAGES.nxNewcastle]: "NX Newcastle", [IGS.nxNewcastle]: "nxnewcastle", [PAGES.ironworks]: "Ironworks London", [IGS.puzzle]: "puzzleofficialuk" },
    ...patch,
  };
}

const run = (draft: ReturnType<typeof published>, l: LiveIdentity | null) =>
  checkLaunchReferences(draft, EVENT, venueDefaultsFromMap(EVENT), [], ownershipFor(draft), l);

describe("RC8a: NX26-DOD (RC-H)", () => {
  it("two blockers, each with the live fix first; no identity_not_live line", () => {
    const result = run(published(PAGES.ironworks, IGS.puzzle), live());
    assert.deepEqual(
      result.checks.map((c) => [c.key, c.label, c.evidence, c.fixes.map((f) => f.label)]),
      [
        ["page_other_client", "Page", "Ads: all 9 · the live ads run from NX LOVES", ["Use the live ads’ page: NX LOVES", "Change the page"]],
        [
          "page_other_client",
          "Instagram",
          "Ads: all 9 · the live ads run as @nxloves",
          ["Use the live ads’ Instagram: @nxloves", "Change the Instagram account"],
        ],
      ],
    );
    assert.deepEqual(result.checks[1]!.fixes[0]!.names, ["@nxloves"]);
  });

  it("one click on each sets NX LOVES and @nxloves, after which nothing is left", () => {
    let draft = published(PAGES.ironworks, IGS.puzzle);
    for (const check of run(draft, live()).checks) {
      draft = applyLaunchCheckFix(draft, check.fixes[0]!, { keptBy: "Matas", now: new Date(READ_AT) });
    }
    assert.equal(draft.settings.metaPageId, PAGES.nxLoves);
    assert.equal(draft.settings.metaIGAccountId, IGS.nxloves);
    assert.ok(draft.creatives.every((c) => c.identity.pageId === PAGES.nxLoves && c.identity.instagramAccountId === IGS.nxloves));
    assert.deepEqual(run(draft, live()).checks, []);
  });

  it("a live page that is another client's: no live fix, and the blocker reads as #1359 has it", () => {
    const result = run(published(PAGES.ironworks, IGS.puzzle), live({ page: { id: "777", name: "Someone Else", count: 9, otherClient: true } }));
    const page = result.checks.find((c) => c.label === "Page")!;
    assert.equal(page.evidence, "Ads: all 9");
    assert.deepEqual(page.fixes.map((f) => f.label), ["Change the page"]);
    // Fields are judged on their own: the Instagram still gets its live answer.
    assert.equal(result.checks.find((c) => c.label === "Instagram")!.fixes[0]!.label, "Use the live ads’ Instagram: @nxloves");
  });
});

describe("RC8: identity_not_live (RC-I)", () => {
  it("another Electric page: two warnings, Launch on", () => {
    const result = run(published(PAGES.nxNewcastle, IGS.nxNewcastle), live());
    assert.equal(result.blockers, 0);
    assert.deepEqual(countLine(result), ["● 2 to check"]);
    assert.deepEqual(
      result.checks.map((c) => [c.label, c.sentence, c.evidence, c.fixes.map((f) => f.label)]),
      [
        [
          "Live ads",
          "This draft runs from NX Newcastle; the live ads run from NX LOVES. Relaunching uses the draft’s.",
          "Read from the live ads at Tue 24 Nov, 15:02: 9 ads",
          ["Use the live ads’ page: NX LOVES", "Keep NX Newcastle"],
        ],
        [
          "Live ads",
          "This draft runs on Instagram as @nxnewcastle; the live ads run as @nxloves. Relaunching uses the draft’s.",
          "Read from the live ads at Tue 24 Nov, 15:02: 9 ads",
          ["Use the live ads’ Instagram: @nxloves", "Keep @nxnewcastle"],
        ],
      ],
    );
  });

  it("Keep on both: nothing to fix, two kept lines; changing the page brings it back", () => {
    let draft = published(PAGES.nxNewcastle, IGS.nxNewcastle);
    for (const check of run(draft, live()).checks) {
      draft = applyLaunchCheckFix(draft, check.fixes[1]!, { keptBy: "Matas", now: new Date("2026-11-24T15:06:00Z") });
    }
    assert.deepEqual(run(draft, live()).checks, []);
    assert.deepEqual(keptIdentityLines(draft), [
      "Page kept by Matas, Tue 24 Nov, 15:06: NX Newcastle",
      "Instagram kept by Matas, Tue 24 Nov, 15:06: @nxnewcastle",
    ]);
    // Ruling B: the ads' own page is what's judged, so the change is on the ads.
    const changed = {
      ...draft,
      creatives: draft.creatives.map((c) => ({ ...c, identity: { ...c.identity, pageId: "900000000000002" } })),
    };
    assert.deepEqual(run(changed, live()).checks.map((c) => c.findings[0]!.field), ["page"]);
    assert.deepEqual(keptIdentityLines(changed), ["Instagram kept by Matas, Tue 24 Nov, 15:06: @nxnewcastle"]);
  });

  it("one live ad reads .evidence.one", () => {
    const one = live({ page: { id: PAGES.nxLoves, name: "NX LOVES", count: 1, otherClient: false }, instagram: null });
    assert.equal(run(published(PAGES.nxNewcastle, IGS.nxNewcastle), one).checks[0]!.evidence, "Read from the live ads at Tue 24 Nov, 15:02: 1 ad");
  });

  it("never launched, or no live read: nothing", () => {
    const draft = published(PAGES.nxNewcastle, IGS.nxNewcastle);
    assert.deepEqual(run(draft, null).checks, []);
    assert.deepEqual(run({ ...draft, status: "draft" }, live()).checks, []);
  });
});

describe("the read", () => {
  const ADS = [
    ...Array.from({ length: 7 }, () => ({ creative: { object_story_spec: { page_id: PAGES.nxLoves, instagram_user_id: IGS.nxloves } } })),
    ...Array.from({ length: 2 }, () => ({ creative: { object_story_spec: { page_id: "other", instagram_user_id: "other-ig" } } })),
  ];

  it("mixed live ads: the page most of them use, counted", () => {
    assert.deepEqual(majorityIdentity(ADS), { page: { id: PAGES.nxLoves, count: 7 }, instagram: { id: IGS.nxloves, count: 7 } });
  });

  it("reads the ads, the names and the owners; GETs only", async () => {
    const calls: string[] = [];
    const get = async <T,>(path: string): Promise<T> => {
      calls.push(path);
      if (path.endsWith("/ads")) return { data: ADS } as T;
      return {
        [PAGES.nxLoves]: { name: "NX LOVES " },
        [IGS.nxloves]: { username: "nxloves", name: "DOD" },
        [PAGES.ironworks]: { name: "Ironworks London" },
        [IGS.puzzle]: { username: "puzzleofficialuk" },
      } as T;
    };
    const result = await readLiveIdentity(get, published(PAGES.ironworks, IGS.puzzle), async () => null, () => new Date(READ_AT));
    assert.deepEqual(calls, ["/120251748789350755/ads", "/"]);
    assert.deepEqual(result, {
      campaignId: "120251748789350755",
      readAt: READ_AT,
      page: { id: PAGES.nxLoves, name: "NX LOVES", count: 7, otherClient: false },
      instagram: { id: IGS.nxloves, name: "nxloves", count: 7, otherClient: false },
      draftNames: { [PAGES.ironworks]: "Ironworks London", [IGS.puzzle]: "puzzleofficialuk" },
    });
  });

  it("once per launch review (spy): repeat calls share the read; a new open reads again", async () => {
    let reads = 0;
    const reader = createLiveIdentityReader(async () => {
      reads += 1;
      return live();
    });
    const draft = published(PAGES.ironworks, IGS.puzzle);
    await Promise.all([reader.read(1, draft), reader.read(1, draft), reader.read(1, { ...draft, settings: { ...draft.settings, campaignName: "edited" } })]);
    assert.equal(reads, 1);
    await reader.read(2, draft);
    assert.equal(reads, 2);
    // A draft that never launched is never read.
    await reader.read(3, { ...draft, status: "draft" });
    assert.equal(reads, 2);
  });

  it("a failed read shows nothing", async () => {
    const warn = console.warn;
    const logged: unknown[] = [];
    console.warn = (...args: unknown[]) => void logged.push(args);
    try {
      const reader = createLiveIdentityReader(async () => {
        throw new Error("(#17) User request limit reached");
      });
      const draft = published(PAGES.ironworks, IGS.puzzle);
      const identity = await reader.read(1, draft);
      assert.equal(identity, null);
      assert.equal(logged.length, 1);
      const result = run(draft, identity);
      assert.ok(result.checks.every((c) => c.key !== "identity_not_live"));
      assert.ok(result.checks.every((c) => !c.fixes.some((f) => f.action === "use_live_identity")));
    } finally {
      console.warn = warn;
    }
  });
});
