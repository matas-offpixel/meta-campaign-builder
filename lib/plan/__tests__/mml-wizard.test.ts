import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  atUsername,
  channelPickNote,
  eventLastLaunch,
  eventObjectiveDefault,
  googleChannelAvailable,
  identityInitial,
  identityLabel,
  initialMmlChannels,
  metaCreativeIsSingleVerticalVideo,
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
  tikTokAdTextFromCaption,
  tikTokCtaForPlanIntent,
  tikTokForPlanIntent,
  tikTokNeedsRegionalLocation,
  tikTokRegionalRegion,
  EVENT_LAST_LAUNCH_NOTE,
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
    const audiences = readFileSync("components/wizard/mml-step-audiences.tsx", "utf8");
    assert.match(wizard, /<Creatives/);
    assert.match(audiences, /<MetaAudiencesStep/);
    assert.match(wizard, /<BudgetSchedule/);
    assert.match(wizard, /<AssignCreatives/);
    assert.match(wizard, /<WizardStepper/);
    assert.match(wizard, /<WizardFooter/);
    assert.match(wizard, /<OptimisationStrategy/);
    assert.match(wizard, /<MmlStepObjective/);
    assert.match(wizard, /<MmlStepAudiences/);
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

  it("loads launches filed on another client when the event is this client's", () => {
    const source = readFileSync("lib/plan/channel-history.ts", "utf8");
    assert.match(source, /\.in\("event_id", eventIds\)/);
  });

  it("counts Folamour's published launch, not Puzzle drafts or another ad account", () => {
    const nx = "act_606252931141334";
    const puzzleAccount = "act_1058599195559790";
    const venuePage = "259905047197071";
    const puzzle = "103824529223927";
    const venue = "nx newcastle";
    const published = (eventId: string, at: string, page: string, accountId: string) => ({
      value: page,
      at,
      venueKey: venue,
      accountId,
      eventId,
      status: "published" as const,
    });
    const draft = (eventId: string, at: string, page: string, accountId = nx) => ({
      value: page,
      at,
      venueKey: venue,
      accountId,
      eventId,
      status: "draft" as const,
    });
    const rows = [
      published("folamour", "2026-10-05T09:00:00Z", venuePage, nx),
      published("azyr", "2026-10-03T00:00:00Z", venuePage, nx),
      published("azyr", "2026-09-14T00:00:00Z", venuePage, nx),
      published("global", "2026-09-30T00:00:00Z", venuePage, nx),
      published("global", "2026-09-19T00:00:00Z", venuePage, nx),
      published("east-end", "2026-09-17T00:00:00Z", venuePage, nx),
      draft("dj-ez", "2026-09-01T00:00:00Z", venuePage),
      draft("folamour", "2026-09-07T21:00:00Z", puzzle),
      draft("folamour", "2026-09-07T22:00:00Z", puzzle),
      draft("folamour", "2026-10-09T00:00:00Z", puzzle),
      draft("azyr", "2026-10-08T00:00:00Z", puzzle),
      published("modern-funktion", "2026-10-01T00:00:00Z", puzzle, puzzleAccount),
      published("rudimental", "2026-09-20T00:00:00Z", "156873374377231", nx),
      published("schak", "2026-09-18T00:00:00Z", "109194631619954", nx),
      published("robbie", "2026-09-16T00:00:00Z", "269098466834722", nx),
    ];
    const venuePick = scopedMostUsed({ rows, venueKey: venue, accountId: nx });
    assert.equal(venuePick.value, venuePage);
    assert.equal(venuePick.count, 4);
    const folamour = resolveChannelField({
      stored: puzzle,
      storedFromDefault: true,
      rows,
      venueKey: venue,
      venueLabel: "NX Newcastle",
      accountId: nx,
      eventId: "folamour",
      clientDefault: puzzle,
      accountPageIds: [venuePage, puzzle],
    });
    assert.equal(folamour.value, venuePage);
    assert.equal(folamour.note, EVENT_LAST_LAUNCH_NOTE);
    assert.equal(eventLastLaunch({ rows, eventId: "folamour", accountId: nx })?.value, venuePage);
  });

  it("uses drafts when a venue has no published launch", () => {
    const rows = [
      {
        value: "draft-page",
        at: "2026-10-02T00:00:00Z",
        venueKey: "the garage",
        accountId: "act_nx",
        eventId: "one",
        status: "draft",
      },
      {
        value: "draft-page",
        at: "2026-10-01T00:00:00Z",
        venueKey: "the garage",
        accountId: "act_nx",
        eventId: "one",
        status: "draft",
      },
      {
        value: "other",
        at: "2026-09-01T00:00:00Z",
        venueKey: "the garage",
        accountId: "act_nx",
        eventId: "two",
        status: "draft",
      },
    ];
    const pick = scopedMostUsed({ rows, venueKey: "the garage", accountId: "act_nx" });
    assert.equal(pick.value, "draft-page");
    assert.equal(pick.count, 1);
  });
});

describe("MML TikTok reel row", () => {
  it("cuts ad text on a word, maps the CTA, and only offers a single 9:16 video", () => {
    const caption = `${"word ".repeat(40)}tail`;
    const text = tikTokAdTextFromCaption(caption);
    assert.ok(text.length <= 100);
    assert.equal(text.endsWith(" "), false);
    assert.equal(tikTokAdTextFromCaption("Book now"), "Book now");
    assert.equal(tikTokCtaForPlanIntent("purchase"), "BOOK_NOW");
    assert.equal(tikTokCtaForPlanIntent("registration"), "SIGN_UP");
    assert.equal(tikTokCtaForPlanIntent("awareness"), null);
    const video = {
      mediaType: "video",
      assetMode: "single",
      assetVariations: [{ assets: [{ aspectRatio: "9:16", videoId: "v1" }] }],
    };
    assert.equal(metaCreativeIsSingleVerticalVideo(video), true);
    assert.equal(metaCreativeIsSingleVerticalVideo({ ...video, assetMode: "dual" }), false);
    assert.equal(
      metaCreativeIsSingleVerticalVideo({
        ...video,
        assetVariations: [{ assets: [{ aspectRatio: "4:5", videoId: "v1" }] }],
      }),
      false,
    );
    assert.equal(
      metaCreativeIsSingleVerticalVideo({ ...video, mediaType: "image", assetVariations: [{ assets: [{ aspectRatio: "9:16", fileName: "a.jpg" }] }] }),
      false,
    );
    assert.deepEqual(
      tikTokRegionalRegion(
        [
          { id: "2635167", name: "United Kingdom" },
          { id: "city", name: "Newcastle upon Tyne" },
          { id: "longer", name: "Newcastle upon Tyne, England" },
        ],
        "NX Newcastle",
      ),
      { id: "city", name: "Newcastle upon Tyne" },
    );
    assert.equal(tikTokNeedsRegionalLocation([]), true);
    assert.equal(tikTokNeedsRegionalLocation(["GB"]), true);
    assert.equal(tikTokNeedsRegionalLocation(["2635167"]), true);
    assert.equal(tikTokNeedsRegionalLocation(["2641673"]), false);
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
