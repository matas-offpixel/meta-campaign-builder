/**
 * [DHB26-DUBAI] Deep House Bible Dubai — Announce, captured 2026-09-25.
 * 21 ad sets (12 custom-audience, 6 interest, 3 geo-and-age only with
 * countries, 2 on `country_groups`), 105 ads, 25 creatives.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  metaImportDeselectAll,
  metaImportSelectAll,
  metaImportTickedLine,
} from "../../../../components/meta/meta-import-flow.ts";
import { metaAdAccountPickerOptions } from "../../account-picker-options.ts";
import { validateStep } from "../../../validation.ts";
import type { CampaignDraft, MetaAdAccount } from "../../../types.ts";
import {
  META_IMPORT_CARRY_KEY_REJECTED,
  formatRejectedMetaCarryKeys,
  mapMetaLiveCampaign,
} from "../map.ts";
import { buildMetaImportPicker, defaultMetaImportCarry } from "../picker.ts";
import { readMetaLiveCampaign } from "../readers.ts";
import { handleMetaImport, insertImportedDraft } from "../save.ts";
import type { MetaImportRecordedCall, MetaImportRequest, MetaLiveCampaignBundle } from "../types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const CAPTURED = join(HERE, "../__fixtures__/captured");
const CAMPAIGN_ID = "120249957259050453";
const ACCOUNT = "act_968594768066330";
const OPERATOR = "b3ee4e5c-44e6-4684-acf6-efefbecd5858";
const AUDIENCES_STEP = 3;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Capture = { calls: MetaImportRecordedCall[] };

function requestFromCapture(capture: Capture): MetaImportRequest {
  const gets = capture.calls.filter((call) => call.method === "GET");
  const posts = capture.calls.filter((call) => call.method === "POST");
  let postAt = 0;
  return {
    get: async (path, params) => {
      const after = params.after ?? "";
      const call = gets.find(
        (row) => row.path === path && String(row.params.after ?? "") === after,
      );
      if (!call) throw new Error(`no recorded GET ${path} after=${after}`);
      return call.data;
    },
    post: async () => {
      const call = posts[postAt % posts.length];
      postAt += 1;
      if (!call) throw new Error("no recorded POST");
      return call.data;
    },
  };
}

function readCaptured(): Promise<MetaLiveCampaignBundle> {
  const capture = JSON.parse(
    readFileSync(join(CAPTURED, `meta-import-capture-${CAMPAIGN_ID}.json`), "utf8"),
  ) as Capture;
  return readMetaLiveCampaign({
    adAccountId: ACCOUNT,
    campaignId: CAMPAIGN_ID,
    token: "token",
    request: requestFromCapture(capture),
    sleep: async () => {},
  });
}

function capturedAccountRow(): MetaAdAccount {
  return (
    JSON.parse(readFileSync(join(CAPTURED, "../meta-ad-account-968594768066330.json"), "utf8")) as {
      row: MetaAdAccount;
    }
  ).row;
}

/** The captured ad sets that carry geo and age and nothing else. */
function broadOnly(bundle: MetaLiveCampaignBundle): MetaLiveCampaignBundle {
  const adSets = bundle.adSets.filter((row) => {
    const targeting = row.targeting as Record<string, unknown>;
    const geo = targeting.geo_locations as { countries?: unknown[] } | undefined;
    return (
      !targeting.custom_audiences &&
      !targeting.interests &&
      !("flexible_spec" in targeting) &&
      (geo?.countries?.length ?? 0) > 0
    );
  });
  return { ...bundle, adSets };
}

function importDraft(bundle: MetaLiveCampaignBundle, carry?: string[]): CampaignDraft {
  return mapMetaLiveCampaign({
    bundle,
    adAccountId: ACCOUNT,
    carry: carry ?? defaultMetaImportCarry(buildMetaImportPicker(bundle)),
    availability: [],
  });
}

describe("DHB capture", () => {
  const bundlePromise = readCaptured();

  it("reads 21 ad sets, 105 ads and 25 creatives", async () => {
    const bundle = await bundlePromise;
    assert.equal(bundle.adSets.length, 21);
    assert.equal(bundle.ads.length, 105);
    assert.equal(Object.keys(bundle.creatives).length, 25);
  });

  it("the full campaign already has an audience source: six interest ad sets", async () => {
    const draft = importDraft(await bundlePromise);
    assert.equal(draft.audiences.interestGroups.length, 6);
    assert.equal(validateStep(AUDIENCES_STEP, draft).valid, true);
  });

  describe("audiences step", () => {
    it("an imported draft whose ad sets carry geo and age but no source passes", async () => {
      const draft = importDraft(broadOnly(await bundlePromise));
      assert.equal(draft.adSetSuggestions.length, 3);
      assert.equal(draft.audiences.interestGroups.length, 0);
      assert.equal(draft.audiences.customAudienceGroups.length, 0);
      assert.equal(draft.audiences.pageGroups.length, 0);
      assert.equal(draft.audiences.savedAudiences.audienceIds.length, 0);
      assert.equal(draft.adSetSuggestions.every((row) => row.importedFromAdSetId), true);
      assert.deepEqual(validateStep(AUDIENCES_STEP, draft), { valid: true, errors: [] });
    });

    it("a hand-built draft with no audience source still fails", async () => {
      const draft = importDraft(broadOnly(await bundlePromise));
      const handBuilt: CampaignDraft = {
        ...draft,
        importMeta: undefined,
        adSetSuggestions: draft.adSetSuggestions.map((row) => ({ ...row, importedFromAdSetId: undefined })),
      };
      const result = validateStep(AUDIENCES_STEP, handBuilt);
      assert.equal(result.valid, false);
      assert.ok(result.errors.includes("Select at least one audience source"));
    });

    it("imported rows with no place do not count", async () => {
      const draft = importDraft(broadOnly(await bundlePromise));
      const placeless: CampaignDraft = {
        ...draft,
        adSetSuggestions: draft.adSetSuggestions.map((row) => ({ ...row, locationGroupIds: [] })),
      };
      assert.equal(validateStep(AUDIENCES_STEP, placeless).valid, false);
    });

    it("a mixed draft passes: imported rows plus an audience the operator added", async () => {
      const draft = importDraft(broadOnly(await bundlePromise));
      const mixed: CampaignDraft = {
        ...draft,
        audiences: {
          ...draft.audiences,
          interestGroups: [
            { id: "added", name: "Added", interests: [{ id: "6003", name: "House music" }] },
          ],
        },
      };
      assert.equal(validateStep(AUDIENCES_STEP, mixed).valid, true);
    });
  });

  describe("carry", () => {
    it("20 ticked ids carry 20 creatives and report none as unticked", async () => {
      const bundle = await bundlePromise;
      const carry = defaultMetaImportCarry(buildMetaImportPicker(bundle));
      assert.equal(carry.length, 20);
      const draft = importDraft(bundle, carry);
      assert.equal(draft.creatives.length, 20);
      assert.deepEqual(
        draft.creatives.map((row) => row.id).sort(),
        [...carry].sort(),
      );
      const reasons = draft.importMeta!.notCarried.map((row) => row.reason);
      assert.equal(reasons.filter((reason) => reason === "operator_unticked").length, 0);
      assert.equal(reasons.filter((reason) => reason === "no_asset_reported").length, 5);
    });

    it("a key the mapper cannot match is rejected with the key, never unticked", async () => {
      const bundle = await bundlePromise;
      const carry = defaultMetaImportCarry(buildMetaImportPicker(bundle));
      const stray = "999000111222333";
      const draft = importDraft(bundle, [...carry, stray]);
      const row = draft.importMeta!.notCarried.find((entry) => entry.id === stray);
      assert.deepEqual(row, { id: stray, name: stray, reason: META_IMPORT_CARRY_KEY_REJECTED });
      assert.equal(
        draft.importMeta!.notCarried.some(
          (entry) => entry.reason === "operator_unticked" && entry.id === stray,
        ),
        false,
      );
      assert.equal(draft.creatives.length, 20);
    });

    it("the route refuses a carry with a rejected key, names it, and saves nothing", async () => {
      const bundle = await bundlePromise;
      const carry = defaultMetaImportCarry(buildMetaImportPicker(bundle));
      const stray = "999000111222333";
      let saved = 0;
      const result = await handleMetaImport({
        userId: OPERATOR,
        body: { adAccountId: ACCOUNT, campaignId: CAMPAIGN_ID, carry: [...carry, stray], eventId: "e1" },
        supabase: {} as never,
        deps: {
          tokenForUser: async () => ({ token: "t" }),
          clientIdForAccount: async () => "client",
          loadEvent: async () =>
            ({ id: "e1", client_id: "client", meta_ad_account_id: ACCOUNT }) as never,
          readCampaign: async () => bundle,
          saveDraft: async () => {
            saved += 1;
          },
        },
      });
      assert.equal(result.status, 400);
      assert.equal(result.body.error, formatRejectedMetaCarryKeys([stray]));
      assert.match(String(result.body.error), /999000111222333/);
      assert.equal(saved, 0);
    });
  });

  describe("save", () => {
    const deps = (bundle: MetaLiveCampaignBundle) => ({
      tokenForUser: async () => ({ token: "t" }),
      clientIdForAccount: async () => "client",
      loadEvent: async () =>
        ({ id: "e1", client_id: "client", meta_ad_account_id: ACCOUNT }) as never,
      readCampaign: async () => bundle,
      countryGroupLabels: async () => ({}),
    });

    it("stores a uuid draft id with the operator's session client", async () => {
      const bundle = await bundlePromise;
      const inserts: { table: string; row: Record<string, unknown> }[] = [];
      const supabase = {
        from: (table: string) => ({
          insert: async (row: Record<string, unknown>) => {
            inserts.push({ table, row });
            return { error: null };
          },
        }),
      };
      const result = await handleMetaImport({
        userId: OPERATOR,
        body: {
          adAccountId: ACCOUNT,
          campaignId: CAMPAIGN_ID,
          carry: defaultMetaImportCarry(buildMetaImportPicker(bundle)),
          eventId: "e1",
        },
        supabase: supabase as never,
        deps: deps(bundle),
      });
      assert.equal(result.status, 200);
      assert.equal(result.body.saved, true);
      assert.match(String(result.body.draftId), UUID);
      assert.equal(inserts.length, 1);
      assert.equal(inserts[0]!.table, "campaign_drafts");
      assert.equal(inserts[0]!.row.id, result.body.draftId);
      assert.equal(inserts[0]!.row.user_id, OPERATOR);
      assert.equal(inserts[0]!.row.ad_account_id, ACCOUNT);
    });

    it("a failed write reaches the response instead of saved: true", async () => {
      const bundle = await bundlePromise;
      const supabase = {
        from: () => ({
          insert: async () => ({
            error: { message: 'invalid input syntax for type uuid: "import:120249957259050453"' },
          }),
        }),
      };
      const result = await handleMetaImport({
        userId: OPERATOR,
        body: {
          adAccountId: ACCOUNT,
          campaignId: CAMPAIGN_ID,
          carry: defaultMetaImportCarry(buildMetaImportPicker(bundle)),
          eventId: "e1",
        },
        supabase: supabase as never,
        deps: deps(bundle),
      });
      assert.equal(result.status, 500);
      assert.equal(result.body.saved, false);
      assert.equal(
        result.body.error,
        'Draft save failed: invalid input syntax for type uuid: "import:120249957259050453"',
      );
    });

    it("insertImportedDraft throws on a write error", async () => {
      const draft = importDraft(await bundlePromise);
      const supabase = {
        from: () => ({ insert: async () => ({ error: { message: "denied" } }) }),
      };
      await assert.rejects(
        insertImportedDraft(supabase as never, draft, OPERATOR),
        /Draft save failed: denied/,
      );
    });
  });

  describe("ad account", () => {
    it("the stored account is one of the Step 1 picker's option values", async () => {
      const bundle = await bundlePromise;
      const values = metaAdAccountPickerOptions([capturedAccountRow()]).map((row) => row.value);
      const bare = String(bundle.campaign.account_id);
      for (const input of [ACCOUNT, bare, ` ${ACCOUNT} `]) {
        const draft = mapMetaLiveCampaign({
          bundle,
          adAccountId: input,
          carry: [],
          availability: [],
        });
        assert.ok(values.includes(draft.settings.adAccountId), `${input} → ${draft.settings.adAccountId}`);
        assert.ok(values.includes(draft.settings.metaAdAccountId!), `${input} → ${draft.settings.metaAdAccountId}`);
        assert.equal(draft.settings.adAccountId.startsWith("act_act_"), false);
      }
    });
  });

  describe("country groups", () => {
    it("keeps country ad sets as countries and round-trips europe as a group key", async () => {
      const draft = importDraft(await bundlePromise);
      const groups = draft.budgetSchedule.locationGroups ?? [];

      for (const name of ["DHB Primary – EU", "Wide – EU"]) {
        const row = draft.adSetSuggestions.find((item) => item.name === name);
        assert.ok(row, name);
        const selected = groups.filter((group) => row.locationGroupIds?.includes(group.id));
        assert.equal(selected.length, 1, name);
        const sel = selected[0]?.selections[0];
        assert.equal(sel?.locationType, "country_group");
        assert.equal(sel?.locationKey, "europe");
        assert.equal(sel?.countryCode, undefined);
        assert.equal(sel?.label, "europe");
        assert.equal(sel?.memberCountryCodes, undefined);
      }

      const unresolved = (draft.importMeta?.dropped ?? []).filter((row) => row.field === "label_unresolved");
      assert.deepEqual(
        unresolved.map((row) => row.adSetName).sort(),
        ["DHB Primary – EU", "Wide – EU"],
      );
      assert.ok(unresolved.every((row) => row.value === "europe"));
      assert.equal(
        (draft.importMeta?.dropped ?? []).some((row) => row.field === "country_groups"),
        false,
      );

      const v2 = draft.adSetSuggestions.find((item) => item.name === "Wide – V2");
      assert.ok(v2);
      const v2Groups = groups.filter((group) => v2.locationGroupIds?.includes(group.id));
      assert.deepEqual(
        v2Groups.flatMap((group) => group.selections.map((sel) => [sel.locationType, sel.countryCode])),
        [["country", "AE"]],
      );
    });

    it("a label lookup names Europe and stores the member codes", async () => {
      const bundle = await bundlePromise;
      const draft = mapMetaLiveCampaign({
        bundle,
        adAccountId: ACCOUNT,
        carry: defaultMetaImportCarry(buildMetaImportPicker(bundle)),
        availability: [],
        countryGroupLabels: { europe: { name: "Europe", countryCodes: ["GB", "FR"] } },
      });
      const row = draft.adSetSuggestions.find((item) => item.name === "Wide – EU");
      assert.ok(row);
      const group = (draft.budgetSchedule.locationGroups ?? []).find((item) =>
        row.locationGroupIds?.includes(item.id),
      );
      const sel = group?.selections[0];
      assert.equal(sel?.label, "Europe");
      assert.equal(sel?.locationKey, "europe");
      assert.deepEqual(sel?.memberCountryCodes, ["GB", "FR"]);
      assert.equal(
        (draft.importMeta?.dropped ?? []).some((item) => item.field === "label_unresolved"),
        false,
      );
    });

    it("an excluded country group lands in the exclusion pool", async () => {
      const bundle = structuredClone(await bundlePromise);
      const eu = bundle.adSets.find((row) => row.name === "Wide – EU");
      assert.ok(eu);
      const targeting = eu.targeting as { excluded_geo_locations?: { country_groups: string[] } };
      targeting.excluded_geo_locations = { country_groups: ["eea"] };
      const draft = importDraft(bundle);
      const row = draft.adSetSuggestions.find((item) => item.name === "Wide – EU");
      assert.deepEqual(row?.excludedLocationIds, ["excl:country_group:eea"]);
      const pooled = (draft.budgetSchedule.excludedLocations ?? []).find(
        (sel) => sel.locationKey === "eea",
      );
      assert.equal(pooled?.locationType, "country_group");
      assert.equal(pooled?.mode, "exclude");
      assert.equal(pooled?.label, "eea");
    });
  });

  describe("picker select all", () => {
    it("ticks every carriable row and no asset-less row; deselect clears", async () => {
      const picker = buildMetaImportPicker(await bundlePromise);
      const disabled = picker.rows.filter((row) => row.disabled).map((row) => row.key);
      assert.equal(disabled.length, 5);

      const all = metaImportSelectAll(picker.rows);
      assert.equal(all.size, 20);
      for (const key of disabled) assert.equal(all.has(key), false);
      assert.deepEqual([...all].sort(), defaultMetaImportCarry(picker).sort());
      assert.equal(metaImportTickedLine(all, picker.rows), "20 of 20 ticked");

      const none = metaImportDeselectAll();
      assert.equal(none.size, 0);
      assert.equal(metaImportTickedLine(none, picker.rows), "0 of 20 ticked");
    });
  });
});
