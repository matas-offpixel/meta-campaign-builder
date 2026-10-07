/**
 * Creative `url_tags` — Meta appends this query string to the landing URL
 * of every ad the app creates, so first-party analytics (landing pages,
 * Cirqlin) can join a signup back to its campaign, ad set and ad by id.
 *
 * The `{{…}}` macros are Meta's dynamic URL parameters and must reach the
 * Graph API literally. `graphPostWithToken` sends a JSON body, so nothing
 * on our side URL-encodes them.
 */

export const URL_TAGS =
  "utm_source=meta&utm_medium=paid&utm_campaign={{campaign.id}}&utm_content={{adset.id}}&utm_term={{ad.id}}";

/**
 * The `url_tags` value for a creative whose landing URL is `destinationUrl`,
 * or `undefined` when the operator already tagged the URL themselves (any
 * `utm_` query parameter, any case) or used Meta macros directly (`{{`).
 * Meta would otherwise send duplicate utm keys and the operator's values
 * would be ambiguous downstream.
 */
export function urlTagsFor(destinationUrl: string | null | undefined): string | undefined {
  const url = destinationUrl ?? "";
  if (url.includes("{{")) return undefined;
  const queryStart = url.indexOf("?");
  if (queryStart === -1) return URL_TAGS;
  const hashStart = url.indexOf("#", queryStart);
  const query = url.slice(queryStart + 1, hashStart === -1 ? undefined : hashStart);
  const hasOperatorUtm = query
    .split("&")
    .some((pair) => /^utm_/i.test(pair));
  return hasOperatorUtm ? undefined : URL_TAGS;
}

/**
 * Review-step line: how many of the ads about to launch get our tags and
 * how many keep the operator's own. `adSetKeys` are the assignment keys
 * that will actually launch (enabled ad sets, or attached-ad-set keys).
 */
export function urlTagsReviewLine(
  creatives: readonly { id: string; destinationUrl?: string | null }[],
  assignments: Readonly<Record<string, readonly string[]>>,
  adSetKeys: readonly string[],
): string | null {
  const byId = new Map(creatives.map((c) => [c.id, c]));
  let tagged = 0;
  let kept = 0;
  for (const key of adSetKeys) {
    for (const creativeId of assignments[key] ?? []) {
      const creative = byId.get(creativeId);
      if (!creative) continue;
      if (urlTagsFor(creative.destinationUrl)) tagged += 1;
      else kept += 1;
    }
  }
  if (tagged + kept === 0) return null;
  const line = `Tracking: utm tags added to ${tagged} ${tagged === 1 ? "ad" : "ads"}`;
  if (kept === 0) return `${line}.`;
  return `${line}. ${kept} ${kept === 1 ? "keeps its" : "keep their"} own utm tags.`;
}
