import type { AssetQueueRow } from "@/lib/db/asset-queue";
import {
  resolveOrganiserDestinationUrl,
  resolveUniversalClientUrl,
} from "./destination-url.ts";
import {
  type AssetSource,
  type SourceProvider,
  getSourceProvider,
  detectSourceFromUrl,
} from "./provider.ts";

/** Default umbrella venue-wide copy when AI/funnel template is unavailable. */
export const UMBRELLA_VENUE_WIDE_DEFAULT_COPY =
  "🚨 FINAL TICKETS 🏟️ The biggest World Cup FanParks are back 🎟 Don't miss out on the best viewing experience. Our FanParks ALWAYS sell out fast — secure your spot early!";

export function isUmbrellaQueueRow(row: AssetQueueRow): boolean {
  return (row.resolved_event_codes_multi?.length ?? 0) > 0;
}

export function isQueueBulkAttachHandoffStatus(status: AssetQueueRow["status"]): boolean {
  return status === "pending" || status === "confirmed";
}

/** Merge confirmed modal overrides with prepared row fields for bulk-attach handoff. */
export function resolveQueueHandoffCopy(row: AssetQueueRow): {
  generatedCopy: string | null;
  generatedCta: string | null;
  generatedUrl: string | null;
} {
  const overrides = row.confirmed_overrides ?? {};
  const fromOverrides = row.status === "confirmed";

  const primaryText =
    fromOverrides && typeof overrides.primaryText === "string"
      ? overrides.primaryText
      : row.generated_copy;
  const ctaValue =
    fromOverrides && typeof overrides.ctaValue === "string"
      ? overrides.ctaValue
      : row.generated_cta;
  const destUrl =
    fromOverrides && typeof overrides.destUrl === "string"
      ? overrides.destUrl
      : row.generated_url;

  return {
    generatedCopy: primaryText ?? null,
    generatedCta: ctaValue ?? null,
    generatedUrl: destUrl ?? null,
  };
}

/**
 * Destination URL for bulk-attach handoff — row/override first, then fallbacks.
 * Umbrella rows use brand homepage; single-venue uses organiser URL (PR #584).
 */
export function resolveQueueHandoffDestinationUrl(
  row: AssetQueueRow,
  clientSlug: string | null | undefined,
  opts?: { umbrella?: boolean; venueCity?: string | null },
): string | null {
  const handoff = resolveQueueHandoffCopy(row);
  const fromRow = handoff.generatedUrl?.trim();
  if (fromRow) return fromRow;

  const umbrella = opts?.umbrella ?? isUmbrellaQueueRow(row);
  if (umbrella) {
    return resolveUniversalClientUrl(clientSlug);
  }

  return resolveOrganiserDestinationUrl(clientSlug, opts?.venueCity) ?? null;
}

// ─── Source dispatch ────────────────────────────────────────────────────────

/**
 * Picks the download provider for a queue row's asset URL.
 *
 * Resolution order:
 *   1. explicit config source (client_asset_sheet_config.source) when supplied
 *   2. URL sniffing (Drive vs Dropbox) as a fallback for mixed-source sheets
 *
 * Both providers share the SourceFile shape + error `code` union, so callers
 * download without caring which cloud backs the row.
 */
export function resolveQueueSourceProvider(
  row: Pick<AssetQueueRow, "dropbox_url">,
  configSource?: AssetSource | null,
): SourceProvider {
  if (configSource) return getSourceProvider(configSource);
  const url = row.dropbox_url ?? "";
  return getSourceProvider(detectSourceFromUrl(url));
}
