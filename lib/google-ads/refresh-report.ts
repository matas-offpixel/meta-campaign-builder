import { customerIdForGoogleAdsApi } from "./oauth.ts";
import type {
  EnumeratedGoogleAdsAccount,
  GoogleAdsHierarchySkip,
} from "./customer-hierarchy.ts";

export const GOOGLE_ADS_REFRESH_COOLDOWN_MS = 30_000;

export function googleAdsRefreshCooldownRemaining(
  updatedAts: Array<string | null | undefined>,
  now = Date.now(),
): number {
  let latest = 0;
  for (const value of updatedAts) {
    if (!value) continue;
    const ms = new Date(value).getTime();
    if (Number.isFinite(ms) && ms > latest) latest = ms;
  }
  if (latest === 0) return 0;
  return Math.max(0, GOOGLE_ADS_REFRESH_COOLDOWN_MS - (now - latest));
}

export function formatGoogleAdsRefreshReport(input: {
  found: number;
  newlyAdded: number;
  skipped: Array<{ customerId: string | null; descriptiveName?: string | null; reason: string }>;
}): string {
  if (input.newlyAdded === 0 && input.skipped.length === 0) {
    return `${input.found} accounts, none new`;
  }
  const skippedText =
    input.skipped.length === 0
      ? "0 skipped"
      : `${input.skipped.length} skipped (${input.skipped
          .map((skip) => {
            const who = skip.customerId ?? skip.descriptiveName ?? "unknown account";
            return `${who}: ${skip.reason}`;
          })
          .join("; ")})`;
  const newText = input.newlyAdded === 0 ? "none new" : `${input.newlyAdded} new`;
  return `${input.found} found · ${newText} · ${skippedText}`;
}

/** Drops that did not end up in the upsert set. A kept account is not a skip. */
export function skipsAbsentFromUpsert(
  skipped: GoogleAdsHierarchySkip[],
  accounts: EnumeratedGoogleAdsAccount[],
): GoogleAdsHierarchySkip[] {
  const kept = new Set(accounts.map((account) => customerIdForGoogleAdsApi(account.customerId)));
  return skipped.filter((skip) => {
    const digits = skip.customerId ? customerIdForGoogleAdsApi(skip.customerId) : "";
    return digits.length !== 10 || !kept.has(digits);
  });
}

export function countNewGoogleAdsAccounts(
  storedCustomerIds: Array<string | null>,
  enumerated: EnumeratedGoogleAdsAccount[],
): number {
  const stored = new Set(
    storedCustomerIds
      .map((id) => (id ? customerIdForGoogleAdsApi(id) : ""))
      .filter((id) => id.length === 10),
  );
  return enumerated.filter((account) => !stored.has(customerIdForGoogleAdsApi(account.customerId))).length;
}
