/**
 * "Running blind": a Google Ads account with no enabled conversion action
 * (GOOGLE_HOSTED excluded) cannot see a sale. The count is written nightly
 * by the google-ads-daily-insights cron (migration 192). A badge, never a
 * push block. Null = not checked yet, no badge.
 */

export type ConversionActionCount = { id: string; enabled_conversion_actions: number | null };

export function runningBlindAccountIds(rows: readonly ConversionActionCount[]): Set<string> {
  return new Set(rows.filter((r) => r.enabled_conversion_actions === 0).map((r) => r.id));
}
