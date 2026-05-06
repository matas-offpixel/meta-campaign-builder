/**
 * Meta Graph `filtering` uses CONTAIN on a prefix of `[EVENT_CODE` (no
 * closing bracket) so suffix variants (Relaunch, en-dash titles, etc.)
 * still download. We then enforce the exact `[EVENT_CODE]` substring
 * client-side (case-sensitive code portion + dash normalisation).
 */

export function metaCampaignFilterPrefix(eventCode: string): string {
  return `[${eventCode.trim()}`;
}

export function campaignMatchesBracketedEventCode(
  campaignName: string,
  eventCode: string,
): boolean {
  const needle = `[${eventCode.trim()}]`;
  return normalizeInsightDashes(campaignName).includes(
    normalizeInsightDashes(needle),
  );
}

function normalizeInsightDashes(s: string): string {
  return s.replace(/[\u2013\u2014\u2212]/g, "-");
}
