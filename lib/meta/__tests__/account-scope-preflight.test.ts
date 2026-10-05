import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { createDefaultCreative, createDefaultDraft } from "../../campaign-defaults.ts";
import { validateStep } from "../../validation.ts";
import { foreignAccountLaunchError } from "../account-scope-preflight.ts";
import type { WizardMode } from "../../types.ts";
import type { AdSetSuggestion } from "../../types.ts";

const LAUNCH = "act_606252931141334";
const OTHER = "act_1073273492854557";
const LEGACY_VIDEO = "111111111111111";
const IMPORTED_VIDEO = "987654321098765";
const FOREIGN_VIDEO = "222222222222222";
const AUDIENCE = "120250867495400239";

function audienceIdAt(index: number): string {
  return `12025119144823${String(index).padStart(4, "0")}`;
}

const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../__fixtures__/account-scope/adimages-hashes.json", import.meta.url)),
    "utf8",
  ),
) as {
  hashes: string[];
  pages: unknown[];
};

function draftWith(input: {
  audienceId?: string;
  audienceNames?: string[];
  imageHash?: string;
  videoId?: string;
  wizardMode?: WizardMode;
}) {
  const draft = createDefaultDraft();
  draft.settings.adAccountId = LAUNCH;
  draft.settings.metaAdAccountId = LAUNCH;
  if (input.wizardMode) draft.settings.wizardMode = input.wizardMode;
  if (input.audienceId || input.audienceNames) {
    const names = input.audienceNames ?? [];
    draft.audiences.pageGroups = [
      {
        id: "group-1",
        name: "Similar Pages",
        pageIds: ["111"],
        engagementTypes: ["ig_engagement_365d"],
        lookalike: false,
        lookalikeRanges: [],
        customAudienceIds: [],
        engagementAudienceIds: [
          ...(input.audienceId ? [input.audienceId] : []),
          ...names.map((_, index) => audienceIdAt(index)),
        ],
        engagementAudienceStatuses: names.map((pageName, index) => ({
          id: audienceIdAt(index),
          type: "ig_engagement_365d" as const,
          pageId: "111",
          pageName,
          createdAt: "2026-01-01T00:00:00.000Z",
          readyForLookalike: true,
          populating: false,
        })),
      },
    ];
    draft.adSetSuggestions = [
      {
        id: "adset-main",
        name: "Similar Pages",
        sourceType: "page_group",
        sourceId: "group-1",
        sourceName: "Similar Pages",
        ageMin: 18,
        ageMax: 65,
        budgetPerDay: 20,
        advantagePlus: true,
        enabled: true,
      },
    ];
  }
  if (input.imageHash || input.videoId) {
    const creative = createDefaultCreative();
    creative.name = "Artwork";
    creative.mediaType = input.videoId ? "video" : "image";
    const asset = creative.assetVariations[0]!.assets[0]!;
    asset.fileName = input.videoId ? "clip.mp4" : "poster.jpg";
    asset.uploadStatus = "uploaded";
    if (input.imageHash) asset.assetHash = input.imageHash;
    if (input.videoId) asset.videoId = input.videoId;
    draft.creatives = [creative];
  }
  return draft;
}

async function launch(input: {
  audienceId?: string;
  audienceNames?: string[];
  imageHash?: string;
  videoId?: string;
  wizardMode?: WizardMode;
  adAccountId?: string;
  graphGet?: (path: string, params: Record<string, string>, token: string) => Promise<unknown>;
  graphMultiGet?: () => Promise<Record<string, { account_id?: string } | undefined>>;
  listAccountNames?: () => Promise<ReadonlyMap<string, string>>;
  listVideoScopes?: () => Promise<
    | { ok: true; rows: { platformId: string; scope: string }[] }
    | { ok: false; tableMissing: boolean; error: string }
  >;
  fetchNext?: (url: string) => Promise<unknown>;
}) {
  return foreignAccountLaunchError({
    draft: draftWith(input),
    adAccountId: input.adAccountId ?? LAUNCH,
    token: "test-token",
    supabase: {},
    userId: "operator-2",
    wizardMode: input.wizardMode,
    graphGet: input.graphGet,
    graphMultiGet: input.graphMultiGet
      ? async () => input.graphMultiGet!()
      : async () => ({}),
    listAccountNames: input.listAccountNames
      ? async () => input.listAccountNames!()
      : undefined,
    listVideoScopes: input.listVideoScopes
      ? async () => input.listVideoScopes!()
      : async () => ({ ok: true, rows: [] }),
    fetchNext: input.fetchNext,
  });
}

function foreignAudienceRows(names: string[], accountId: string) {
  const rows: Record<string, { account_id: string }> = {};
  for (let index = 0; index < names.length; index += 1) {
    rows[audienceIdAt(index)] = { account_id: accountId };
  }
  return rows;
}

describe("foreignAccountLaunchError", () => {
  it("legacy video with no row passes", async () => {
    const lines: string[] = [];
    const orig = console.info;
    console.info = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    try {
      const error = await launch({
        videoId: LEGACY_VIDEO,
        listVideoScopes: async () => ({ ok: true, rows: [] }),
      });
      assert.equal(error, null);
      assert.ok(
        lines.includes(`["account-scope-preflight"] video ${LEGACY_VIDEO} unverified`),
      );
    } finally {
      console.info = orig;
    }
  });

  it("imported video passes", async () => {
    const lines: string[] = [];
    const orig = console.info;
    console.info = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    try {
      const error = await launch({
        videoId: IMPORTED_VIDEO,
        listVideoScopes: async () => ({ ok: true, rows: [] }),
      });
      assert.equal(error, null);
      assert.ok(
        lines.includes(`["account-scope-preflight"] video ${IMPORTED_VIDEO} unverified`),
      );
    } finally {
      console.info = orig;
    }
  });

  it("registry row in act_other refuses", async () => {
    const error = await launch({
      videoId: FOREIGN_VIDEO,
      listVideoScopes: async () => ({
        ok: true,
        rows: [{ platformId: FOREIGN_VIDEO, scope: OTHER }],
      }),
    });
    assert.match(
      error ?? "",
      /1 video belongs to a different ad account: clip\.mp4 — re-upload it\./,
    );
  });

  it("audience on another account refuses", async () => {
    const error = await launch({
      audienceId: AUDIENCE,
      graphMultiGet: async () => ({ [AUDIENCE]: { account_id: "1073273492854557" } }),
    });
    assert.match(error ?? "", /belongs to act_1073273492854557/);
  });

  it("adimages GET throws and launch proceeds", async () => {
    const error = await launch({
      imageHash: fixture.hashes[0],
      graphGet: async () => {
        throw new Error("rate limit");
      },
    });
    assert.equal(error, null);
  });

  it("audience batch throws and launch proceeds", async () => {
    const error = await launch({
      audienceId: AUDIENCE,
      graphMultiGet: async () => {
        throw new Error("rate limit");
      },
    });
    assert.equal(error, null);
  });

  it("walks a two-page adimages response", async () => {
    const pages = fixture.pages as Array<{ paging?: { next?: string } }>;
    let walked = false;
    const error = await launch({
      imageHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      graphGet: async (_path, params) => {
        assert.equal(params.limit, "50");
        assert.equal(params.fields, "hash");
        return pages[0];
      },
      fetchNext: async (url) => {
        walked = true;
        assert.equal(url, pages[0]?.paging?.next);
        return pages[1];
      },
    });
    assert.equal(walked, true);
    assert.match(
      error ?? "",
      /1 image belongs to a different ad account: poster\.jpg — re-upload it\./,
    );
  });

  it("attach_all_adsets with foreign audiences returns null and skips the audience leg", async () => {
    const lines: string[] = [];
    const orig = console.info;
    console.info = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    let audienceRead = false;
    try {
      const error = await launch({
        wizardMode: "attach_all_adsets",
        audienceNames: ["Luuk van Dijk", "Max Dean"],
        graphMultiGet: async () => {
          audienceRead = true;
          return foreignAudienceRows(["Luuk van Dijk", "Max Dean"], "606252931141334");
        },
      });
      assert.equal(error, null);
      assert.equal(audienceRead, false);
      assert.ok(
        lines.includes('["account-scope-preflight"] audiences skipped: mode=attach_all_adsets'),
      );
    } finally {
      console.info = orig;
    }
  });

  it("attach_campaign with the same foreign audiences refuses", async () => {
    const names = ["Luuk van Dijk", "Max Dean"];
    const error = await launch({
      wizardMode: "attach_campaign",
      audienceNames: names,
      graphMultiGet: async () => foreignAudienceRows(names, "1073273492854557"),
    });
    assert.match(error ?? "", /belong to act_1073273492854557/);
    assert.match(error ?? "", /Luuk van Dijk — Similar Pages/);
  });

  it("foreign image hashes still refuse in attach_all_adsets", async () => {
    const error = await launch({
      wizardMode: "attach_all_adsets",
      audienceNames: ["Luuk van Dijk"],
      imageHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      graphGet: async () => ({ data: [] }),
      graphMultiGet: async () => {
        throw new Error("audience read should not run");
      },
    });
    assert.match(
      error ?? "",
      /1 image belongs to a different ad account: poster\.jpg — re-upload it\./,
    );
    assert.equal((error ?? "").includes("audiences in this draft"), false);
  });

  it("12 foreign audiences names 3, +9 more, and both account ids", async () => {
    const names = [
      "Luuk van Dijk",
      "Max Dean",
      "Ada Vega",
      "Fourth Artist",
      "Fifth Artist",
      "Sixth Artist",
      "Seventh Artist",
      "Eighth Artist",
      "Ninth Artist",
      "Tenth Artist",
      "Eleventh Artist",
      "Twelfth Artist",
    ];
    const puzzle = "act_333333333333333";
    const error = await launch({
      wizardMode: "attach_campaign",
      adAccountId: puzzle,
      audienceNames: names,
      graphMultiGet: async () => foreignAudienceRows(names, "606252931141334"),
      listAccountNames: async () =>
        new Map([
          ["606252931141334", "NX Promoter"],
          ["333333333333333", "Puzzle"],
        ]),
    });
    assert.match(error ?? "", /12 audiences in this draft belong to act_606252931141334 \(NX Promoter\), not act_333333333333333 \(Puzzle\)/);
    assert.match(
      error ?? "",
      /Luuk van Dijk — Similar Pages, Max Dean — Similar Pages, Ada Vega — Similar Pages, \+9 more/,
    );
    assert.equal((error ?? "").includes("Fourth Artist"), false);
  });

  it("2 foreign audiences names both and has no +more", async () => {
    const names = ["Luuk van Dijk", "Max Dean"];
    const error = await launch({
      wizardMode: "new",
      audienceNames: names,
      graphMultiGet: async () => foreignAudienceRows(names, "1073273492854557"),
    });
    assert.match(
      error ?? "",
      /2 audiences in this draft belong to act_1073273492854557, not act_606252931141334: Luuk van Dijk — Similar Pages, Max Dean — Similar Pages\./,
    );
    assert.equal((error ?? "").includes("+"), false);
  });

  it("validateStep: foreign audience in attach_all_adsets is not in errors", () => {
    const draft = draftWith({ audienceNames: ["Luuk van Dijk"], wizardMode: "attach_all_adsets" });
    const status = draft.audiences.pageGroups[0]?.engagementAudienceStatuses?.[0];
    assert.ok(status);
    status.accountId = "1073273492854557";
    const result = validateStep(3, draft);
    assert.equal(result.valid, true);
    assert.equal(result.errors.some((error) => error.includes("belongs to")), false);
    assert.ok(result.warnings?.some((warning) => warning.includes("belongs to act_1073273492854557")));
  });

  function suggestion(
    id: string,
    name: string,
    sourceId: string,
    sourceType: AdSetSuggestion["sourceType"],
    enabled: boolean,
    lookalikeRange?: AdSetSuggestion["lookalikeRange"],
  ): AdSetSuggestion {
    return {
      id,
      name,
      sourceType,
      sourceId,
      sourceName: name,
      ageMin: 18,
      ageMax: 65,
      budgetPerDay: 20,
      advantagePlus: true,
      enabled,
      lookalikeRange,
    };
  }

  function wideLookalikeDraft(wideEnabled: boolean) {
    const draft = createDefaultDraft();
    draft.settings.adAccountId = LAUNCH;
    draft.settings.metaAdAccountId = LAUNCH;
    const wideIds = Array.from({ length: 7 }, (_, index) =>
      `12025119144824${String(index).padStart(4, "0")}`,
    );
    draft.audiences.customAudienceGroups = [
      { id: "colyn", name: "Colyn", audienceIds: ["120251191448250000"] },
      { id: "curated", name: "Similar Pages - Curated", audienceIds: ["120251191448250001"] },
      {
        id: "wide",
        name: "Similar Pages - Wide",
        audienceIds: [],
        lookalikeAudienceIdsByRange: { "0-1%": wideIds },
      },
    ];
    draft.adSetSuggestions = [
      suggestion("a1", "Colyn", "colyn", "custom_group", true),
      suggestion("a2", "Similar Pages - Curated", "curated", "custom_group", true),
      suggestion("a3", "Similar Pages - Wide", "wide", "custom_group_lookalike", wideEnabled, "0-1%"),
    ];
    return { draft, wideIds };
  }

  it("disabled ad set referencing foreign lookalikes does not refuse", async () => {
    const { draft, wideIds } = wideLookalikeDraft(false);
    let requested = "";
    const error = await foreignAccountLaunchError({
      draft,
      adAccountId: LAUNCH,
      token: "test-token",
      supabase: {},
      userId: "operator-2",
      wizardMode: "new",
      graphMultiGet: async (_path, params) => {
        requested = params.ids;
        const rows: Record<string, { account_id: string }> = {};
        for (const id of params.ids.split(",")) {
          rows[id] = {
            account_id: wideIds.includes(id) ? "584836032177995" : "606252931141334",
          };
        }
        return rows;
      },
      listVideoScopes: async () => ({ ok: true, rows: [] }),
    });
    assert.equal(error, null);
    for (const id of wideIds) assert.equal(requested.includes(id), false);
  });

  it("enabling that ad set refuses Similar Pages - Wide (7 lookalikes) once", async () => {
    const { draft, wideIds } = wideLookalikeDraft(true);
    const error = await foreignAccountLaunchError({
      draft,
      adAccountId: LAUNCH,
      token: "test-token",
      supabase: {},
      userId: "operator-2",
      wizardMode: "new",
      graphMultiGet: async (_path, params) => {
        const rows: Record<string, { account_id: string }> = {};
        for (const id of params.ids.split(",")) {
          rows[id] = {
            account_id: wideIds.includes(id) ? "584836032177995" : "606252931141334",
          };
        }
        return rows;
      },
      listVideoScopes: async () => ({ ok: true, rows: [] }),
    });
    const phrase = "Similar Pages - Wide (7 lookalikes)";
    assert.equal(error?.split(phrase).length, 2);
    assert.match(error ?? "", /7 audiences in this draft belong to act_584836032177995/);
  });

  it("validateStep: foreign group unreferenced by any enabled ad set is not in errors", () => {
    const draft = draftWith({ audienceNames: ["Luuk van Dijk"] });
    draft.adSetSuggestions = draft.adSetSuggestions.map((adSet) => ({ ...adSet, enabled: false }));
    const status = draft.audiences.pageGroups[0]?.engagementAudienceStatuses?.[0];
    assert.ok(status);
    status.accountId = "584836032177995";
    const result = validateStep(3, draft);
    assert.equal(result.errors.some((error) => error.includes("belongs to")), false);
    assert.ok(result.warnings?.some((warning) => warning.includes("belongs to act_584836032177995")));
  });
});
