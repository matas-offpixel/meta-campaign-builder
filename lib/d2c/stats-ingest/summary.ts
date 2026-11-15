/**
 * lib/d2c/stats-ingest/summary.ts
 *
 * Stored rows → what E5's panel shows: per broadcast and per channel,
 * delivered, read (WhatsApp), opens (email, bot-filtered or "est."),
 * clicks, click rate, and WhatsApp cost = delivered × the client's
 * per-message rate. Pure.
 *
 *   - Clicks are the like-for-like comparison across channels; click
 *     rate is clicked ÷ delivered for every channel.
 *   - WhatsApp cost counts DELIVERED messages, not sent (E5, invented).
 *     A null rate means no cost at all, never zero.
 *   - SMS cost is entered elsewhere (E5) and email cost is "—", so both
 *     are null here.
 *   - Email is split into marketing and ticket-holder sends.
 */

import { clientOpenRatio, resolveOpens, type ResolvedOpens } from "./opens.ts";
import type { D2CAudienceKind, D2CStatsAttribution, D2CStatsChannel, D2CStatsProvider } from "./types.ts";

export interface StoredStatsRow {
  id: string;
  provider: D2CStatsProvider;
  account_id: string;
  external_id: string;
  channel: D2CStatsChannel;
  client_id: string | null;
  event_id: string | null;
  attribution: D2CStatsAttribution;
  audience_kind: D2CAudienceKind;
  name: string | null;
  sent_at: string | null;
  /** The Bird list or Mailchimp audience the send went to (PI6's venue rule). */
  list_id?: string | null;
  sent: number | null;
  delivered: number | null;
  read: number | null;
  clicked: number | null;
  opens_unique_raw: number | null;
  opens_unique_filtered: number | null;
  open_rate_filtered: number | null;
  fetched_at: string | null;
}

export interface MessageRate {
  rate: number | null;
  currency: string;
}

export interface BroadcastStat {
  id: string;
  provider: D2CStatsProvider;
  channel: D2CStatsChannel;
  audienceKind: D2CAudienceKind;
  attribution: D2CStatsAttribution;
  eventId: string | null;
  name: string | null;
  sentAt: string | null;
  sent: number | null;
  delivered: number | null;
  /** WhatsApp read receipts. Null for email. */
  read: number | null;
  readRate: number | null;
  /** Email only: bot-filtered opens, or the client-ratio estimate. */
  opens: ResolvedOpens | null;
  clicked: number | null;
  clickRate: number | null;
  /** WhatsApp only, when the client has a rate. */
  cost: number | null;
  costPerClick: number | null;
}

export type ChannelGroup = "whatsapp" | "sms" | "email_marketing" | "email_ticket_holder";

export interface ChannelTotals {
  group: ChannelGroup;
  broadcasts: number;
  sent: number;
  delivered: number;
  read: number | null;
  readRate: number | null;
  opens: number | null;
  openRate: number | null;
  /** true when any send's opens are the estimate. */
  opensEstimated: boolean;
  clicked: number;
  clickRate: number | null;
  cost: number | null;
  costPerClick: number | null;
}

export interface D2CStatsSummary {
  currency: string;
  ratePerMessage: number | null;
  /** The client's filtered ÷ raw open ratio used for "est." opens. */
  openRatio: number | null;
  broadcasts: BroadcastStat[];
  channels: ChannelTotals[];
}

function ratio(n: number | null, d: number | null): number | null {
  return n != null && d != null && d > 0 ? n / d : null;
}

export function groupOf(row: Pick<StoredStatsRow, "channel" | "audience_kind">): ChannelGroup {
  if (row.channel === "whatsapp") return "whatsapp";
  if (row.channel === "sms") return "sms";
  return row.audience_kind === "ticket_holder" ? "email_ticket_holder" : "email_marketing";
}

export function broadcastStat(row: StoredStatsRow, rate: MessageRate, openRatio: number | null): BroadcastStat {
  const isEmail = row.channel === "email";
  const cost =
    row.channel === "whatsapp" && rate.rate != null && row.delivered != null ? row.delivered * rate.rate : null;
  return {
    id: row.id,
    provider: row.provider,
    channel: row.channel,
    audienceKind: row.audience_kind,
    attribution: row.attribution,
    eventId: row.event_id,
    name: row.name,
    sentAt: row.sent_at,
    sent: row.sent,
    delivered: row.delivered,
    read: isEmail ? null : row.read,
    readRate: isEmail ? null : ratio(row.read, row.delivered),
    opens: isEmail ? resolveOpens(row, openRatio) : null,
    clicked: row.clicked,
    clickRate: ratio(row.clicked, row.delivered),
    cost,
    costPerClick: cost != null && row.clicked != null && row.clicked > 0 ? cost / row.clicked : null,
  };
}

const GROUP_ORDER: ChannelGroup[] = ["whatsapp", "sms", "email_marketing", "email_ticket_holder"];

/**
 * Summarise `rows` (the show's or the client's). `ratioRows` are the
 * client's own email rows the "est." ratio comes from; they default to
 * `rows`, but a show view should pass the whole client's.
 */
export function summariseD2CStats(
  rows: readonly StoredStatsRow[],
  rate: MessageRate,
  ratioRows: readonly StoredStatsRow[] = rows,
): D2CStatsSummary {
  const openRatio = clientOpenRatio(ratioRows.filter((r) => r.channel === "email"));
  const broadcasts = rows
    .map((r) => broadcastStat(r, rate, openRatio))
    .sort((a, b) => (b.sentAt ?? "").localeCompare(a.sentAt ?? "") || a.id.localeCompare(b.id));

  const channels: ChannelTotals[] = [];
  for (const group of GROUP_ORDER) {
    const inGroup = broadcasts.filter((b) => groupOf({ channel: b.channel, audience_kind: b.audienceKind }) === group);
    if (inGroup.length === 0) continue;
    const isEmail = group.startsWith("email");
    let sent = 0;
    let delivered = 0;
    let clicked = 0;
    let read = 0;
    let readDelivered = 0;
    let opens = 0;
    let openDelivered = 0;
    let anyOpens = false;
    let estimated = false;
    let cost = 0;
    let anyCost = false;
    for (const b of inGroup) {
      sent += b.sent ?? 0;
      delivered += b.delivered ?? 0;
      clicked += b.clicked ?? 0;
      if (!isEmail && b.read != null) {
        read += b.read;
        readDelivered += b.delivered ?? 0;
      }
      if (b.opens?.opens != null) {
        anyOpens = true;
        opens += b.opens.opens;
        openDelivered += b.delivered ?? 0;
        if (b.opens.estimated) estimated = true;
      }
      if (b.cost != null) {
        anyCost = true;
        cost += b.cost;
      }
    }
    const totalCost = group === "whatsapp" && anyCost ? cost : null;
    channels.push({
      group,
      broadcasts: inGroup.length,
      sent,
      delivered,
      read: isEmail ? null : read,
      readRate: isEmail ? null : ratio(read, readDelivered),
      opens: isEmail && anyOpens ? opens : null,
      openRate: isEmail && anyOpens ? ratio(opens, openDelivered) : null,
      opensEstimated: isEmail && estimated,
      clicked,
      clickRate: ratio(clicked, delivered),
      cost: totalCost,
      costPerClick: totalCost != null && clicked > 0 ? totalCost / clicked : null,
    });
  }

  return { currency: rate.currency, ratePerMessage: rate.rate, openRatio, broadcasts, channels };
}
