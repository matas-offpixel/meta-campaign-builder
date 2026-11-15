/**
 * Every Meta ad account a client's events can legitimately spend from.
 *
 * The rollup used to query only `resolveEventAdAccountId(event)` — one
 * account — so a correctly-coded campaign launched into a sibling account
 * was invisible for ever. Fever 105's `[ES26-FEVER105]` campaigns are
 * split across Sheffield (£1,346.86) and NX (£94.07); three of them were
 * created in the NX account on 2 Oct 2026 and paused the same day, and no
 * amount of discovery inside Sheffield could see them.
 *
 * Codes are unique per event, so scanning wider cannot mis-attribute:
 * `classifyCampaignClaim` still decides which event may count each
 * campaign. Scanning wider only changes what discovery is allowed to find.
 */
export function collectClientAdAccountIds(input: {
  /** The account the event itself resolves to. Always included. */
  eventAdAccountId: string | null;
  /** `clients.meta_ad_account_id`. */
  clientAdAccountId?: string | null;
  /** `events.meta_ad_account_id` for every event of this client. */
  siblingEventAdAccountIds?: (string | null | undefined)[];
}): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string | null | undefined) => {
    const id = raw?.trim();
    if (!id) return;
    // `act_123` and `123` are the same account to Meta; dedupe on digits
    // so one account is never scanned twice in a run.
    const key = id.replace(/^act_/, "");
    if (seen.has(key)) return;
    seen.add(key);
    out.push(id);
  };
  // The event's own account first: on a partial failure the most likely
  // place its spend lives has already been read.
  push(input.eventAdAccountId);
  push(input.clientAdAccountId);
  for (const sibling of input.siblingEventAdAccountIds ?? []) push(sibling);
  return out;
}
