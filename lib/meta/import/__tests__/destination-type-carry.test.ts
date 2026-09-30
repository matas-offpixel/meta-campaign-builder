/**
 * The importer carries a source ad set's `destination_type`, and a relaunch of
 * an imported campaign sends WEBSITE on every website-bound ad set.
 *
 * Two captured campaigns cover both states Meta can return:
 *
 *   120249957259050453  [DHB26-DUBAI] Announce (OUTCOME_LEADS) — all 21 ad
 *                       sets read "UNDEFINED". This is the damage: the ad set
 *                       carries no destination, so Ads Manager shows one the
 *                       launcher never chose. Every row must be named on
 *                       `dropped` as destination_type_defaulted, and relaunch
 *                       must send WEBSITE.
 *   52522388611107      [IRW0001] Jamie Jones (OUTCOME_LEADS) — all 30 ad sets
 *                       read "WEBSITE". Carried through verbatim, no note.
 *
 * Run: node --test lib/meta/import/__tests__/destination-type-carry.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { buildAdSetPayload, resolveAdSetDestinationType } from "../../adset.ts";
import { mapMetaLiveCampaign } from "../map.ts";
import { buildMetaImportPicker, defaultMetaImportCarry } from "../picker.ts";
import { readMetaLiveCampaign } from "../readers.ts";
import type { MetaImportRecordedCall, MetaImportRequest, MetaLiveCampaignBundle } from "../types.ts";
import type { CampaignDraft } from "../../../types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const CAPTURED = join(HERE, "../__fixtures__/captured");

const DHB = { campaignId: "120249957259050453", account: "act_968594768066330" };
const IRONWORKS = { campaignId: "52522388611107", account: "act_1967530076312" };

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

async function load(fixture: { campaignId: string; account: string }) {
  const capture = JSON.parse(
    readFileSync(join(CAPTURED, `meta-import-capture-${fixture.campaignId}.json`), "utf8"),
  ) as Capture;
  const bundle = await readMetaLiveCampaign({
    adAccountId: fixture.account,
    campaignId: fixture.campaignId,
    token: "token",
    request: requestFromCapture(capture),
    sleep: async () => {},
  });
  return bundle;
}

function importDraft(
  bundle: MetaLiveCampaignBundle,
  adAccountId: string,
): CampaignDraft {
  return mapMetaLiveCampaign({
    bundle,
    adAccountId,
    carry: defaultMetaImportCarry(buildMetaImportPicker(bundle)),
    availability: [],
  });
}

function relaunchPayloads(draft: CampaignDraft) {
  return draft.adSetSuggestions.map((adSet) =>
    buildAdSetPayload(
      adSet,
      "cam_relaunch",
      draft.audiences,
      draft.budgetSchedule,
      draft.settings.optimisationGoal,
      draft.settings.objective,
    ),
  );
}

describe("importer carries destination_type — DHB (every ad set UNDEFINED)", () => {
  const bundlePromise = load(DHB);

  it("records Meta's literal UNDEFINED on every imported ad set", async () => {
    const bundle = await bundlePromise;
    assert.equal(bundle.adSets.length, 21);
    const draft = importDraft(bundle, DHB.account);
    assert.equal(draft.adSetSuggestions.length, 21);
    assert.equal(
      draft.adSetSuggestions.every((row) => row.importedDestinationType === "UNDEFINED"),
      true,
      "every DHB ad set was captured as UNDEFINED",
    );
  });

  it("names every ad set on dropped[] as destination_type_defaulted", async () => {
    const draft = importDraft(await bundlePromise, DHB.account);
    const notes = (draft.importMeta?.dropped ?? []).filter(
      (row) => row.field === "destination_type_defaulted",
    );
    assert.equal(notes.length, 21);
    assert.equal(
      notes.every((row) => Boolean(row.adSetId) && Boolean(row.adSetName)),
      true,
      "each note must name the ad set it belongs to",
    );
  });

  it("no longer reports destination_type as an uncarriable field", async () => {
    const draft = importDraft(await bundlePromise, DHB.account);
    const uncarriable = (draft.importMeta?.dropped ?? []).filter(
      (row) => row.field === "destination_type",
    );
    assert.deepEqual(uncarriable, []);
  });

  it("relaunch sends WEBSITE on all 21 ad sets — the UNDEFINED is corrected, not copied", async () => {
    const draft = importDraft(await bundlePromise, DHB.account);
    assert.equal(draft.settings.objective, "registration");
    const payloads = relaunchPayloads(draft);
    assert.equal(payloads.length, 21);
    const wrong = payloads.filter((p) => p.destination_type !== "WEBSITE");
    assert.deepEqual(
      wrong.map((p) => p.name),
      [],
      "every relaunched ad set must carry WEBSITE",
    );
  });

  it("DHB Primary 2 — the ad set from the report — relaunches as WEBSITE", async () => {
    const draft = importDraft(await bundlePromise, DHB.account);
    const row = draft.adSetSuggestions.find((r) => r.name === "DHB Primary 2");
    assert.ok(row, "DHB Primary 2 is in the capture");
    assert.equal(row.importedDestinationType, "UNDEFINED");
    assert.equal(
      resolveAdSetDestinationType(draft.settings.objective, draft.settings.optimisationGoal),
      "WEBSITE",
    );
  });
});

describe("importer carries destination_type — Ironworks (every ad set WEBSITE)", () => {
  const bundlePromise = load(IRONWORKS);

  it("carries WEBSITE through verbatim", async () => {
    const draft = importDraft(await bundlePromise, IRONWORKS.account);
    assert.ok(draft.adSetSuggestions.length >= 30);
    assert.equal(
      draft.adSetSuggestions.every((row) => row.importedDestinationType === "WEBSITE"),
      true,
    );
  });

  it("adds no destination_type_defaulted note — nothing was defaulted", async () => {
    const draft = importDraft(await bundlePromise, IRONWORKS.account);
    const notes = (draft.importMeta?.dropped ?? []).filter(
      (row) => row.field === "destination_type_defaulted",
    );
    assert.deepEqual(notes, []);
  });

  it("relaunch preserves WEBSITE on every ad set", async () => {
    const draft = importDraft(await bundlePromise, IRONWORKS.account);
    const payloads = relaunchPayloads(draft);
    assert.equal(
      payloads.every((p) => p.destination_type === "WEBSITE"),
      true,
    );
  });
});
