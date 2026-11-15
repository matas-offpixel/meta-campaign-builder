/** Pure formatting for cron-health, importable from node tests. */

type FailedAccount = { customer_id?: string | null; status?: string; missing_days?: string[] };

/** `839-818-3094 rollup_spend_without_campaign_rows (2026-10-07)` per failed account. */
export function describeFailedAccounts(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return (value as FailedAccount[])
    .map((a) => {
      const days = a.missing_days?.length ? ` (${a.missing_days.join(", ")})` : "";
      return `${a.customer_id ?? "unknown account"} ${a.status ?? "failed"}${days}`;
    })
    .join("; ");
}
