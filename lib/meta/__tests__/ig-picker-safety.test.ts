/**
 * Regression tests for the IG picker safety guarantees (task #96).
 *
 * Two production failures these lock down:
 *
 *   FAILURE 1 — silent wrong default. A Page with N > 1 linked Instagram
 *   accounts must produce NO default selection. Junction 2's Page links both
 *   @__mastery (a creator account sharing an admin) and @junction_2 (the Page's
 *   own business account); the wizard used to land on whichever came first.
 *
 *   FAILURE 2 — payload didn't match the UI selection. resolveIgActorForAdAccount
 *   substituted the ad account's FIRST actor when the picked IG wasn't in its
 *   list, so an ad built for @electricstudiossheff shipped under @shuffa_uk.
 *   Nothing substitutes any more: the mismatch is reported and the launch
 *   preflight blocks with an actionable message.
 *
 * The asymmetry in `evaluateIgIdentity` is deliberate and load-bearing: we block
 * only on positive evidence of a mismatch. An empty or unfetchable actor list
 * means the app token can't see the assets, not that the pick is wrong — and
 * blocking there would break agency setups (PR #567) and re-break PR #602.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  evaluateIgIdentity,
  describeIgMismatch,
  describeIgMismatches,
  buildIgGrantUrl,
  formatIgResolutionAudit,
} from "../ig-identity-guard.ts";
import {
  groupIgsByPage,
  formatIgOptionLabel,
  deriveMultiIgPageIds,
  resolveIgPickerValue,
  type IgWithPage,
} from "../ig-picker-options.ts";
import { applyPageInstagramOverrideToCreative } from "../apply-page-instagram-overrides.ts";
import { buildCreativePayload } from "../creative.ts";
import type { AdCreativeDraft } from "../../types.ts";

// ── Fixtures — the real Junction 2 shape that produced the incident ──────────

const JUNCTION_2_PAGE = "PAGE_JUNCTION_2";
const IG_JUNCTION_2 = "17841400000000001"; // the Page's own business account
const IG_MASTERY = "17841400000000002"; // creator account, shares an admin

/** Junction 2's Page as `/api/meta/instagram-accounts` returns it. */
function junction2IgAccounts(): IgWithPage[] {
  return [
    // Deliberately ordered with the WRONG one first: @__mastery sorts before
    // @junction_2 alphabetically, which is exactly how the old picker landed
    // on it. Order must not decide the selection.
    { id: IG_MASTERY, username: "__mastery", linkedPageId: JUNCTION_2_PAGE },
    {
      id: IG_JUNCTION_2,
      username: "junction_2",
      name: "Junction 2",
      linkedPageId: JUNCTION_2_PAGE,
      isPagePrimary: true,
    },
  ];
}

const enhancements = {
  enabled: false,
  textOptimizations: false,
  visualEnhancements: false,
  musicEnhancements: false,
  autoVariations: false,
} as const;

function junction2Creative(): AdCreativeDraft {
  return {
    id: "cr_j2",
    name: "Junction 2 — Phase 1",
    sourceType: "new",
    mediaType: "image",
    assetMode: "single",
    identity: {
      pageId: JUNCTION_2_PAGE,
      instagramAccountId: "",
    },
    assetVariations: [
      {
        id: "v",
        name: "V1",
        assets: [
          { id: "a45", aspectRatio: "4:5", uploadStatus: "uploaded", assetHash: "HASH_45" },
        ],
      },
    ],
    captions: [{ id: "c", text: "Junction 2 2026 — tickets live" }],
    headline: "Junction 2 2026",
    description: "",
    destinationUrl: "https://example.com/j2",
    cta: "buy_tickets",
    enhancements,
  } as AdCreativeDraft;
}

// ── Test 1: multi-IG page defaults to unselected ─────────────────────────────

describe("Multi-IG page defaults to unselected", () => {
  it("a page with 2 linked IGs yields an empty picker value", () => {
    const options = groupIgsByPage(junction2IgAccounts()).get(JUNCTION_2_PAGE) ?? [];
    assert.equal(options.length, 2);
    assert.equal(
      resolveIgPickerValue({ options, override: undefined }),
      "",
      "multi-IG pages must not pre-select anything — a pre-ticked wrong handle " +
        "is indistinguishable from a deliberate operator choice",
    );
  });

  it("a page with exactly 1 linked IG still auto-fills", () => {
    const single: IgWithPage[] = [
      { id: IG_JUNCTION_2, username: "junction_2", linkedPageId: JUNCTION_2_PAGE },
    ];
    const options = groupIgsByPage(single).get(JUNCTION_2_PAGE) ?? [];
    assert.equal(resolveIgPickerValue({ options }), IG_JUNCTION_2);
  });

  it("an explicit override is echoed back as the selected value", () => {
    const options = groupIgsByPage(junction2IgAccounts()).get(JUNCTION_2_PAGE) ?? [];
    assert.equal(
      resolveIgPickerValue({ options, override: IG_JUNCTION_2 }),
      IG_JUNCTION_2,
    );
  });

  it("multi-IG pages are reported so step validation can block Continue", () => {
    assert.deepEqual(deriveMultiIgPageIds(junction2IgAccounts()), [JUNCTION_2_PAGE]);
  });
});

// ── Test 2: historical Junction 2 case — recommend without pre-ticking ───────

describe("Historical case: Junction 2 with __mastery + junction_2", () => {
  it("recommends @junction_2 (the Page's own account) and not @__mastery", () => {
    const options = groupIgsByPage(junction2IgAccounts()).get(JUNCTION_2_PAGE) ?? [];

    assert.equal(
      options[0].igId,
      IG_JUNCTION_2,
      "the Page's own business account sorts first, ahead of @__mastery",
    );
    assert.deepEqual(
      options.map(formatIgOptionLabel),
      ["@junction_2 (Junction 2) — Recommended", "@__mastery"],
      "exactly one option carries the Recommended hint",
    );
  });

  it("recommending does NOT pre-tick — the operator must still choose", () => {
    const options = groupIgsByPage(junction2IgAccounts()).get(JUNCTION_2_PAGE) ?? [];
    assert.ok(options[0].isPagePrimary, "the recommendation is identified");
    assert.equal(
      resolveIgPickerValue({ options }),
      "",
      "a Recommended badge must not become a default selection",
    );
  });
});

// ── Test 3: explicit pick propagates byte-for-byte into object_story_spec ────

describe("Explicit pick propagates into the creative payload", () => {
  it("the picked IG id is the id sent as object_story_spec.instagram_user_id", async () => {
    const picked = applyPageInstagramOverrideToCreative(junction2Creative(), {
      [JUNCTION_2_PAGE]: IG_JUNCTION_2,
    });

    assert.equal(picked.identity.instagramAccountId, IG_JUNCTION_2);
    assert.equal(picked.identity.instagramActorId, IG_JUNCTION_2);

    const payload = await buildCreativePayload(picked, {
      validatedIgActorId: picked.identity.instagramActorId,
    });

    assert.deepEqual(
      payload.object_story_spec?.page_id,
      JUNCTION_2_PAGE,
      "page identity is unchanged by the IG pick",
    );
    assert.equal(
      payload.object_story_spec?.instagram_user_id,
      IG_JUNCTION_2,
      "the operator's pick must reach Meta verbatim",
    );

    const raw = JSON.stringify(payload);
    assert.ok(
      !raw.includes(IG_MASTERY),
      `the non-picked account must appear nowhere in the payload. Payload: ${raw}`,
    );
  });
});

// ── Test 4: mismatch hard-blocks with a clear, actionable error ──────────────

describe("Mismatch hard-blocks the launch", () => {
  const adAccountActors = [
    { id: "17841409999999999", username: "shuffa_uk" },
  ];

  it("picked IG absent from a non-empty ad-account list is a mismatch", () => {
    const verdict = evaluateIgIdentity({
      pickedIgId: IG_JUNCTION_2,
      adAccountActors,
      pageIgIds: [],
    });

    assert.deepEqual(verdict, {
      status: "mismatch",
      igId: IG_JUNCTION_2,
      adAccountActors,
    });
  });

  it("the error names the picked handle, the authorised handles and the fix", () => {
    const message = describeIgMismatch(
      {
        creativeName: "Junction 2 — Phase 1",
        pageId: JUNCTION_2_PAGE,
        pageName: "Junction 2",
        pickedIgId: IG_JUNCTION_2,
        pickedUsername: "junction_2",
        adAccountActors,
      },
      { businessId: "BM_123" },
    );

    assert.equal(
      message,
      `"Junction 2 — Phase 1": Instagram @junction_2 isn't authorised on this ` +
        `ad account (page Junction 2). Authorised accounts: @shuffa_uk. ` +
        `Grant it via /business-managers?tab=ig-accounts&bm=BM_123 or pick an ` +
        `IG from the authorised list.`,
    );
  });

  it("deep link omits the bm param when the business id is unknown", () => {
    assert.equal(buildIgGrantUrl(), "/business-managers?tab=ig-accounts");
    assert.equal(
      buildIgGrantUrl({ businessId: "BM_9" }),
      "/business-managers?tab=ig-accounts&bm=BM_9",
    );
  });

  it("aggregates per creative + picked id, deduping repeats", () => {
    const entry = {
      creativeName: "Junction 2 — Phase 1",
      pickedIgId: IG_JUNCTION_2,
      adAccountActors,
    };
    assert.equal(describeIgMismatches([entry, entry, { ...entry }]).length, 1);
    assert.equal(
      describeIgMismatches([entry, { ...entry, creativeName: "Phase 2" }]).length,
      2,
    );
  });
});

// ── Safety: absence of evidence must never block a launch ────────────────────

describe("Absence of evidence never blocks", () => {
  it("picked IG present in the ad-account list is authorised", () => {
    const verdict = evaluateIgIdentity({
      pickedIgId: IG_JUNCTION_2,
      adAccountActors: [{ id: IG_JUNCTION_2, username: "junction_2" }],
    });
    assert.deepEqual(verdict, {
      status: "authorised",
      igId: IG_JUNCTION_2,
      via: "ad_account",
    });
  });

  it("page-level linkage authorises agency setups (PR #567, 4thefans)", () => {
    const verdict = evaluateIgIdentity({
      pickedIgId: IG_JUNCTION_2,
      adAccountActors: [{ id: "SOME_OTHER_IG" }],
      pageIgIds: [IG_JUNCTION_2],
    });
    assert.deepEqual(verdict, {
      status: "authorised",
      igId: IG_JUNCTION_2,
      via: "page_level",
    });
  });

  it("a failed ad-account lookup is unverified, not a mismatch (PR #602)", () => {
    const verdict = evaluateIgIdentity({
      pickedIgId: IG_JUNCTION_2,
      adAccountActors: null,
    });
    assert.equal(verdict.status, "unverified");
  });

  it("an empty ad-account list is unverified, not a mismatch", () => {
    const verdict = evaluateIgIdentity({
      pickedIgId: IG_JUNCTION_2,
      adAccountActors: [],
      pageIgIds: [],
    });
    assert.equal(verdict.status, "unverified");
  });

  it("no pick at all is unverified", () => {
    assert.equal(
      evaluateIgIdentity({ pickedIgId: "", adAccountActors: [{ id: "X" }] }).status,
      "unverified",
    );
  });
});

// ── Audit trail ──────────────────────────────────────────────────────────────

describe("Audit trail", () => {
  it("records picked id, resolved id, source and the available list", () => {
    assert.equal(
      formatIgResolutionAudit({
        stage: "launch-preflight",
        pageId: JUNCTION_2_PAGE,
        adAccountId: "act_123",
        pickedIgId: IG_JUNCTION_2,
        resolvedIgId: undefined,
        source: "mismatch",
        adAccountAvailable: [{ id: "17841409999999999", username: "shuffa_uk" }],
      }),
      "[ig-identity-audit] stage=launch-preflight adAccount=act_123 " +
        `page=${JUNCTION_2_PAGE} pickedIgId=${IG_JUNCTION_2} resolvedIgId=(none) ` +
        "source=mismatch adAccountAvailable=[17841409999999999(@shuffa_uk)]",
    );
  });

  it("distinguishes a failed lookup from an empty list", () => {
    const failed = formatIgResolutionAudit({
      stage: "s",
      source: "x",
      adAccountAvailable: null,
    });
    const empty = formatIgResolutionAudit({
      stage: "s",
      source: "x",
      adAccountAvailable: [],
    });
    assert.ok(failed.includes("adAccountAvailable=[(lookup failed)]"));
    assert.ok(empty.includes("adAccountAvailable=[(empty)]"));
  });
});
