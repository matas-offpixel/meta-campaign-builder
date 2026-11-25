import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyLaunchCheckFix, checkLaunchReferences, instagramShown, keptIdentityLines } from "../check.ts";
import type { CampaignDraft, CreativeIdentity } from "../../types.ts";
import type { GuardEvent, LiveIdentity } from "../types.ts";
import { venueDefaultsFromMap } from "../venue-defaults.ts";
import { creative, electricEvent, glitterboxNxDraft } from "./fixtures.ts";

/**
 * Design ruling 25 Nov: an Instagram account Meta gives no username for
 * reads "account {id}" wherever "@{handle}" would go (identity.instagram.unnamed).
 * The shape is a74dff40, ES27-DAVEPEARCE's On Sale draft as prod holds it
 * (25 Nov): no page or Instagram in settings, five ads across four pages and
 * three Instagram ids; the live ads run as 17841403454071716, which the
 * Graph read returns no username for.
 */
const EVENT: GuardEvent = electricEvent({ id: "es27-davepearce", code: "ES27-DAVEPEARCE" });
const LIVE_IG = "17841403454071716";
const DRAFT_IG = "17841400846995002";
const READ_AT = "2026-11-25T10:15:00.000Z";
const ctx = { keptBy: "Matas", now: new Date(READ_AT) };

function a74dff40(): CampaignDraft {
  const draft = glitterboxNxDraft();
  draft.id = "a74dff40-1bb6-4806-a3ed-098355a09a05";
  draft.status = "published";
  draft.metaCampaignId = "120252001107940239";
  draft.settings = {
    ...draft.settings,
    eventId: EVENT.id,
    campaignName: "[ES27-DAVEPEARCE] On Sale",
    metaPageId: undefined,
    metaIGAccountId: undefined,
  };
  const ig = (pageId: string, instagram = ""): CreativeIdentity => ({
    pageId,
    instagramAccountId: instagram,
    instagramActorId: instagram,
  });
  draft.creatives = [
    creative({ name: "On Sale 1", identity: ig("95833032468") }),
    creative({ name: "On Sale 2", identity: ig("87572928317", DRAFT_IG) }),
    creative({ name: "On Sale 3", identity: ig("87572928317", DRAFT_IG) }),
    creative({ name: "On Sale 4", identity: ig("22761767091", "17841461211025095") }),
    creative({ name: "On Sale 5", identity: ig("769954239540040", "17841477444707301") }),
  ];
  return draft;
}

function live(draftNames: Record<string, string> = {}): LiveIdentity {
  return {
    campaignId: "120252001107940239",
    readAt: READ_AT,
    page: null,
    instagram: { id: LIVE_IG, name: null, count: 5, otherClient: false },
    draftNames,
  };
}

const notLive = (draft: CampaignDraft, l: LiveIdentity) =>
  checkLaunchReferences(draft, EVENT, venueDefaultsFromMap(EVENT), [], null, l).checks.filter(
    (check) => check.key === "identity_not_live",
  );

describe("Instagram with no username reads account {id} (a74dff40)", () => {
  it("the warning, the live fix and Keep all say account {id}", () => {
    const [check, ...rest] = notLive(a74dff40(), live());
    assert.equal(rest.length, 0);
    assert.equal(
      check!.sentence,
      `This draft runs on Instagram as account ${DRAFT_IG}; the live ads run as account ${LIVE_IG}. Relaunching uses the draft’s.`,
    );
    assert.deepEqual(
      check!.fixes.map((fix) => [fix.label, fix.names]),
      [
        [`Use the live ads’ Instagram: account ${LIVE_IG}`, [`account ${LIVE_IG}`]],
        [`Keep account ${DRAFT_IG}`, [`account ${DRAFT_IG}`]],
      ],
    );
    assert.ok(!check!.sentence.includes("@"));
  });

  it("a named draft account keeps its @handle beside the unnamed live one", () => {
    const [check] = notLive(a74dff40(), live({ [DRAFT_IG]: "davepearce" }));
    assert.equal(
      check!.sentence,
      `This draft runs on Instagram as @davepearce; the live ads run as account ${LIVE_IG}. Relaunching uses the draft’s.`,
    );
    assert.deepEqual(check!.fixes.map((fix) => fix.label), [`Use the live ads’ Instagram: account ${LIVE_IG}`, "Keep @davepearce"]);
  });

  it("Keep stores no name, and the kept line reads account {id}", () => {
    const draft = a74dff40();
    const keep = notLive(draft, live())[0]!.fixes[1]!;
    const kept = applyLaunchCheckFix(draft, keep, ctx);
    assert.deepEqual(kept.settings.launchGuard?.keptIdentity?.instagram, {
      id: DRAFT_IG,
      name: null,
      keptBy: "Matas",
      keptAt: READ_AT,
    });
    assert.deepEqual(notLive(kept, live()), []);
    assert.deepEqual(keptIdentityLines(kept), [`Instagram kept by Matas, Wed 25 Nov, 10:15: account ${DRAFT_IG}`]);
  });

  it("the live fix moves the ads to the live account, after which nothing is left", () => {
    const draft = a74dff40();
    const fixed = applyLaunchCheckFix(draft, notLive(draft, live())[0]!.fixes[0]!, ctx);
    assert.deepEqual(notLive(fixed, live()), []);
  });

  it("instagramShown: a username, a name that is only the id, none", () => {
    assert.equal(instagramShown("nxloves", "1"), "@nxloves");
    assert.equal(instagramShown("@nxloves", "1"), "@nxloves");
    assert.equal(instagramShown(LIVE_IG, LIVE_IG), `account ${LIVE_IG}`);
    assert.equal(instagramShown(null, LIVE_IG), `account ${LIVE_IG}`);
    assert.equal(instagramShown("  ", LIVE_IG), `account ${LIVE_IG}`);
  });
});
