/**
 * The EOD cron is `maxDuration = 300` for the whole request, Mailchimp
 * included. The Cirqlin loop therefore measures from request start —
 * leftover Mailchimp time is not a second 270s. Stop 30s before the
 * platform kill and report how many tagged events were left.
 */
export const CIRQLIN_CRON_MAX_DURATION_MS = 300_000;
export const CIRQLIN_CRON_HEADROOM_MS = 30_000;
export const CIRQLIN_CRON_BUDGET_MS =
  CIRQLIN_CRON_MAX_DURATION_MS - CIRQLIN_CRON_HEADROOM_MS;

export function cirqlinCronLeft(total: number, nextIndex: number): number {
  if (nextIndex >= total) return 0;
  return total - nextIndex;
}

export function cirqlinCronOverBudget(
  startedAtMs: number,
  nowMs: number,
  budgetMs: number = CIRQLIN_CRON_BUDGET_MS,
): boolean {
  return nowMs - startedAtMs >= budgetMs;
}
