import type { AssetQueueRow } from "@/lib/db/asset-queue";

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
