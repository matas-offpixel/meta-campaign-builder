import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  atUsername,
  channelPickNote,
  eventObjectiveDefault,
  googleChannelAvailable,
  identityInitial,
  identityLabel,
  initialMmlChannels,
  metaFieldsFromDraft,
  mmlClientStepBlockers,
  mmlPlaceholderLine,
  mmlStepForDrawer,
  mmlWizardHref,
  mostUsedId,
  preferChannelValue,
  readMmlWizardLocation,
  resolveChannelField,
  scopedMostUsed,
  summariseChannelHistory,
  tikTokForPlanIntent,
} from "../mml-wizard.ts";
import { metaObjectiveForIntent } from "../adapters/meta.ts";

describe("MML wizard deep links", () => {
  it("maps each drawer onto the step and channel pill", () => {
    assert.deepEqual(mmlStepForDrawer("meta", "f-audiences"), { step: 3, channel: "meta" });
    assert.deepEqual(mmlStepForDrawer("meta", "f-creatives"), { step: 4, channel: "meta" });
    assert.deepEqual(mmlStepForDrawer("meta", "f-adsets"), { step: 6, channel: "meta" });
    assert.deepEqual(mmlStepForDrawer("meta", null), { step: 3, channel: "meta" });
    assert.deepEqual(mmlStepForDrawer("tiktok", "tt-video"), { step: 4, channel: "tiktok" });
    assert.deepEqual(mmlStepForDrawer("tiktok", "tt-refine"), { step: 3, channel: "tiktok" });
    assert.deepEqual(mmlStepForDrawer("google", "g-keywords"), { step: 3, channel: "google" });
    assert.deepEqual(mmlStepForDrawer("google", "g-copy"), { step: 4, channel: "google" });
  });

  it("reads ?drawer= ahead of ?step=, then writes the step back", () => {
    const params = new URLSearchParams("drawer=f&tab=f-creatives");
    assert.deepEqual(readMmlWizardLocation(params), { step: 4, channel: "meta" });
    assert.equal(
      mmlWizardHref("/mml/p1", { step: 4, channel: "meta" }, params),
      "/mml/p1?step=5&channel=meta",
    );
    assert.deepEqual(readMmlWizardLocation(new URLSearchParams("step=1&channel=tiktok")), {
      step: 0,
      channel: "tiktok",
    });
  });
});

describe("MML channel history", () => {
  it("picks the most used id, and the newest when the counts tie", () => {
    assert.equal(
      mostUsedId([
        { value: "act_a", at: "2026-10-01T00:00:00Z" },
        { value: "act_b", at: "2026-10-09T00:00:00Z" },
        { value: "act_a", at: "2026-09-01T00:00:00Z" },
      ]),
      "act_a",
    );
    assert.equal(
      mostUsedId([
        { value: "act_a", at: "2026-10-01T00:00:00Z" },
        { value: "act_b", at: "2026-10-09T00:00:00Z" },
      ]),
      "act_b",
    );
    assert.equal(mostUsedId([{ value: "  ", at: "2026-10-01T00:00:00Z" }]), null);
  });

  it("reads Meta settings, TikTok account setup and the Google account", () => {
    const pick = summariseChannelHistory({
      meta: [
        {
          updatedAt: "2026-10-01T00:00:00Z",
          draftJson: {
            settings: {
              adAccountId: "act_old",
              metaPixelId: "px",
              metaPageId: "page",
              metaIGAccountId: "ig",
            },
          },
        },
        {
          updatedAt: "2026-10-02T00:00:00Z",
          draftJson: { settings: { metaAdAccountId: "act_old", metaPageId: "page" } },
        },
        {
          updatedAt: "2026-10-08T00:00:00Z",
          draftJson: { settings: { metaAdAccountId: "act_new" } },
        },
      ],
      tiktok: [
        {
          updatedAt: "2026-10-03T00:00:00Z",
          state: { accountSetup: { advertiserId: "adv", identityId: "idn" } },
        },
      ],
      google: [{ accountId: "g-acc", updatedAt: "2026-10-04T00:00:00Z" }],
    });
    assert.equal(pick.metaAdAccountId, "act_old");
    assert.equal(pick.metaPageId, "page");
    assert.equal(pick.metaPixelId, "px");
    assert.equal(pick.tiktokAdvertiserId, "adv");
    assert.equal(pick.tiktokIdentityId, "idn");
    assert.equal(pick.googleAdsAccountId, "g-acc");
  });

  it("keeps a stored value, then history, then the client default", () => {
    assert.equal(preferChannelValue("stored", "history", "default"), "stored");
    assert.equal(preferChannelValue("", "history", "default"), "history");
    assert.equal(preferChannelValue(null, null, "default"), "default");
  });
});

describe("MML step 1", () => {
  it("shows Google only when the client has a customer, and starts from drafts", () => {
    assert.equal(googleChannelAvailable("123"), true);
    assert.equal(googleChannelAvailable("  "), false);
    assert.deepEqual(
      initialMmlChannels({
        metaDraft: true,
        tiktokDraft: true,
        googleDraft: false,
        metaDaily: 0,
        tiktokDaily: 0,
        googleDaily: 40,
        googleAvailable: false,
      }),
      { meta: true, tiktok: true, google: false },
    );
    assert.deepEqual(
      initialMmlChannels({
        metaDraft: false,
        tiktokDraft: false,
        googleDraft: false,
        metaDaily: 0,
        tiktokDaily: 0,
        googleDaily: 0,
        googleAvailable: true,
      }),
      { meta: true, tiktok: false, google: false },
    );
  });

  it("blocks continue until the client, event, channel and account are set", () => {
    assert.deepEqual(
      mmlClientStepBlockers({
        clientId: null,
        eventId: null,
        channels: { meta: true, tiktok: false, google: false },
        metaAdAccountId: null,
        tiktokAdvertiserId: null,
        googleCustomerId: null,
      }),
      ["Choose a client", "Choose an event", "Ad account is required"],
    );
  });

  it("names a page, and says Unknown page when the name never arrived", () => {
    assert.deepEqual(identityLabel({ id: "1", name: "Folamour", noun: "page" }), {
      primary: "Folamour",
      unknown: false,
    });
    assert.equal(identityInitial("Folamour"), "F");
    assert.deepEqual(identityLabel({ id: "99", name: "  ", noun: "page" }), {
      primary: "Unknown page (99)",
      unknown: true,
    });
    assert.equal(atUsername("folamour"), "@folamour");
    assert.match(mmlPlaceholderLine(1), /drawer/);
  });

  it("mounts the Meta creator steps and does not mount the intake", () => {
    const wizard = readFileSync("components/wizard/mml-wizard.tsx", "utf8");
    assert.match(wizard, /<Creatives/);
    assert.match(wizard, /<AudiencesStep/);
    assert.match(wizard, /<BudgetSchedule/);
    assert.match(wizard, /<AssignCreatives/);
    assert.match(wizard, /<WizardStepper/);
    assert.match(wizard, /<WizardFooter/);
    assert.match(wizard, /<OptimisationStrategy/);
    assert.match(wizard, /<MmlStepObjective/);
    assert.match(wizard, /benchmarks/);
    assert.doesNotMatch(wizard, /MmlCreativeIntake/);
    assert.doesNotMatch(wizard, /Coming in M/);
  });
});

describe("MML venue defaults", () => {
  it("reads the page and Instagram from the creative identity", () => {
    const fields = metaFieldsFromDraft({
      settings: { pageId: null, metaPageId: "client-default-page", metaIGAccountId: "settings-ig" },
      creatives: [
        { identity: { pageId: "venue-page", instagramActorId: "venue-ig", instagramAccountId: "content" } },
        { identity: { pageId: "venue-page", instagramAccountId: "content" } },
        { identity: { pageId: "other-page", instagramActorId: "other-ig" } },
      ],
    });
    assert.equal(fields.pageId, "venue-page");
    assert.equal(fields.igId, "venue-ig");
  });

  it("picks the venue page over the client's most used page", () => {
    const rows = [
      { value: "puzzle", at: "2026-10-09T00:00:00Z", venueKey: "electric studios", accountId: "act_nx" },
      { value: "puzzle", at: "2026-10-08T00:00:00Z", venueKey: "electric studios", accountId: "act_nx" },
      { value: "puzzle", at: "2026-10-07T00:00:00Z", venueKey: "nx newcastle", accountId: "act_puzzle" },
      { value: "nx-page", at: "2026-10-06T00:00:00Z", venueKey: "nx newcastle", accountId: "act_nx" },
      { value: "nx-page", at: "2026-10-05T00:00:00Z", venueKey: "NX NEWCASTLE", accountId: "act_nx" },
    ];
    const pick = scopedMostUsed({ rows, venueKey: "nx newcastle", accountId: "act_nx" });
    assert.equal(pick.value, "nx-page");
    assert.equal(pick.source, "venue");
    assert.equal(pick.count, 2);
    assert.equal(channelPickNote(pick, "NX Newcastle"), "used on 2 NX Newcastle campaigns");
  });

  it("flags a page that is not on the ad account's list and does not select it", () => {
    const flagged = resolveChannelField({
      stored: "puzzle",
      storedFromDefault: true,
      rows: [
        { value: "puzzle", at: "2026-10-09T00:00:00Z", venueKey: "nx newcastle", accountId: "act_nx" },
        { value: "nx-page", at: "2026-10-08T00:00:00Z", venueKey: "nx newcastle", accountId: "act_nx" },
      ],
      venueKey: "nx newcastle",
      venueLabel: "NX Newcastle",
      accountId: "act_nx",
      clientDefault: "puzzle",
      accountPageIds: ["nx-page"],
    });
    assert.equal(flagged.value, null);
    assert.equal(flagged.flagged, "puzzle");
    assert.match(flagged.note ?? "", /NX Newcastle/);

    const selected = resolveChannelField({
      stored: null,
      rows: [{ value: "nx-page", at: "2026-10-08T00:00:00Z", venueKey: "nx newcastle", accountId: "act_nx" }],
      venueKey: "nx newcastle",
      venueLabel: "NX Newcastle",
      accountId: "act_nx",
      clientDefault: "puzzle",
      accountPageIds: ["nx-page"],
    });
    assert.equal(selected.value, "nx-page");
    assert.equal(selected.flagged, null);
  });
});

describe("MML objective", () => {
  it("uses the adapter mappings, and leaves Awareness off TikTok", () => {
    assert.equal(eventObjectiveDefault("on_sale").intent, "purchase");
    assert.equal(eventObjectiveDefault("on_sale").cta, "book_now");
    assert.equal(eventObjectiveDefault("presale").cta, "sign_up");
    assert.deepEqual(metaObjectiveForIntent("purchase"), {
      objective: "purchase",
      optimisationGoal: "conversions",
    });
    assert.equal(tikTokForPlanIntent("purchase")?.objective, "LEAD_GENERATION");
    assert.equal(tikTokForPlanIntent("registration")?.objective, "LEAD_GENERATION");
    assert.equal(tikTokForPlanIntent("awareness"), null);
    assert.equal(tikTokForPlanIntent("traffic")?.objective, "TRAFFIC");
    assert.ok(tikTokForPlanIntent("engagement"));
  });
});
