/**
 * lib/budget-pacing/spend-fetch.ts
 *
 * Task #121 Phase 2 — current lifetime spend per campaign, from Meta
 * insights (`date_preset=maximum` — every day the campaign has ever run,
 * not a rolling window; pacing needs the true lifetime total).
 *
 * Two call shapes, chosen by campaign count, per the brief's explicit
 * instruction ("use ids={csv} if >20 campaigns"):
 *   - ≤20 campaigns: one call per campaign —
 *     `GET /{campaignId}/insights?fields=spend&date_preset=maximum`.
 *   - >20 campaigns: chunked batches of 20 via Meta's `ids=` field
 *     expansion — `GET /?ids={csv}&fields=insights.date_preset(maximum){spend}`
 *     — same "one field-expansion call instead of N" trick already used by
 *     `lib/optimisation/insights-fetch.ts` (nested `insights` field on the
 *     `/adsets` edge; here nested on the campaign nodes returned by `ids=`).
 *
 * A campaign with no spend yet (never delivered) has no `insights.data`
 * row at all — resolved to `0`, not `null`, since "hasn't started spending"
 * and "spent literally £0.00" are the same thing for pacing purposes.
 *
 * Pure once the fetcher is injected — no `@/` imports, same seam as
 * `lib/optimisation/insights-fetch.ts`'s `OptimisationGraphFetcher`.
 */

const SINGLE_CALL_THRESHOLD = 20;
const BATCH_CHUNK_SIZE = 20;

interface RawInsightsPage {
  data?: { spend?: string }[];
}

interface RawBatchedNode {
  id: string;
  insights?: { data?: { spend?: string }[] };
}

/** Injected Graph fetcher — the production wrapper supplies `graphGetWithToken`. */
export type BudgetPacingGraphFetcher = <T>(
  path: string,
  params: Record<string, string>,
  token: string,
) => Promise<T>;

function parseSpendPence(raw: string | undefined): number {
  if (raw === undefined) return 0;
  const majorUnits = Number(raw);
  if (!Number.isFinite(majorUnits)) return 0;
  return Math.round(majorUnits * 100);
}

async function fetchSpendIndividually(
  fetcher: BudgetPacingGraphFetcher,
  campaignIds: string[],
  token: string,
): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const campaignId of campaignIds) {
    const page = await fetcher<RawInsightsPage>(
      `/${campaignId}/insights`,
      { fields: "spend", date_preset: "maximum" },
      token,
    );
    result[campaignId] = parseSpendPence(page.data?.[0]?.spend);
  }
  return result;
}

async function fetchSpendBatched(
  fetcher: BudgetPacingGraphFetcher,
  campaignIds: string[],
  token: string,
): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (let i = 0; i < campaignIds.length; i += BATCH_CHUNK_SIZE) {
    const chunk = campaignIds.slice(i, i + BATCH_CHUNK_SIZE);
    const nodes = await fetcher<Record<string, RawBatchedNode>>(
      "",
      { ids: chunk.join(","), fields: "insights.date_preset(maximum){spend}" },
      token,
    );
    for (const campaignId of chunk) {
      const node = nodes[campaignId];
      result[campaignId] = parseSpendPence(node?.insights?.data?.[0]?.spend);
    }
  }
  return result;
}

/**
 * Current lifetime spend (pence) for every campaign id, keyed by campaign
 * id. A campaign that errors individually would abort the whole batch in
 * the `>20` path — callers already tolerate a whole-tick failure the same
 * way `runOptimisationTick` does (see its `campaignsErrored` handling one
 * layer up), so this function intentionally lets fetch errors propagate
 * rather than swallowing them per-campaign.
 */
export async function fetchCampaignSpendPence(
  fetcher: BudgetPacingGraphFetcher,
  campaignIds: string[],
  token: string,
): Promise<Record<string, number>> {
  if (campaignIds.length === 0) return {};
  if (campaignIds.length <= SINGLE_CALL_THRESHOLD) {
    return fetchSpendIndividually(fetcher, campaignIds, token);
  }
  return fetchSpendBatched(fetcher, campaignIds, token);
}
