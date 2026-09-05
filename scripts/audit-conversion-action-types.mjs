// scripts/audit-conversion-action-types.mjs
//
// READ-ONLY. Pulls last-7d actions[] and cost_per_action_type[] for the
// conversion campaigns that report "no cpr/cpa data in the window".
// Uses META_ACCESS_TOKEN — the same token the optimisation tick uses.
// Never POSTs. If the token cannot read insights, exits and reports.
//
//   node --env-file=.env.local scripts/audit-conversion-action-types.mjs

const API_VERSION = process.env.META_API_VERSION ?? "v21.0";
const BASE = `https://graph.facebook.com/${API_VERSION}`;
const TOKEN = process.env.META_ACCESS_TOKEN;

const CPR_CANDIDATES = [
  "offsite_conversion.fb_pixel_complete_registration",
  "onsite_conversion.complete_registration",
  "complete_registration",
];
const CPA_CANDIDATES = [
  "offsite_conversion.fb_pixel_purchase",
  "onsite_conversion.purchase",
  "purchase",
];

const CAMPAIGNS = [
  {
    name: "Woraklis — Signup",
    campaignId: "120250261231790708",
    objective: "registration",
    metric: "cpr",
  },
  {
    name: "D.O.D - Signup",
    campaignId: "120251576269510755",
    objective: "registration",
    metric: "cpr",
  },
  {
    name: "APPETITE — Purchase Ads",
    campaignId: "52512868723907",
    objective: "purchase",
    metric: "cpa",
  },
  {
    name: "DJ EZ - NEWCASTLE - Signup (120251362539090755)",
    campaignId: "120251362539090755",
    objective: "registration",
    metric: "cpr",
  },
  {
    name: "DJ EZ - NEWCASTLE - Signup (120251365378580755)",
    campaignId: "120251365378580755",
    objective: "registration",
    metric: "cpr",
  },
];

if (!TOKEN) {
  console.error("META_ACCESS_TOKEN is not set — this is the token the optimisation tick uses. Stop.");
  process.exit(2);
}

function candidatesFor(metric) {
  return metric === "cpa" ? CPA_CANDIDATES : CPR_CANDIDATES;
}

async function graphGet(path, params) {
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set("access_token", TOKEN);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok || json.error) {
    const err = json.error ?? {};
    const error = new Error(
      `GET ${path} failed: ${err.message ?? res.status} (code=${err.code ?? res.status}, type=${err.type ?? "http"})`,
    );
    error.meta = err;
    throw error;
  }
  return json;
}

async function fetchAdSets(campaignId) {
  const insights =
    "insights.date_preset(last_7d){impressions,actions,cost_per_action_type}";
  const fields = `id,name,effective_status,${insights}`;
  const rows = [];
  let after;
  let page = 0;
  do {
    const params = { fields, limit: "200" };
    if (after) params.after = after;
    const response = await graphGet(`/${campaignId}/adsets`, params);
    rows.push(...(response.data ?? []));
    after = response.paging?.cursors?.after;
    page += 1;
  } while (after && page < 10);
  return rows;
}

function rowsFrom(list) {
  return (list ?? []).map((row) => ({
    action_type: row.action_type,
    value: row.value,
  }));
}

function firstMatch(types, candidates) {
  return candidates.find((candidate) => types.has(candidate)) ?? null;
}

async function main() {
  const tables = [];
  for (const campaign of CAMPAIGNS) {
    let adsets;
    try {
      adsets = await fetchAdSets(campaign.campaignId);
    } catch (err) {
      console.error(
        `TOKEN_CANNOT_READ campaign=${campaign.campaignId} name=${JSON.stringify(campaign.name)}: ${err instanceof Error ? err.message : err}`,
      );
      process.exit(3);
    }

    const candidates = candidatesFor(campaign.metric);
    const campaignRows = [];
    for (const adset of adsets) {
      const insight = adset.insights?.data?.[0] ?? {};
      const actions = rowsFrom(insight.actions);
      const costs = rowsFrom(insight.cost_per_action_type);
      const actionTypes = new Set(actions.map((row) => row.action_type));
      const costTypes = new Set(costs.map((row) => row.action_type));
      const matchedAction = firstMatch(actionTypes, candidates);
      const matchedCost = firstMatch(costTypes, candidates);
      campaignRows.push({
        campaign: campaign.name,
        campaignId: campaign.campaignId,
        objective: campaign.objective,
        metric: campaign.metric,
        adsetId: adset.id,
        adsetName: adset.name,
        status: adset.effective_status ?? null,
        impressions: insight.impressions ?? null,
        actions,
        cost_per_action_type: costs,
        resolver_match_in_actions: matchedAction,
        resolver_match_in_cost: matchedCost,
      });
    }
    tables.push({ campaign, adsets: campaignRows });
  }

  console.log(JSON.stringify({ date_preset: "last_7d", tables }, null, 2));
}

main();
