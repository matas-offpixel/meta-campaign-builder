export function isPresaleCampaignName(name: string): boolean {
  return PRESALE_RE.test(name);
}

/** Traffic / conversion rows tied to a cup sub-fixture — stays in main Meta spend. */
export function isSubFixtureCampaignName(name: string): boolean {
  return /\blast\s*32\b/i.test(name) || /\bfinal\b/i.test(name);
}

export function partitionMetaSpendForCampaign(
  campaignName: string,
  spend: number,
): { regular: number; presale: number } {
  if (isSubFixtureCampaignName(campaignName)) {
    return { regular: spend, presale: 0 };
  }
  if (isPresaleCampaignName(campaignName)) {
    return { regular: 0, presale: spend };
  }
  return { regular: spend, presale: 0 };
}

const PRESALE_RE =
  /\bpresale\b|(?:^|[^a-z0-9])pre[-_\s]?sale(?:$|[^a-z0-9])/i;
