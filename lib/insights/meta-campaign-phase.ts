export function isPresaleCampaignName(name: string): boolean {
  return PRESALE_RE.test(name);
}

const PRESALE_RE = /(?:^|[^a-z0-9])pre[-_\s]?sale(?:$|[^a-z0-9])/i;
