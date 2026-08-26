import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { createDefaultDraft } from "../../campaign-defaults.ts";
import { createDefaultTikTokDraft } from "../../types/tiktok-draft.ts";
import type { CampaignDraft } from "../../types.ts";
import { blockerFixSurface, splitPlanBlockers } from "../blockers.ts";
import { planToGoogleDraft } from "../adapters/google.ts";
import {
  GOOGLE_DERIVED_NOTE_PREFIX,
  GOOGLE_NOISE_NEGATIVES,
  deriveGoogleKeywords,
  deriveGoogleNoiseNegatives,
  isDerivedGoogleNote,
  mergeDerivedGoogleKeywords,
} from "../derive/google.ts";
import {
  DERIVED_TIKTOK_GROUP_NAME,
  TIKTOK_HASHTAG_WITHHELD_REASON,
  collectDerivedTikTokTerms,
  mergeDerivedTikTokInterests,
  tiktokSeedTerms,
} from "../derive/tiktok.ts";
import { extractMetaVocabulary } from "../derive/vocabulary.ts";
import { IDLE_PLAN_LAUNCH, type CampaignPlan } from "../types.ts";

/**
 * A Meta draft shaped like real Step 3 work: two page groups (one carrying a
 * resolved page name), an interest group with real interests, plus a custom
 * audience group and a lookalike group that must NOT leak into derivation.
 */
function metaDraftFixture(): CampaignDraft {
  const draft = createDefaultDraft();
  draft.settings.campaignName = "BB26 Kayode";
  draft.settings.eventId = "33333333-3333-4333-8333-333333333333";
  draft.audiences.pageGroups = [
    {
      id: "pg-1",
      name: "Jamie Jones",
      pageIds: ["101", "102"],
      engagementTypes: ["fb_likes"],
      lookalike: false,
      lookalikeRanges: ["0-1%"],
      customAudienceIds: [],
      engagementAudienceStatuses: [
        {
          id: "ca-1",
          type: "fb_likes",
          pageId: "101",
          pageName: "Paradise Worldwide",
          createdAt: "2026-08-01T00:00:00.000Z",
          readyForLookalike: true,
          populating: false,
        },
      ],
    },
    {
      id: "pg-2",
      name: "Similar Pages",
      pageIds: ["103"],
      engagementTypes: ["ig_followers"],
      lookalike: true,
      lookalikeRanges: ["1-2%"],
      customAudienceIds: [],
    },
  ];
  draft.audiences.interestGroups = [
    {
      id: "ig-1",
      name: "House heads",
      clusterType: "Music & Nightlife",
      interests: [
        { id: "6003", name: "Tech house" },
        { id: "6004", name: "Defected Records" },
      ],
    },
  ];
  draft.audiences.customAudienceGroups = [
    { id: "cag-1", name: "Past purchasers 180d", audienceIds: ["ca-9"] },
  ];
  draft.audiences.selectedPagesLookalikeGroups = [
    {
      id: "lal-1",
      name: "Lookalike seed pack",
      selectedPageIds: ["101"],
      engagementTypes: ["fb_likes"],
      lookalikeRanges: ["0-1%"],
    },
  ];
  return draft;
}

function planFixture(): CampaignPlan {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    name: "BB26 Kayode",
    status: "draft",
    intent: {
      eventId: "33333333-3333-4333-8333-333333333333",
      objectiveIntent: "registration",
      budget: { totalDaily: 90, metaDaily: 40, tiktokDaily: 30, googleDaily: 20 },
      destinationUrl: "https://tickets.example.com/bb26",
      audienceClusterRef: "Music & Nightlife",
      creativeSetRef: null,
      startDate: "2026-09-01",
      endDate: "2026-09-14",
      startTime: null,
      endTime: null,
    },
    launches: {
      meta: { ...IDLE_PLAN_LAUNCH },
      tiktok: { ...IDLE_PLAN_LAUNCH },
      google: { ...IDLE_PLAN_LAUNCH },
    },
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
  };
}

describe("Meta vocabulary extraction", () => {
  it("pulls page, page-group, interest and event names with provenance", () => {
    const vocabulary = extractMetaVocabulary({
      draft: metaDraftFixture(),
      event: {
        name: "Boiler Room 26",
        venueName: "Printworks",
        genres: ["Tech House"],
        artistNames: ["Kayode"],
      },
    });
    const terms = vocabulary.map((entry) => entry.term);

    assert.ok(terms.includes("Paradise Worldwide"), "resolved Meta page name");
    assert.ok(terms.includes("Jamie Jones"), "operator page-group label");
    assert.ok(terms.includes("Tech house"), "Meta interest");
    assert.ok(terms.includes("Kayode"), "event artist");
    assert.ok(terms.includes("Printworks"), "venue");

    for (const entry of vocabulary) {
      assert.ok(entry.provenance.length > 0, `${entry.term} has provenance`);
      assert.match(entry.provenance, /"/, "provenance names its source");
    }
    const page = vocabulary.find((entry) => entry.term === "Paradise Worldwide");
    assert.equal(page?.origin, "meta_page");
    assert.match(page?.provenance ?? "", /Meta page "Paradise Worldwide"/);
  });

  it("never derives custom audiences or lookalikes", () => {
    const vocabulary = extractMetaVocabulary({ draft: metaDraftFixture() });
    const terms = vocabulary.map((entry) => entry.term.toLowerCase());
    assert.equal(terms.includes("past purchasers 180d"), false);
    assert.equal(terms.includes("lookalike seed pack"), false);
    assert.equal(
      vocabulary.some((entry) => /lookalike|custom audience/i.test(entry.origin)),
      false,
    );
  });

  it("drops placeholder labels the adapters wrote", () => {
    const vocabulary = extractMetaVocabulary({ draft: metaDraftFixture() });
    const terms = vocabulary.map((entry) => entry.term.toLowerCase());
    assert.equal(terms.includes("similar pages"), false);
    assert.equal(terms.includes("prospecting"), false);
  });

  it("uses the plan cluster only as a fallback when no Meta draft exists", () => {
    const withDraft = extractMetaVocabulary({
      draft: metaDraftFixture(),
      fallbackCluster: "Music & Nightlife",
    });
    assert.equal(
      withDraft.some((entry) => entry.origin === "plan_cluster"),
      false,
      "Meta draft is the authoring surface",
    );

    const withoutDraft = extractMetaVocabulary({
      draft: null,
      fallbackCluster: "Music & Nightlife",
    });
    const fallback = withoutDraft.find((entry) => entry.origin === "plan_cluster");
    assert.equal(fallback?.term, "Music & Nightlife");
    assert.match(fallback?.provenance ?? "", /no Meta draft yet/);
  });

  it("dedupes a term reachable from two sources onto the stronger origin", () => {
    const draft = metaDraftFixture();
    draft.audiences.interestGroups[0].interests.push({
      id: "6005",
      name: "Paradise Worldwide",
    });
    const vocabulary = extractMetaVocabulary({ draft });
    const hits = vocabulary.filter(
      (entry) => entry.term.toLowerCase() === "paradise worldwide",
    );
    assert.equal(hits.length, 1);
    assert.equal(hits[0].origin, "meta_page");
  });
});

describe("meta → tiktok derivation", () => {
  it("seeds TikTok suggestion calls from the Meta vocabulary", () => {
    const vocabulary = extractMetaVocabulary({ draft: metaDraftFixture() });
    const seeds = tiktokSeedTerms(vocabulary, 3);
    assert.equal(seeds.length, 3);
    assert.equal(seeds[0].origin, "meta_page");
    for (const seed of seeds) assert.ok(seed.provenance);
  });

  it("labels each derived term with the Meta source that produced it", () => {
    const vocabulary = extractMetaVocabulary({ draft: metaDraftFixture() });
    const pageSeed = vocabulary.find((entry) => entry.term === "Paradise Worldwide")!;
    const interestSeed = vocabulary.find((entry) => entry.term === "Tech house")!;

    const derived = collectDerivedTikTokTerms([
      {
        seed: pageSeed,
        candidates: [{ id: "tt-1", name: "House music", audienceSize: 1000 }],
      },
      {
        seed: interestSeed,
        candidates: [
          { id: "tt-1", name: "House music", audienceSize: 1000 },
          { id: "tt-2", name: "Techno", audienceSize: 500 },
        ],
      },
    ]);

    assert.equal(derived.length, 2, "id seen twice is not duplicated");
    const first = derived.find((term) => term.id === "tt-1");
    assert.match(first?.provenance ?? "", /Meta page "Paradise Worldwide"/);
    assert.equal(first?.seedTerm, "Paradise Worldwide");
    const second = derived.find((term) => term.id === "tt-2");
    assert.match(second?.provenance ?? "", /Meta interest "Tech house"/);
  });

  it("writes derived keywords into the draft and flattens the launch payload", () => {
    const draft = createDefaultTikTokDraft("tt-draft");
    const merged = mergeDerivedTikTokInterests(draft, [
      {
        id: "tt-1",
        name: "House music",
        audienceSize: 1000,
        provenance: 'Meta page "Paradise Worldwide"',
        seedTerm: "Paradise Worldwide",
      },
    ]);

    const group = merged.draft.audiences.interestGroups.find(
      (entry) => entry.name === DERIVED_TIKTOK_GROUP_NAME,
    );
    assert.ok(group, "derived group exists");
    assert.equal(group?.interestIds[0].kind, "keyword");
    assert.equal(group?.interestIds[0].derivedFrom, 'Meta page "Paradise Worldwide"');
    assert.ok(
      merged.draft.audiences.interestKeywordIds.includes("tt-1"),
      "flat launch payload carries the derived id",
    );
    assert.equal(merged.added, 1);
  });

  it("re-derive replaces derived terms but never operator-chosen ones", () => {
    const base = createDefaultTikTokDraft("tt-draft");
    const first = mergeDerivedTikTokInterests(base, [
      {
        id: "tt-1",
        name: "House music",
        audienceSize: null,
        provenance: 'Meta page "Paradise Worldwide"',
        seedTerm: "Paradise Worldwide",
      },
    ]);

    // Operator adds their own pick in the TikTok wizard (no derivedFrom).
    const edited = structuredClone(first.draft);
    edited.audiences.interestGroups[0].interestIds.push({
      id: "operator-1",
      name: "Operator pick",
      kind: "keyword",
    });

    const second = mergeDerivedTikTokInterests(edited, [
      {
        id: "tt-2",
        name: "Techno",
        audienceSize: null,
        provenance: 'Meta interest "Tech house"',
        seedTerm: "Tech house",
      },
    ]);

    const ids = second.draft.audiences.interestGroups.flatMap((group) =>
      group.interestIds.map((item) => item.id),
    );
    assert.ok(ids.includes("operator-1"), "operator pick survives re-derive");
    assert.ok(ids.includes("tt-2"), "fresh derivation applied");
    assert.equal(ids.includes("tt-1"), false, "stale derived term replaced");
    assert.equal(second.keptOperatorItems, 1);
    assert.equal(second.replacedDerivedItems, 1);
  });

  it("does not re-add a term the operator already owns", () => {
    const draft = createDefaultTikTokDraft("tt-draft");
    draft.audiences.interestGroups = [
      {
        id: "g-1",
        name: "Operator group",
        interestIds: [{ id: "tt-1", name: "House music", kind: "keyword" }],
        hashtagIds: [],
        behaviourIds: [],
      },
    ];
    const merged = mergeDerivedTikTokInterests(draft, [
      {
        id: "tt-1",
        name: "House music",
        audienceSize: null,
        provenance: 'Meta page "Paradise Worldwide"',
        seedTerm: "Paradise Worldwide",
      },
    ]);
    assert.equal(merged.added, 0);
    const all = merged.draft.audiences.interestGroups.flatMap((g) => g.interestIds);
    assert.equal(all.filter((item) => item.id === "tt-1").length, 1);
    assert.equal(all[0].derivedFrom, undefined);
  });

  it("never writes hashtags into the draft — they are a launch blocker", () => {
    const draft = createDefaultTikTokDraft("tt-draft");
    const merged = mergeDerivedTikTokInterests(draft, [
      {
        id: "tt-1",
        name: "House music",
        audienceSize: null,
        provenance: 'Meta page "Paradise Worldwide"',
        seedTerm: "Paradise Worldwide",
      },
    ]);
    const hashtags = merged.draft.audiences.interestGroups.flatMap(
      (group) => group.hashtagIds,
    );
    assert.equal(hashtags.length, 0);
    assert.match(TIKTOK_HASHTAG_WITHHELD_REASON, /hashtag-unverified/);
  });
});

describe("meta → google derivation", () => {
  it("seed keywords are vocabulary terms verbatim, provenance-noted", () => {
    const vocabulary = extractMetaVocabulary({
      draft: metaDraftFixture(),
      event: { name: "Boiler Room 26", venueName: "Printworks" },
    });
    const keywords = deriveGoogleKeywords(vocabulary);

    assert.ok(keywords.length > 0);
    const vocabularyTerms = new Set(vocabulary.map((entry) => entry.term.toLowerCase()));
    for (const keyword of keywords) {
      assert.ok(
        vocabularyTerms.has(keyword.keyword.toLowerCase()),
        `${keyword.keyword} came from the vocabulary, not invented`,
      );
      assert.ok(isDerivedGoogleNote(keyword.notes));
      assert.match(keyword.notes, /Meta |Event |Venue /);
      assert.equal(keyword.match_type, "PHRASE");
    }
  });

  it("noise negatives come from the existing preflight checklist list", () => {
    const negatives = deriveGoogleNoiseNegatives();
    assert.deepEqual(
      negatives.map((row) => row.keyword),
      [...GOOGLE_NOISE_NEGATIVES],
    );
    assert.ok(negatives.every((row) => isDerivedGoogleNote(row.reason)));
    assert.ok(negatives.some((row) => row.keyword === "free"));
    assert.ok(negatives.some((row) => row.keyword === "stream"));
  });

  it("merges into the plan tree and survives re-derive over operator keywords", () => {
    const tree = planToGoogleDraft(planFixture());
    assert.equal(tree.campaigns[0].ad_groups[0].keywords.length, 0);

    const vocabulary = extractMetaVocabulary({ draft: metaDraftFixture() });
    const first = mergeDerivedGoogleKeywords(
      tree,
      deriveGoogleKeywords(vocabulary),
      deriveGoogleNoiseNegatives(),
    );
    assert.ok(first.addedKeywords > 0);
    assert.equal(first.addedNegatives, GOOGLE_NOISE_NEGATIVES.length);

    // Operator adds a keyword in the Search wizard (no derived sentinel).
    const edited = structuredClone(first.tree);
    edited.campaigns[0].ad_groups[0].keywords.push({
      id: "op-1",
      ad_group_id: edited.campaigns[0].ad_groups[0].id,
      keyword: "boiler room tickets",
      match_type: "EXACT",
      est_cpc_low: null,
      est_cpc_high: null,
      intent: null,
      notes: "operator research",
      pushed_resource_name: null,
      created_at: "2026-08-26T00:00:00.000Z",
    });

    const second = mergeDerivedGoogleKeywords(
      edited,
      deriveGoogleKeywords(vocabulary),
      deriveGoogleNoiseNegatives(),
    );
    const keywords = second.tree.campaigns[0].ad_groups[0].keywords;
    assert.ok(
      keywords.some((row) => row.keyword === "boiler room tickets"),
      "operator keyword survives re-derive",
    );
    assert.equal(second.keptOperatorKeywords, 1);
    assert.equal(second.replacedDerivedKeywords, first.addedKeywords);
    assert.equal(
      keywords.filter((row) => isDerivedGoogleNote(row.notes)).length,
      first.addedKeywords,
      "derived rows replaced, not doubled",
    );
    assert.equal(
      second.addedNegatives,
      0,
      "noise negatives are not duplicated on re-derive",
    );
    assert.ok(GOOGLE_DERIVED_NOTE_PREFIX.length > 0);
  });
});

describe("blocker split per card", () => {
  it("routes wizard-owned bindings to the wizard and shared inputs to the plan", () => {
    const issues = [
      { adapter: "meta" as const, id: "meta:metaAdAccountId", field: "metaAdAccountId", message: "Ad account is required", blocking: true },
      { adapter: "meta" as const, id: "meta:creative:c1:0", field: "creative", message: "Creative needs an asset", blocking: true },
      { adapter: "meta" as const, id: "meta:name", field: "name", message: "Campaign name is required", blocking: true },
      { adapter: "meta" as const, id: "meta:skipped_zero_budget", field: "budget", message: "skipped", blocking: false },
      { adapter: "tiktok" as const, id: "tiktok:identity", field: "identity_id", message: "Identity required", blocking: true },
      { adapter: "tiktok" as const, id: "tiktok:landing-c1", field: "landing_page_url", message: "Landing page required", blocking: true },
    ];

    const meta = splitPlanBlockers(issues, "meta");
    assert.deepEqual(
      meta.wizard.map((issue) => issue.field),
      ["metaAdAccountId", "creative"],
    );
    assert.deepEqual(meta.plan.map((issue) => issue.field), ["name"]);
    assert.equal(meta.notes.length, 1);

    const tiktok = splitPlanBlockers(issues, "tiktok");
    assert.deepEqual(tiktok.wizard.map((issue) => issue.field), ["identity_id"]);
    assert.deepEqual(tiktok.plan.map((issue) => issue.field), ["landing_page_url"]);
  });

  it("account, pixel and keyword blockers are never labelled plan-fixable", () => {
    for (const field of [
      "advertiser_id",
      "pixel_id",
      "google_ads_account_missing",
      "campaign_no_keywords",
      "identity_type",
      "video_id",
    ]) {
      assert.equal(
        blockerFixSurface({
          adapter: "tiktok",
          id: field,
          field,
          message: "",
          blocking: true,
        }),
        "wizard",
        `${field} is completed in the wizard`,
      );
    }
  });
});

describe("non-plan drafts are unchanged", () => {
  it("wizard-created targeting items carry no provenance and flatten identically", () => {
    const draft = createDefaultTikTokDraft("tt-draft");
    draft.audiences.interestGroups = [
      {
        id: "g-1",
        name: "Operator group",
        interestIds: [
          { id: "k-1", name: "House music", kind: "keyword" },
          { id: "c-1", name: "Music", kind: "category" },
        ],
        hashtagIds: [],
        behaviourIds: [],
      },
    ];
    for (const item of draft.audiences.interestGroups[0].interestIds) {
      assert.equal(item.derivedFrom, undefined, "wizard never sets derivedFrom");
    }
    const merged = mergeDerivedTikTokInterests(draft, []);
    assert.deepEqual(
      merged.draft.audiences.interestGroups[0].interestIds,
      draft.audiences.interestGroups[0].interestIds,
      "a no-op derivation leaves operator targeting byte-identical",
    );
    assert.equal(merged.added, 0);
    assert.equal(
      merged.draft.audiences.interestGroups.some(
        (group) => group.name === DERIVED_TIKTOK_GROUP_NAME,
      ),
      false,
      "no empty derived group is invented",
    );
  });

  it("the wizard page shows no plan banner for a draft no plan owns", async () => {
    const { loadPlanForMetaDraft } = await import("../linked-plan.ts");
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
            eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
          }),
        }),
      }),
    };
    assert.equal(await loadPlanForMetaDraft(supabase, "draft-1", "user-1"), null);
  });

  it("a plan-owned draft resolves back to its plan", async () => {
    const { loadPlanForMetaDraft } = await import("../linked-plan.ts");
    const supabase = {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: table === "campaign_plan_meta_launch" ? { plan_id: "plan-1" } : null,
              error: null,
            }),
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: "plan-1", name: "BB26 Kayode" },
                error: null,
              }),
            }),
          }),
        }),
      }),
    };
    assert.deepEqual(await loadPlanForMetaDraft(supabase, "draft-1", "user-1"), {
      id: "plan-1",
      name: "BB26 Kayode",
    });
  });

  it("the Meta wizard shell itself is untouched — the banner sits on the route", () => {
    const page = readFileSync("app/campaign/[id]/page.tsx", "utf8");
    assert.match(page, /PlanLinkBanner/);
    assert.match(page, /WizardShell draftId=\{id\}/);
    const shell = readFileSync("components/wizard/wizard-shell.tsx", "utf8");
    assert.doesNotMatch(shell, /PlanLinkBanner|campaign_plan_meta_launch/);
  });
});

describe("plan page guards (extends #852)", () => {
  it("plan pages still grow no targeting, account-picker or upload UI", () => {
    const files = [
      "components/plan/plan-workspace.tsx",
      "app/(dashboard)/plans/page.tsx",
      "app/(dashboard)/plan/[id]/page.tsx",
    ];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      assert.doesNotMatch(source, /type=["']file["']/, `${file} has no upload`);
      assert.doesNotMatch(
        source,
        /AccountPicker|account-picker|AssetUpload|upload-asset/,
        `${file} has no account picker`,
      );
      assert.doesNotMatch(
        source,
        /InterestGroupsPanel|interest-groups-panel|PageAudiencesPanel|page-audiences-panel|CustomAudiencesPanel|SavedAudiencesPanel|useFetchPages|useFetchCustomAudiences|interest-search/,
        `${file} has no targeting UI — Meta wizard owns targeting`,
      );
    }
  });

  it("the audience cluster dropdown is gone from the plan's primary inputs", () => {
    const workspace = readFileSync("components/plan/plan-workspace.tsx", "utf8");
    assert.doesNotMatch(
      workspace,
      /CLUSTER_LABELS\.map/,
      "cluster is no longer an authored primary input",
    );
    assert.match(workspace, /Build the Meta campaign/);
    assert.match(workspace, /Re-derive from Meta/);
  });
});
