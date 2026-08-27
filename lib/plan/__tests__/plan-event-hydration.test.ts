import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  applyGoogleChannelDefaults,
  applyMetaChannelDefaults,
  applyTikTokChannelDefaults,
  emptyChannelDefaultsRow,
  resolveChannelDefaults,
} from "../../clients/channel-defaults.ts";
import { normalizeAdAccountId } from "../../meta/ad-account.ts";
import { validateCampaignPayload } from "../../meta/campaign.ts";
import { planToGoogleDraft } from "../adapters/google.ts";
import { planToMetaDraft } from "../adapters/meta.ts";
import { planToTikTokDraft } from "../adapters/tiktok.ts";
import { planIdentityChips } from "../identity-chips.ts";
import { collectPlanPreflight } from "../preflight.ts";
import { IDLE_PLAN_LAUNCH, type CampaignPlan } from "../types.ts";

/** Ironworks-shaped client: bare Meta ad account, everything else filled. */
function ironworksRow() {
  return {
    ...emptyChannelDefaultsRow("ironworks", "Ironworks"),
    metaAdAccountId: "1967530076312",
    metaPixelId: "612345678901234",
    defaultPageId: "page_ironworks",
    defaultInstagramActorId: "ig_ironworks",
    tiktokAccountId: "tt_ironworks",
    tiktokAdvertiserId: "adv_ironworks",
    tiktokIdentityId: "id_ironworks",
    tiktokIdentityType: "TT_USER" as const,
    googleAdsAccountId: "ga_ironworks",
    googleAdsCustomerId: "123-456-7890",
  };
}

function goldenPlan(): CampaignPlan {
  const now = "2026-08-27T12:00:00.000Z";
  return {
    id: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    name: "IW event",
    status: "draft",
    intent: {
      eventId: "33333333-3333-4333-8333-333333333333",
      objectiveIntent: "registration",
      budget: {
        totalDaily: 110,
        metaDaily: 40,
        tiktokDaily: 50,
        googleDaily: 20,
      },
      destinationUrl: "https://tickets.example.com/iw",
      audienceClusterRef: null,
      creativeSetRef: null,
      startDate: "2026-09-01",
      endDate: "2026-09-14",
      startTime: null,
      endTime: null,
    },
    launches: {
      meta: IDLE_PLAN_LAUNCH,
      tiktok: IDLE_PLAN_LAUNCH,
      google: IDLE_PLAN_LAUNCH,
    },
    createdAt: now,
    updatedAt: now,
  };
}

const IDENTITY_BLOCKER =
  /Ad account ID must start|Ad account ID is required|Facebook page|TikTok advertiser|TikTok identity|Google Ads account|no default Meta ad account/i;

describe("act_ normalisation matrix — plan/defaults path", () => {
  it("bare → act_-prefixed, prefixed unchanged, never act_act_", () => {
    const bare = resolveChannelDefaults({
      ...emptyChannelDefaultsRow("c1", "Ironworks"),
      metaAdAccountId: "1967530076312",
    });
    assert.equal(bare.metaAdAccount.value, "act_1967530076312");
    assert.equal(bare.metaAdAccount.provenance, "client-default");
    assert.notEqual(bare.metaAdAccount.value, "act_act_1967530076312");

    const prefixed = resolveChannelDefaults({
      ...emptyChannelDefaultsRow("c1", "Ironworks"),
      metaAdAccountId: "act_1967530076312",
    });
    assert.equal(prefixed.metaAdAccount.value, "act_1967530076312");

    const doubled = resolveChannelDefaults({
      ...emptyChannelDefaultsRow("c1", "Ironworks"),
      metaAdAccountId: "act_act_1967530076312",
    });
    assert.equal(doubled.metaAdAccount.value, null);
    assert.equal(doubled.metaAdAccount.provenance, "unset");

    const appliedBare = applyMetaChannelDefaults(
      planToMetaDraft(goldenPlan()),
      bare,
    );
    assert.equal(appliedBare.settings.adAccountId, "act_1967530076312");
    assert.equal(appliedBare.settings.metaAdAccountId, "act_1967530076312");
    assert.doesNotMatch(appliedBare.settings.adAccountId, /act_act_/);

    const appliedPrefixed = applyMetaChannelDefaults(
      planToMetaDraft(goldenPlan()),
      prefixed,
    );
    assert.equal(appliedPrefixed.settings.adAccountId, "act_1967530076312");

    assert.equal(normalizeAdAccountId("1967530076312"), "act_1967530076312");
    assert.equal(normalizeAdAccountId("act_1967530076312"), "act_1967530076312");
    assert.notEqual(normalizeAdAccountId("act_1967530076312"), "act_act_1967530076312");
    assert.equal(normalizeAdAccountId("act_act_1967530076312"), null);
  });

  it("override still beats the client default after normalisation", () => {
    const resolved = resolveChannelDefaults(ironworksRow(), {
      metaAdAccountId: "999999999999",
    });
    assert.equal(resolved.metaAdAccount.value, "act_999999999999");
    assert.equal(resolved.metaAdAccount.provenance, "operator-override");
  });
});

describe("Ironworks preview blockers exclude resolvable identities", () => {
  it("parent-shaped bare id no longer fails the act_ check; remaining blockers are creatives/keywords", () => {
    const plan = goldenPlan();
    const result = collectPlanPreflight(plan, undefined, { stored: ironworksRow() });

    const metaCampaign = validateCampaignPayload({
      metaAdAccountId:
        result.drafts.meta.settings.metaAdAccountId ||
        result.drafts.meta.settings.adAccountId,
      name: result.drafts.meta.settings.campaignName,
      objective: result.drafts.meta.settings.objective,
    });
    assert.equal(metaCampaign.errors.metaAdAccountId, undefined);
    assert.equal(result.drafts.meta.settings.adAccountId, "act_1967530076312");
    assert.equal(result.drafts.meta.settings.pixelId, "612345678901234");
    assert.equal(result.drafts.meta.settings.metaPageId, "page_ironworks");
    assert.equal(result.drafts.meta.settings.metaIGAccountId, "ig_ironworks");

    const identity = result.issues.filter((issue) => IDENTITY_BLOCKER.test(issue.message));
    assert.deepEqual(
      identity.map((issue) => issue.message),
      [],
    );

    const blocking = result.issues.filter((issue) => issue.blocking).map((issue) => issue.message);
    assert.ok(blocking.some((message) => /caption/i.test(message)));
    assert.ok(blocking.some((message) => /asset must be uploaded/i.test(message)));
    assert.ok(blocking.some((message) => /keyword/i.test(message)));
  });
});

describe("identity chip row provenance", () => {
  it("renders client-default, operator-override, and unresolved-with-cure", () => {
    const defaults = planIdentityChips(resolveChannelDefaults(ironworksRow()));
    const account = defaults.find((chip) => chip.id === "meta-ad-account");
    const pixel = defaults.find((chip) => chip.id === "meta-pixel");
    const page = defaults.find((chip) => chip.id === "meta-page");
    const ig = defaults.find((chip) => chip.id === "meta-ig");
    const advertiser = defaults.find((chip) => chip.id === "tiktok-advertiser");
    const identity = defaults.find((chip) => chip.id === "tiktok-identity");
    const customer = defaults.find((chip) => chip.id === "google-customer");
    assert.equal(account?.value, "act_1967530076312");
    assert.equal(account?.provenance, "client-default");
    assert.equal(account?.href, null);
    assert.equal(pixel?.value, "612345678901234");
    assert.equal(pixel?.provenance, "client-default");
    assert.equal(page?.provenance, "client-default");
    assert.equal(ig?.provenance, "client-default");
    assert.equal(advertiser?.provenance, "client-default");
    assert.equal(identity?.value, "id_ironworks");
    assert.equal(identity?.provenance, "client-default");
    assert.equal(customer?.value, "123-456-7890");

    const overridden = planIdentityChips(
      resolveChannelDefaults(ironworksRow(), { facebookPageId: "page_override" }),
    );
    const overridePage = overridden.find((chip) => chip.id === "meta-page");
    assert.equal(overridePage?.value, "page_override");
    assert.equal(overridePage?.provenance, "operator-override");
    assert.equal(overridePage?.href, null);

    const unset = planIdentityChips(
      resolveChannelDefaults(emptyChannelDefaultsRow("ironworks", "Ironworks")),
    );
    for (const chip of unset) {
      assert.equal(chip.provenance, "unset");
      assert.equal(chip.href, "/clients/ironworks");
      assert.equal(chip.value, null);
    }
  });
});

describe("single-resolver invariant", () => {
  it("preview apply and Prepare apply emit the same identity stack from one resolve", () => {
    const plan = goldenPlan();
    const resolved = resolveChannelDefaults(ironworksRow());
    const preview = collectPlanPreflight(plan, undefined, { stored: ironworksRow() });
    const preparedMeta = applyMetaChannelDefaults(planToMetaDraft(plan), resolved);
    const preparedTikTok = applyTikTokChannelDefaults(planToTikTokDraft(plan), resolved);
    const preparedGoogle = applyGoogleChannelDefaults(planToGoogleDraft(plan), resolved);

    assert.equal(preview.resolved.metaAdAccount.value, resolved.metaAdAccount.value);
    assert.equal(preview.resolved.metaPixel.value, resolved.metaPixel.value);
    assert.equal(preview.drafts.meta.settings.adAccountId, preparedMeta.settings.adAccountId);
    assert.equal(preview.drafts.meta.settings.pixelId, preparedMeta.settings.pixelId);
    assert.equal(preview.drafts.meta.settings.metaPageId, preparedMeta.settings.metaPageId);
    assert.equal(preview.drafts.meta.settings.metaIGAccountId, preparedMeta.settings.metaIGAccountId);
    assert.equal(preview.drafts.tiktok.accountSetup.advertiserId, preparedTikTok.accountSetup.advertiserId);
    assert.equal(preview.drafts.tiktok.accountSetup.identityId, preparedTikTok.accountSetup.identityId);
    assert.equal(
      preview.drafts.google.plan.google_ads_account_id,
      preparedGoogle.plan.google_ads_account_id,
    );
  });

  it("preflight and prepare-draft both call resolveChannelDefaults — no forked resolver", () => {
    const preflight = readFileSync("lib/plan/preflight.ts", "utf8");
    const prepare = readFileSync("app/api/plan/[id]/prepare-draft/route.ts", "utf8");
    const defaults = readFileSync("lib/clients/channel-defaults.ts", "utf8");
    assert.match(preflight, /from "\.\.\/clients\/channel-defaults\.ts"/);
    assert.match(preflight, /resolveChannelDefaults\(/);
    assert.match(preflight, /applyMetaChannelDefaults\(/);
    assert.match(prepare, /from "@\/lib\/clients\/channel-defaults"/);
    assert.match(prepare, /resolveChannelDefaults\(/);
    assert.match(prepare, /applyMetaChannelDefaults\(/);
    assert.match(defaults, /export function resolveChannelDefaults/);
    assert.equal((defaults.match(/export function resolveChannelDefaults/g) ?? []).length, 1);
    assert.doesNotMatch(preflight, /function resolveChannelDefaults/);
    assert.doesNotMatch(prepare, /function resolveChannelDefaults/);
  });
});
