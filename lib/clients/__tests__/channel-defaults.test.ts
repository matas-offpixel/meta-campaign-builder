import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { planToGoogleDraft } from "../../plan/adapters/google.ts";
import { planToMetaDraft } from "../../plan/adapters/meta.ts";
import { planToTikTokDraft } from "../../plan/adapters/tiktok.ts";
import { collectPlanPreflight } from "../../plan/preflight.ts";
import { IDLE_PLAN_LAUNCH, type CampaignPlan } from "../../plan/types.ts";
import {
  annotateChannelDefaultCures,
  applyGoogleChannelDefaults,
  applyMetaChannelDefaults,
  applyTikTokChannelDefaults,
  emptyChannelDefaultsRow,
  isClientChannelDefaultsColumnMissing,
  loadChannelDefaultsForEvent,
  loadClientChannelDefaults,
  resolveChannelDefaults,
  rowFromClientRecord,
} from "../channel-defaults.ts";

function goldenPlan(): CampaignPlan {
  const now = "2026-08-26T12:00:00.000Z";
  return {
    id: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    name: "BB26 Kayode",
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
      destinationUrl: "https://tickets.example.com/bb26",
      audienceClusterRef: "Music & Nightlife",
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

function filledRow() {
  return {
    ...emptyChannelDefaultsRow("client-1", "Black Butter"),
    metaAdAccountId: "act_111111",
    metaPixelId: "pixel_default",
    defaultPageId: "page_default",
    defaultInstagramActorId: "ig_default",
    tiktokAccountId: "tt_acc_1",
    tiktokAdvertiserId: "adv_default",
    tiktokIdentityId: "id_default",
    tiktokIdentityType: "TT_USER" as const,
    googleAdsAccountId: "ga_acc_1",
    googleAdsCustomerId: "123-456-7890",
  };
}

describe("resolveChannelDefaults precedence", () => {
  it("override > default > unset, and never invents", () => {
    const unset = resolveChannelDefaults(null);
    assert.equal(unset.facebookPage.provenance, "unset");
    assert.equal(unset.facebookPage.value, null);
    assert.equal(unset.tiktokAdvertiser.provenance, "unset");
    assert.equal(unset.tiktokIdentity.provenance, "unset");
    assert.equal(unset.googleAdsAccount.provenance, "unset");

    const fromClient = resolveChannelDefaults(filledRow());
    assert.equal(fromClient.facebookPage.provenance, "client-default");
    assert.equal(fromClient.facebookPage.value, "page_default");
    assert.equal(fromClient.tiktokAdvertiser.value, "adv_default");
    assert.equal(fromClient.tiktokIdentity.value?.id, "id_default");
    assert.equal(fromClient.googleAdsAccount.value, "ga_acc_1");
    assert.equal(fromClient.metaAdAccount.value, "act_111111");
    assert.equal(fromClient.metaPixel.value, "pixel_default");
    assert.equal(fromClient.metaPixel.provenance, "client-default");

    const overridden = resolveChannelDefaults(filledRow(), {
      facebookPageId: "page_override",
      tiktokAdvertiserId: "adv_override",
      tiktokIdentityId: "id_override",
      tiktokIdentityType: "AUTH_CODE",
      googleAdsAccountId: "ga_override",
    });
    assert.equal(overridden.facebookPage.provenance, "operator-override");
    assert.equal(overridden.facebookPage.value, "page_override");
    assert.equal(overridden.tiktokAdvertiser.provenance, "operator-override");
    assert.equal(overridden.tiktokAdvertiser.value, "adv_override");
    assert.equal(overridden.tiktokIdentity.provenance, "operator-override");
    assert.equal(overridden.tiktokIdentity.value?.id, "id_override");
    assert.equal(overridden.googleAdsAccount.provenance, "operator-override");
    assert.equal(overridden.instagramActor.provenance, "client-default");
  });

  it("rowFromClientRecord references joined advertiser/customer instead of copying new columns", () => {
    const row = rowFromClientRecord({
      id: "c1",
      name: "Client",
      default_page_ids: ["p1", "p2"],
      tiktok_account_id: "tt1",
      tiktok_accounts: { tiktok_advertiser_id: "adv_joined" },
      google_ads_account_id: "ga1",
      google_ads_accounts: { google_customer_id: "999" },
    });
    assert.equal(row.defaultPageId, "p1");
    assert.equal(row.tiktokAdvertiserId, "adv_joined");
    assert.equal(row.googleAdsCustomerId, "999");
    assert.equal(row.tiktokIdentityId, null);
  });
});

describe("apply* only fills empty fields", () => {
  it("New from plan drafts consume Meta / TikTok / Google defaults", () => {
    const plan = goldenPlan();
    const resolved = resolveChannelDefaults(filledRow());

    const meta = applyMetaChannelDefaults(planToMetaDraft(plan), resolved);
    assert.equal(meta.settings.adAccountId, "act_111111");
    assert.equal(meta.settings.metaAdAccountId, "act_111111");
    assert.equal(meta.settings.pixelId, "pixel_default");
    assert.equal(meta.settings.metaPixelId, "pixel_default");
    assert.equal(meta.settings.metaPageId, "page_default");
    assert.equal(meta.settings.metaIGAccountId, "ig_default");
    assert.equal(meta.creatives[0]?.identity.pageId, "page_default");
    assert.equal(meta.creatives[0]?.identity.instagramAccountId, "ig_default");
    assert.equal(meta.settings.channelDefaultsApplied?.facebookPage, true);
    assert.equal(meta.settings.channelDefaultsApplied?.instagramActor, true);

    const tiktok = applyTikTokChannelDefaults(planToTikTokDraft(plan), resolved);
    assert.equal(tiktok.accountSetup.advertiserId, "adv_default");
    assert.equal(tiktok.accountSetup.identityId, "id_default");
    assert.equal(tiktok.accountSetup.identityType, "TT_USER");

    const google = applyGoogleChannelDefaults(planToGoogleDraft(plan), resolved);
    assert.equal(google.plan.google_ads_account_id, "ga_acc_1");
  });

  it("library / already-set page, advertiser, identity, and Google account stay put", () => {
    const plan = goldenPlan();
    const resolved = resolveChannelDefaults(filledRow());

    const meta = planToMetaDraft(plan);
    meta.settings.metaPageId = "page_library";
    meta.creatives[0]!.identity.pageId = "page_library";
    const kept = applyMetaChannelDefaults(meta, resolved);
    assert.equal(kept.settings.metaPageId, "page_library");
    assert.equal(kept.creatives[0]?.identity.pageId, "page_library");
    assert.equal(kept.creatives[0]?.identity.instagramAccountId, "ig_default");

    const tiktok = planToTikTokDraft(plan);
    tiktok.accountSetup.advertiserId = "adv_existing";
    tiktok.accountSetup.identityId = "id_existing";
    tiktok.accountSetup.identityType = "AUTH_CODE";
    const tiktokKept = applyTikTokChannelDefaults(tiktok, resolved);
    assert.equal(tiktokKept.accountSetup.advertiserId, "adv_existing");
    assert.equal(tiktokKept.accountSetup.identityId, "id_existing");

    const google = planToGoogleDraft(plan);
    google.plan.google_ads_account_id = "ga_existing";
    assert.equal(
      applyGoogleChannelDefaults(google, resolved).plan.google_ads_account_id,
      "ga_existing",
    );
  });

  it("unset defaults leave adapter drafts identical to today", () => {
    const plan = goldenPlan();
    const resolved = resolveChannelDefaults(emptyChannelDefaultsRow("client-1", "Black Butter"));
    const meta = planToMetaDraft(plan);
    const applied = applyMetaChannelDefaults(meta, resolved);
    assert.equal(applied.settings.metaPageId, meta.settings.metaPageId);
    assert.equal(applied.creatives[0]?.identity.pageId, "");
    assert.equal(applied.settings.channelDefaultsApplied, undefined);

    const tiktok = applyTikTokChannelDefaults(planToTikTokDraft(plan), resolved);
    assert.equal(tiktok.accountSetup.advertiserId, null);
    assert.equal(tiktok.accountSetup.identityId, null);
  });
});

describe("preflight consumes defaults and names the cure when unset", () => {
  it("clears TikTok advertiser / identity and Google account blockers when defaults are set", () => {
    const withDefaults = collectPlanPreflight(goldenPlan(), undefined, {
      stored: filledRow(),
    });
    assert.equal(
      withDefaults.issues.some((issue) => /TikTok advertiser|TikTok identity|Google Ads account/i.test(issue.message)),
      false,
    );
    assert.equal(withDefaults.drafts.tiktok.accountSetup.advertiserId, "adv_default");
    assert.equal(withDefaults.drafts.tiktok.accountSetup.identityId, "id_default");
    assert.equal(withDefaults.drafts.google.plan.google_ads_account_id, "ga_acc_1");
    assert.equal(
      withDefaults.issues.some((issue) => /Facebook page ID is required/i.test(issue.message)),
      false,
    );
    assert.equal(
      withDefaults.issues.some((issue) => /Ad account ID must start|Ad account ID is required/i.test(issue.message)),
      false,
    );
    assert.equal(withDefaults.drafts.meta.settings.adAccountId, "act_111111");
  });

  it("rewrites unresolved blockers to name the client-settings cure", () => {
    const result = collectPlanPreflight(goldenPlan(), undefined, {
      stored: emptyChannelDefaultsRow("client-1", "Black Butter"),
    });
    const tiktokAdvertiser = result.issues.find((issue) =>
      /no default TikTok advertiser for Black Butter/.test(issue.message),
    );
    const tiktokIdentity = result.issues.find((issue) =>
      /no default TikTok identity for Black Butter/.test(issue.message),
    );
    const google = result.issues.find((issue) =>
      /no default Google Ads account for Black Butter/.test(issue.message),
    );
    const page = result.issues.find((issue) =>
      /no default Facebook page for Black Butter/.test(issue.message),
    );
    const adAccount = result.issues.find((issue) =>
      /no default Meta ad account for Black Butter/.test(issue.message),
    );
    assert.ok(tiktokAdvertiser);
    assert.ok(tiktokIdentity);
    assert.ok(google);
    assert.ok(page);
    assert.ok(adAccount);
    assert.equal(tiktokAdvertiser?.href, "/clients/client-1");
    assert.equal(tiktokIdentity?.href, "/clients/client-1");
    assert.equal(google?.href, "/clients/client-1");
    assert.equal(page?.href, "/clients/client-1");
    assert.equal(adAccount?.href, "/clients/client-1");
  });

  it("linked drafts are not re-applied — overrides already on the draft win", () => {
    const linked = planToTikTokDraft(goldenPlan());
    linked.accountSetup.advertiserId = "adv_linked";
    linked.accountSetup.identityId = "id_linked";
    linked.accountSetup.identityType = "AUTH_CODE";
    const result = collectPlanPreflight(goldenPlan(), { tiktok: linked }, { stored: filledRow() });
    assert.equal(result.drafts.tiktok.accountSetup.advertiserId, "adv_linked");
    assert.equal(result.drafts.tiktok.accountSetup.identityId, "id_linked");
  });

  it("without a client row, messages stay identical to today's validators", () => {
    const result = collectPlanPreflight(goldenPlan());
    assert.ok(result.issues.some((issue) => issue.message === "TikTok advertiser is required"));
    assert.ok(
      result.issues.some((issue) =>
        issue.message.includes("Select a TikTok identity"),
      ),
    );
    assert.ok(
      result.issues.some((issue) =>
        issue.message.includes("Pick a Google Ads account before continuing"),
      ),
    );
    assert.equal(result.issues.every((issue) => !issue.href), true);
  });
});

describe("annotateChannelDefaultCures", () => {
  it("uses the exact cure copy and client-settings href", () => {
    const cured = annotateChannelDefaultCures(
      [
        { id: "a", message: "TikTok advertiser is required" },
        { id: "b", message: "Select a TikTok identity (manual display names cannot be launched)" },
        { id: "c", message: "Pick a Google Ads account before continuing." },
        { id: "d", message: "Ad 1: Facebook page ID is required" },
        { id: "e", message: "something else" },
        { id: "f", message: "Ad account ID is required (e.g. act_1234567890)" },
        { id: "g", message: 'Ad account ID must start with "act_"' },
      ],
      { id: "client-1", name: "Black Butter" },
    );
    assert.equal(
      cured[0]?.message,
      "no default TikTok advertiser for Black Butter — set it in client settings",
    );
    assert.equal(
      cured[1]?.message,
      "no default TikTok identity for Black Butter — set it in client settings",
    );
    assert.equal(
      cured[2]?.message,
      "no default Google Ads account for Black Butter — set it in client settings",
    );
    assert.equal(
      cured[3]?.message,
      "no default Facebook page for Black Butter — set it in client settings",
    );
    assert.equal(cured[4]?.message, "something else");
    assert.equal(
      cured[5]?.message,
      "no default Meta ad account for Black Butter — set it in client settings",
    );
    assert.equal(
      cured[6]?.message,
      "no default Meta ad account for Black Butter — set it in client settings",
    );
    assert.equal(cured[0]?.href, "/clients/client-1");
    assert.equal(cured[4]?.href, undefined);
    assert.equal(cured[1]?.href, "/clients/client-1");
    assert.equal(cured[5]?.href, "/clients/client-1");
  });
});

describe("migration-absent runtime degrades to today", () => {
  it("treats Postgres 42703 / missing-column errors as the new columns being absent", () => {
    assert.equal(isClientChannelDefaultsColumnMissing({ code: "42703" }), true);
    assert.equal(
      isClientChannelDefaultsColumnMissing({
        message: 'column "default_instagram_actor_id" does not exist',
      }),
      true,
    );
    assert.equal(isClientChannelDefaultsColumnMissing({ message: "permission denied" }), false);
    assert.equal(isClientChannelDefaultsColumnMissing(null), false);
  });

  it("loadClientChannelDefaults retries the legacy select without identity columns", async () => {
    let selects = 0;
    const supabase = {
      from() {
        return {
          select(cols: string) {
            return {
              eq() {
                return {
                  async maybeSingle() {
                    selects += 1;
                    if (cols.includes("default_instagram_actor_id")) {
                      return {
                        data: null,
                        error: { code: "42703", message: "column does not exist" },
                      };
                    }
                    return {
                      data: {
                        id: "client-1",
                        name: "Black Butter",
                        default_page_ids: ["page_legacy"],
                        tiktok_account_id: "tt_acc_1",
                        tiktok_accounts: { tiktok_advertiser_id: "adv_legacy" },
                        google_ads_account_id: "ga_acc_1",
                        google_ads_accounts: { google_customer_id: "111" },
                      },
                      error: null,
                    };
                  },
                };
              },
            };
          },
        };
      },
    };
    const row = await loadClientChannelDefaults(supabase, "client-1");
    assert.equal(selects, 2);
    assert.equal(row?.defaultPageId, "page_legacy");
    assert.equal(row?.tiktokAdvertiserId, "adv_legacy");
    assert.equal(row?.tiktokIdentityId, null);
    assert.equal(row?.defaultInstagramActorId, null);
  });

  it("loadChannelDefaultsForEvent treats event account FKs as operator overrides", async () => {
    const supabase = {
      from(table: string) {
        return {
          select() {
            return {
              eq(_col: string, value: string) {
                return {
                  async maybeSingle() {
                    if (table === "events") {
                      return {
                        data: {
                          client_id: "client-1",
                          tiktok_account_id: "tt_event",
                          google_ads_account_id: "ga_event",
                        },
                        error: null,
                      };
                    }
                    if (table === "clients") {
                      return {
                        data: {
                          id: "client-1",
                          name: "Black Butter",
                          default_page_ids: ["page_default"],
                          tiktok_account_id: "tt_acc_1",
                          default_tiktok_identity_id: "id_default",
                          default_tiktok_identity_type: "TT_USER",
                          tiktok_accounts: { tiktok_advertiser_id: "adv_client" },
                          google_ads_account_id: "ga_acc_1",
                          google_ads_accounts: { google_customer_id: "111" },
                        },
                        error: null,
                      };
                    }
                    if (table === "tiktok_accounts" && value === "tt_event") {
                      return { data: { tiktok_advertiser_id: "adv_event" }, error: null };
                    }
                    if (table === "google_ads_accounts" && value === "ga_event") {
                      return { data: { google_customer_id: "222" }, error: null };
                    }
                    return { data: null, error: null };
                  },
                };
              },
            };
          },
        };
      },
    };
    const loaded = await loadChannelDefaultsForEvent(supabase, "event-1");
    assert.ok(loaded);
    const resolved = resolveChannelDefaults(loaded!.stored, loaded!.overrides);
    assert.equal(resolved.tiktokAccount.provenance, "operator-override");
    assert.equal(resolved.tiktokAccount.value, "tt_event");
    assert.equal(resolved.tiktokAdvertiser.value, "adv_event");
    assert.equal(resolved.tiktokIdentity.provenance, "unset");
    assert.equal(resolved.googleAdsAccount.value, "ga_event");
    assert.equal(resolved.googleAdsCustomer.value, "222");
    assert.equal(resolved.facebookPage.provenance, "client-default");
  });
});

describe("source-guards — consumers and settings reuse existing pickers", () => {
  it("prepare-draft applies defaults after prefill and library overlay", () => {
    const route = readFileSync("app/api/plan/[id]/prepare-draft/route.ts", "utf8");
    assert.match(route, /withMetaDefaults/);
    assert.match(route, /withTikTokDefaults/);
    assert.match(route, /withGoogleDefaults/);
    assert.match(route, /applyMetaChannelDefaults/);
    assert.match(route, /applyTikTokChannelDefaults/);
    assert.match(route, /loadChannelDefaultsForEvent/);
  });

  it("preflight loads event/client defaults and passes them in", () => {
    const route = readFileSync("app/api/plan/preflight/route.ts", "utf8");
    assert.match(route, /loadChannelDefaultsForEvent/);
    assert.match(route, /collectPlanPreflight\(plan, linked, channel\)/);
    const preflight = readFileSync("lib/plan/preflight.ts", "utf8");
    assert.match(preflight, /annotateChannelDefaultCures/);
    assert.match(preflight, /applyMetaChannelDefaults/);
    assert.match(preflight, /resolveChannelDefaults/);
    assert.match(preflight, /drafts, resolved/);
    const defaults = readFileSync("lib/clients/channel-defaults.ts", "utf8");
    assert.match(defaults, /normalizeAdAccountId/);
    assert.doesNotMatch(defaults, /act_\$\{/);
  });

  it("migration 160 is additive, unapplied, and does not duplicate existing account columns", () => {
    const sql = readFileSync(
      "supabase/migrations/160_client_channel_identity_defaults.sql",
      "utf8",
    );
    assert.match(sql, /Do not apply in this run/);
    assert.match(sql, /default_instagram_actor_id/);
    assert.match(sql, /default_tiktok_identity_id/);
    assert.match(sql, /default_tiktok_identity_type/);
    assert.match(sql, /default_tiktok_identity_bc_id/);
    assert.doesNotMatch(sql, /add column if not exists default_page_ids/);
    assert.doesNotMatch(sql, /add column if not exists tiktok_account_id/);
    assert.doesNotMatch(sql, /add column if not exists meta_ad_account_id/);
    assert.doesNotMatch(sql, /add column if not exists google_ads_account_id/);
  });

  it("Channel Defaults card reuses wizard page Combobox and TikTok identity fetch", () => {
    const card = readFileSync(
      "components/dashboard/clients/channel-defaults-card.tsx",
      "utf8",
    );
    assert.match(card, /useFetchPages/);
    assert.match(card, /\/api\/tiktok\/identities/);
    assert.doesNotMatch(card, /new picker/);
    const detail = readFileSync("components/dashboard/clients/client-detail.tsx", "utf8");
    assert.match(detail, /ChannelDefaultsCard/);
    const creatives = readFileSync("components/steps/creatives.tsx", "utf8");
    assert.match(creatives, /Auto-picked from client defaults/);
    const workspace = readFileSync("components/plan/plan-workspace.tsx", "utf8");
    assert.match(workspace, /issue\.href/);
    assert.match(workspace, /set it in client settings|issue\.href/);
    assert.match(workspace, /PlanIdentityChips/);
    assert.match(workspace, /json\.resolved/);
  });
});
