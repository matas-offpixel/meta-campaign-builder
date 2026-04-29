/**
 * Reporting-layer campaign matcher.
 *
 * This intentionally uses a forgiving bare event_code substring match, not the
 * stricter rollup-layer naming parser. Operators and platforms can vary bracket
 * style/casing, but event_code remains the canonical join key.
 */
export function campaignNameMatchesEventCode(
  campaignName: string,
  eventCode: string,
): boolean {
  const needle = eventCode.trim();
  if (!needle) return false;
  return campaignName.toLowerCase().includes(needle.toLowerCase());
}
