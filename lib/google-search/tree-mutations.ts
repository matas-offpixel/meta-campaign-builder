/**
 * lib/google-search/tree-mutations.ts
 *
 * Pure helpers for adding, updating, and removing nodes inside a
 * `GoogleSearchPlanTree`. Used by every wizard step that edits the
 * tree, so the immutability/ordering rules live in one place and step
 * components stay focused on layout.
 *
 * New rows assigned a temporary `tmp-…` id are persisted on autosave —
 * the CRUD layer's `saveGoogleSearchPlanTree` ignores incoming ids and
 * generates fresh UUIDs at insert time, so the tmp ids are only ever
 * used as React keys / local lookups within the wizard session.
 */

import type {
  GoogleSearchAdGroupNode,
  GoogleSearchCampaignNode,
  GoogleSearchKeyword,
  GoogleSearchMatchType,
  GoogleSearchNegative,
  GoogleSearchPlanTree,
  GoogleSearchRsa,
  GoogleSearchSitelink,
  GoogleSearchSitelinkDraft,
  RsaDescription,
  RsaHeadline,
} from "./types.ts";

export function tmpId(prefix: string): string {
  return `tmp-${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

const NOW = () => new Date().toISOString();

// ─── Campaigns ────────────────────────────────────────────────────────

export function addCampaign(tree: GoogleSearchPlanTree): GoogleSearchPlanTree {
  const sortOrder = tree.campaigns.length;
  const newCampaign: GoogleSearchCampaignNode = {
    id: tmpId("campaign"),
    plan_id: tree.plan.id,
    name: `Campaign ${sortOrder + 1}`,
    priority: null,
    monthly_budget: null,
    daily_budget: null,
    bid_adjustments: {},
    notes: null,
    sort_order: sortOrder,
    pushed_resource_name: null,
    created_at: NOW(),
    ad_groups: [],
    negatives: [],
  };
  return { ...tree, campaigns: [...tree.campaigns, newCampaign] };
}

export function updateCampaign(
  tree: GoogleSearchPlanTree,
  campaignId: string,
  patch: Partial<GoogleSearchCampaignNode>,
): GoogleSearchPlanTree {
  return {
    ...tree,
    campaigns: tree.campaigns.map((c) =>
      c.id === campaignId ? { ...c, ...patch } : c,
    ),
  };
}

export function removeCampaign(
  tree: GoogleSearchPlanTree,
  campaignId: string,
): GoogleSearchPlanTree {
  return {
    ...tree,
    campaigns: tree.campaigns
      .filter((c) => c.id !== campaignId)
      .map((c, i) => ({ ...c, sort_order: i })),
  };
}

export function moveCampaign(
  tree: GoogleSearchPlanTree,
  campaignId: string,
  direction: -1 | 1,
): GoogleSearchPlanTree {
  const idx = tree.campaigns.findIndex((c) => c.id === campaignId);
  if (idx < 0) return tree;
  const target = idx + direction;
  if (target < 0 || target >= tree.campaigns.length) return tree;
  const next = [...tree.campaigns];
  const [moved] = next.splice(idx, 1);
  next.splice(target, 0, moved);
  return {
    ...tree,
    campaigns: next.map((c, i) => ({ ...c, sort_order: i })),
  };
}

// ─── Ad groups ────────────────────────────────────────────────────────

export function addAdGroup(
  tree: GoogleSearchPlanTree,
  campaignId: string,
  name?: string,
): GoogleSearchPlanTree {
  return updateCampaignInPlace(tree, campaignId, (c) => {
    const adGroup: GoogleSearchAdGroupNode = {
      id: tmpId("adgroup"),
      campaign_id: campaignId,
      name: name ?? `Ad Group ${c.ad_groups.length + 1}`,
      default_cpc: null,
      sort_order: c.ad_groups.length,
      pushed_resource_name: null,
      created_at: NOW(),
      keywords: [],
      rsas: [],
    };
    return { ...c, ad_groups: [...c.ad_groups, adGroup] };
  });
}

export function updateAdGroup(
  tree: GoogleSearchPlanTree,
  campaignId: string,
  adGroupId: string,
  patch: Partial<GoogleSearchAdGroupNode>,
): GoogleSearchPlanTree {
  return updateCampaignInPlace(tree, campaignId, (c) => ({
    ...c,
    ad_groups: c.ad_groups.map((ag) => (ag.id === adGroupId ? { ...ag, ...patch } : ag)),
  }));
}

export function removeAdGroup(
  tree: GoogleSearchPlanTree,
  campaignId: string,
  adGroupId: string,
): GoogleSearchPlanTree {
  return updateCampaignInPlace(tree, campaignId, (c) => ({
    ...c,
    ad_groups: c.ad_groups
      .filter((ag) => ag.id !== adGroupId)
      .map((ag, i) => ({ ...ag, sort_order: i })),
  }));
}

// ─── Keywords ─────────────────────────────────────────────────────────

export function addKeyword(
  tree: GoogleSearchPlanTree,
  campaignId: string,
  adGroupId: string,
  keyword: string = "",
  matchType: GoogleSearchMatchType = "PHRASE",
): GoogleSearchPlanTree {
  return updateAdGroupInPlace(tree, campaignId, adGroupId, (ag) => {
    const row: GoogleSearchKeyword = {
      id: tmpId("kw"),
      ad_group_id: adGroupId,
      keyword,
      match_type: matchType,
      est_cpc_low: null,
      est_cpc_high: null,
      intent: null,
      notes: null,
      pushed_resource_name: null,
      created_at: NOW(),
    };
    return { ...ag, keywords: [...ag.keywords, row] };
  });
}

export function updateKeyword(
  tree: GoogleSearchPlanTree,
  campaignId: string,
  adGroupId: string,
  keywordId: string,
  patch: Partial<GoogleSearchKeyword>,
): GoogleSearchPlanTree {
  return updateAdGroupInPlace(tree, campaignId, adGroupId, (ag) => ({
    ...ag,
    keywords: ag.keywords.map((k) => (k.id === keywordId ? { ...k, ...patch } : k)),
  }));
}

export function removeKeyword(
  tree: GoogleSearchPlanTree,
  campaignId: string,
  adGroupId: string,
  keywordId: string,
): GoogleSearchPlanTree {
  return updateAdGroupInPlace(tree, campaignId, adGroupId, (ag) => ({
    ...ag,
    keywords: ag.keywords.filter((k) => k.id !== keywordId),
  }));
}

// ─── RSAs ─────────────────────────────────────────────────────────────

export function addRsa(
  tree: GoogleSearchPlanTree,
  campaignId: string,
  adGroupId: string,
): GoogleSearchPlanTree {
  return updateAdGroupInPlace(tree, campaignId, adGroupId, (ag) => {
    const rsa: GoogleSearchRsa = {
      id: tmpId("rsa"),
      ad_group_id: adGroupId,
      headlines: [],
      descriptions: [],
      final_url: null,
      path1: null,
      path2: null,
      pushed_resource_name: null,
      created_at: NOW(),
    };
    return { ...ag, rsas: [...ag.rsas, rsa] };
  });
}

export function updateRsa(
  tree: GoogleSearchPlanTree,
  campaignId: string,
  adGroupId: string,
  rsaId: string,
  patch: Partial<GoogleSearchRsa>,
): GoogleSearchPlanTree {
  return updateAdGroupInPlace(tree, campaignId, adGroupId, (ag) => ({
    ...ag,
    rsas: ag.rsas.map((r) => (r.id === rsaId ? { ...r, ...patch } : r)),
  }));
}

export function removeRsa(
  tree: GoogleSearchPlanTree,
  campaignId: string,
  adGroupId: string,
  rsaId: string,
): GoogleSearchPlanTree {
  return updateAdGroupInPlace(tree, campaignId, adGroupId, (ag) => ({
    ...ag,
    rsas: ag.rsas.filter((r) => r.id !== rsaId),
  }));
}

export function setRsaHeadlines(
  tree: GoogleSearchPlanTree,
  campaignId: string,
  adGroupId: string,
  rsaId: string,
  headlines: RsaHeadline[],
): GoogleSearchPlanTree {
  return updateRsa(tree, campaignId, adGroupId, rsaId, { headlines });
}

export function setRsaDescriptions(
  tree: GoogleSearchPlanTree,
  campaignId: string,
  adGroupId: string,
  rsaId: string,
  descriptions: RsaDescription[],
): GoogleSearchPlanTree {
  return updateRsa(tree, campaignId, adGroupId, rsaId, { descriptions });
}

// ─── Negatives ────────────────────────────────────────────────────────

export function addNegative(
  tree: GoogleSearchPlanTree,
  scope: { kind: "plan" } | { kind: "campaign"; campaign_id: string },
  keyword: string = "",
  matchType: GoogleSearchMatchType = "PHRASE",
): GoogleSearchPlanTree {
  const row: GoogleSearchNegative = {
    id: tmpId("neg"),
    plan_id: tree.plan.id,
    campaign_id: scope.kind === "campaign" ? scope.campaign_id : null,
    keyword,
    match_type: matchType,
    reason: null,
    pushed_resource_name: null,
    created_at: NOW(),
  };
  if (scope.kind === "plan") {
    return { ...tree, plan_negatives: [...tree.plan_negatives, row] };
  }
  return updateCampaignInPlace(tree, scope.campaign_id, (c) => ({
    ...c,
    negatives: [...c.negatives, row],
  }));
}

export function updateNegative(
  tree: GoogleSearchPlanTree,
  negativeId: string,
  patch: Partial<GoogleSearchNegative>,
): GoogleSearchPlanTree {
  if (tree.plan_negatives.some((n) => n.id === negativeId)) {
    return {
      ...tree,
      plan_negatives: tree.plan_negatives.map((n) =>
        n.id === negativeId ? { ...n, ...patch } : n,
      ),
    };
  }
  return {
    ...tree,
    campaigns: tree.campaigns.map((c) => ({
      ...c,
      negatives: c.negatives.map((n) => (n.id === negativeId ? { ...n, ...patch } : n)),
    })),
  };
}

export function removeNegative(
  tree: GoogleSearchPlanTree,
  negativeId: string,
): GoogleSearchPlanTree {
  return {
    ...tree,
    plan_negatives: tree.plan_negatives.filter((n) => n.id !== negativeId),
    campaigns: tree.campaigns.map((c) => ({
      ...c,
      negatives: c.negatives.filter((n) => n.id !== negativeId),
    })),
  };
}

// ─── Sitelinks ────────────────────────────────────────────────────────

export function addSitelink(
  tree: GoogleSearchPlanTree,
  seed: Partial<GoogleSearchSitelinkDraft> = {},
): GoogleSearchPlanTree {
  const sortOrder = tree.sitelinks.length;
  const row: GoogleSearchSitelink = {
    id: tmpId("sl"),
    plan_id: tree.plan.id,
    link_text: seed.link_text ?? "",
    description1: seed.description1 ?? null,
    description2: seed.description2 ?? null,
    final_url: seed.final_url ?? null,
    sort_order: seed.sort_order ?? sortOrder,
    pushed_resource_name: null,
    created_at: NOW(),
  };
  return { ...tree, sitelinks: [...tree.sitelinks, row] };
}

export function updateSitelink(
  tree: GoogleSearchPlanTree,
  sitelinkId: string,
  patch: Partial<GoogleSearchSitelink>,
): GoogleSearchPlanTree {
  return {
    ...tree,
    sitelinks: tree.sitelinks.map((s) =>
      s.id === sitelinkId ? { ...s, ...patch } : s,
    ),
  };
}

export function removeSitelink(
  tree: GoogleSearchPlanTree,
  sitelinkId: string,
): GoogleSearchPlanTree {
  return {
    ...tree,
    sitelinks: tree.sitelinks
      .filter((s) => s.id !== sitelinkId)
      .map((s, i) => ({ ...s, sort_order: i })),
  };
}

export function moveSitelink(
  tree: GoogleSearchPlanTree,
  sitelinkId: string,
  direction: -1 | 1,
): GoogleSearchPlanTree {
  const idx = tree.sitelinks.findIndex((s) => s.id === sitelinkId);
  if (idx < 0) return tree;
  const target = idx + direction;
  if (target < 0 || target >= tree.sitelinks.length) return tree;
  const next = [...tree.sitelinks];
  const [moved] = next.splice(idx, 1);
  next.splice(target, 0, moved);
  return {
    ...tree,
    sitelinks: next.map((s, i) => ({ ...s, sort_order: i })),
  };
}

// ─── Plan-level patches ───────────────────────────────────────────────

export function updatePlan(
  tree: GoogleSearchPlanTree,
  patch: Partial<GoogleSearchPlanTree["plan"]>,
): GoogleSearchPlanTree {
  return { ...tree, plan: { ...tree.plan, ...patch } };
}

/**
 * Apply a single landing URL to every RSA in the tree. Used by the
 * Plan Setup "Default final URL" input so the operator can populate
 * 7 campaigns' landing pages in one keystroke (J2 plan = one
 * SeeTickets URL for every RSA). The wizard preserves per-RSA
 * overrides set in the Ad Copy step by treating an empty string here
 * as a `clear` (set to null on every RSA) and a non-empty value as a
 * `set everywhere`. Use `setPlanDefaultFinalUrlIfBlank` when you only
 * want to fill the gaps.
 */
export function setPlanDefaultFinalUrl(
  tree: GoogleSearchPlanTree,
  url: string | null,
): GoogleSearchPlanTree {
  const value = url && url.trim() ? url.trim() : null;
  return {
    ...tree,
    campaigns: tree.campaigns.map((c) => ({
      ...c,
      ad_groups: c.ad_groups.map((ag) => ({
        ...ag,
        rsas: ag.rsas.map((r) => ({ ...r, final_url: value })),
      })),
    })),
  };
}

/**
 * Like `setPlanDefaultFinalUrl` but only writes to RSAs that don't
 * already have a URL (used by xlsx re-import flows where some RSAs
 * may have been edited manually).
 */
export function setPlanDefaultFinalUrlIfBlank(
  tree: GoogleSearchPlanTree,
  url: string,
): GoogleSearchPlanTree {
  const value = url.trim();
  if (!value) return tree;
  return {
    ...tree,
    campaigns: tree.campaigns.map((c) => ({
      ...c,
      ad_groups: c.ad_groups.map((ag) => ({
        ...ag,
        rsas: ag.rsas.map((r) =>
          r.final_url && r.final_url.trim() ? r : { ...r, final_url: value },
        ),
      })),
    })),
  };
}

// ─── Internals ────────────────────────────────────────────────────────

function updateCampaignInPlace(
  tree: GoogleSearchPlanTree,
  campaignId: string,
  fn: (c: GoogleSearchCampaignNode) => GoogleSearchCampaignNode,
): GoogleSearchPlanTree {
  return {
    ...tree,
    campaigns: tree.campaigns.map((c) => (c.id === campaignId ? fn(c) : c)),
  };
}

function updateAdGroupInPlace(
  tree: GoogleSearchPlanTree,
  campaignId: string,
  adGroupId: string,
  fn: (ag: GoogleSearchAdGroupNode) => GoogleSearchAdGroupNode,
): GoogleSearchPlanTree {
  return updateCampaignInPlace(tree, campaignId, (c) => ({
    ...c,
    ad_groups: c.ad_groups.map((ag) => (ag.id === adGroupId ? fn(ag) : ag)),
  }));
}
