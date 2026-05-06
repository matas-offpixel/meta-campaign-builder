export interface CampaignWithSpend {
  id: string;
  name: string;
  spend: number;
}

/**
 * Merge spend from insights into campaign rows and sort highest spend first.
 * When `excludeZeroSpend` is true, drops campaigns with no attributed spend
 * (after merge — used for ranking-only views).
 */
export function mergeAndSortCampaignsBySpend(
  campaigns: CampaignWithSpend[],
  options?: { excludeZeroSpend?: boolean },
): CampaignWithSpend[] {
  let rows = [...campaigns];
  if (options?.excludeZeroSpend) {
    rows = rows.filter((c) => c.spend > 0);
  }
  return rows.sort(
    (a, b) => b.spend - a.spend || a.name.localeCompare(b.name),
  );
}
