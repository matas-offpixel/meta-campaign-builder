import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { createDefaultCreative, createDefaultDraft } from "../../campaign-defaults.ts";
import { foreignAccountLaunchError } from "../account-scope-preflight.ts";

const LAUNCH = "act_606252931141334";
const OTHER = "act_1073273492854557";
const LEGACY_VIDEO = "111111111111111";
const IMPORTED_VIDEO = "987654321098765";
const FOREIGN_VIDEO = "222222222222222";
const AUDIENCE = "120250867495400239";

const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../__fixtures__/account-scope/adimages-hashes.json", import.meta.url)),
    "utf8",
  ),
) as {
  hashes: string[];
  pages: unknown[];
};

function draftWith(input: { audienceId?: string; imageHash?: string; videoId?: string }) {
  const draft = createDefaultDraft();
  draft.settings.adAccountId = LAUNCH;
  draft.settings.metaAdAccountId = LAUNCH;
  if (input.audienceId) {
    draft.audiences.pageGroups = [
      {
        id: "group-1",
        name: "Main Phase",
        pageIds: ["111"],
        engagementTypes: ["ig_engagement_365d"],
        lookalike: false,
        lookalikeRanges: [],
        customAudienceIds: [],
        engagementAudienceIds: [input.audienceId],
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
  imageHash?: string;
  videoId?: string;
  graphGet?: (path: string, params: Record<string, string>, token: string) => Promise<unknown>;
  graphMultiGet?: () => Promise<Record<string, { account_id?: string } | undefined>>;
  listVideoScopes?: () => Promise<
    | { ok: true; rows: { platformId: string; scope: string }[] }
    | { ok: false; tableMissing: boolean; error: string }
  >;
  fetchNext?: (url: string) => Promise<unknown>;
}) {
  return foreignAccountLaunchError({
    draft: draftWith(input),
    adAccountId: LAUNCH,
    token: "test-token",
    supabase: {},
    userId: "operator-2",
    graphGet: input.graphGet,
    graphMultiGet: input.graphMultiGet
      ? async () => input.graphMultiGet!()
      : async () => ({}),
    listVideoScopes: input.listVideoScopes
      ? async () => input.listVideoScopes!()
      : async () => ({ ok: true, rows: [] }),
    fetchNext: input.fetchNext,
  });
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
      /Video clip\.mp4 on Artwork was uploaded to a different ad account — re-upload it\./,
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
    assert.match(error ?? "", /Image poster\.jpg on Artwork was uploaded to a different ad account/);
  });
});
