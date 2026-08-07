/**
 * lib/notify/templates.ts
 *
 * Slack Block Kit message builders for task #121. Deliberately separate
 * from `lib/notify/slack.ts` so later phases (task #120 automation pings,
 * the Monday digest, urgent blockers, per-event lifecycle) each add a
 * template here without ever touching the notification service itself.
 * Every template returns `{ text, blocks }` — `text` is the Slack-required
 * fallback (also what shows in notification previews), `blocks` is the rich
 * Block Kit body. No `@/` imports — kept `node --test`-friendly like the
 * rest of `lib/notify/`.
 */

export interface BudgetThresholdReachedInput {
  campaignName: string;
  campaignId: string;
  /** One of 25 | 50 | 60 | 70 | 80 | 90 | 100 — not narrowed to a literal union so a future extra threshold doesn't require a type change here. */
  threshold: number;
  spentPence: number;
  totalPence: number;
  /** Floored whole days until the campaign's schedule end date. Negative/zero means the schedule has already ended. */
  daysRemaining: number;
  /** ISO 4217 code, e.g. "GBP". */
  currency: string;
  adsManagerUrl: string;
}

function formatMoney(pence: number, currency: string): string {
  const major = pence / 100;
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(major);
  } catch {
    // Unknown/malformed currency code — degrade to a plain number rather than throwing.
    return `${major.toFixed(2)} ${currency}`;
  }
}

function severityEmoji(threshold: number): string {
  if (threshold >= 100) return ":rotating_light:";
  if (threshold >= 90) return ":warning:";
  return ":chart_with_upwards_trend:";
}

function daysRemainingText(daysRemaining: number): string {
  if (daysRemaining <= 0) return "schedule end date has passed";
  if (daysRemaining === 1) return "1 day";
  return `${daysRemaining} days`;
}

/**
 * Task #121 Phase 2 — one Slack message per budget-pacing threshold crossed
 * by a campaign. `threshold: 100` is the most important case: the campaign
 * is about to (or already did) stop delivering because it's spent its full
 * planned budget.
 */
export function budgetThresholdReached(data: BudgetThresholdReachedInput): { text: string; blocks: unknown[] } {
  const spent = formatMoney(data.spentPence, data.currency);
  const total = formatMoney(data.totalPence, data.currency);
  const emoji = severityEmoji(data.threshold);
  const headline =
    data.threshold >= 100
      ? `${data.campaignName} has spent its full planned budget`
      : `${data.campaignName} has spent ${data.threshold}% of its planned budget`;

  const text = `${emoji} *${headline}* — ${spent} / ${total} spent, ${daysRemainingText(data.daysRemaining)} remaining. <${data.adsManagerUrl}|Open in Ads Manager>`;

  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `${emoji} Budget pacing: ${data.threshold}% spent`, emoji: true },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*${data.campaignName}*` },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Spent*\n${spent}` },
        { type: "mrkdwn", text: `*Planned budget*\n${total}` },
        { type: "mrkdwn", text: `*% spent*\n${data.threshold}%` },
        { type: "mrkdwn", text: `*Days remaining*\n${daysRemainingText(data.daysRemaining)}` },
      ],
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Open in Ads Manager", emoji: true },
          url: data.adsManagerUrl,
          action_id: "open_ads_manager",
        },
      ],
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: `Campaign ID: \`${data.campaignId}\`` }],
    },
  ];

  return { text, blocks };
}
