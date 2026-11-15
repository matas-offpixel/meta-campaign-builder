/**
 * lib/d2c/stats-ingest/types.ts
 *
 * HE3 (dashboard v2 phase 2, E5): direct-to-fan send stats, one row per
 * Bird campaign or Mailchimp campaign, stored in `d2c_broadcast_stats`
 * (migration 246). Pure module: relative imports only, so `node --test`
 * can load it.
 */

export type D2CStatsProvider = "bird" | "mailchimp";
export type D2CStatsChannel = "whatsapp" | "sms" | "email";
export type D2CStatsAttribution = "show" | "client" | "unattributed";
export type D2CAudienceKind = "marketing" | "ticket_holder";

/** One audience a send targeted: a Bird list or a Mailchimp segment/tag. */
export interface D2CAudienceRef {
  id: string;
  name: string | null;
  /** false for a Mailchimp `static_not` condition or a Bird exclude. */
  include: boolean;
}

export interface D2CAudience {
  /** Mailchimp `match` (Bird includes are a union, so "any"). */
  mode: "any" | "all";
  /** True when the send went to the whole list / audience. */
  wholeList: boolean;
  refs: D2CAudienceRef[];
  /**
   * Conditions that widen a match-any union beyond its tags: a non-tag
   * condition (e.g. Mailchimp predicted age) or a Mailchimp `static_not`
   * under match: any ("everyone not tagged X"). Under match: all they
   * narrow, and the mappers do not count them.
   */
  otherConditions: number;
}

/** A row as written to d2c_broadcast_stats. Null counts are left out on write. */
export interface D2CStatsRow {
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
  list_id: string | null;
  channel_ids: string[] | null;
  audience: D2CAudience | null;
  sent: number | null;
  delivered: number | null;
  read: number | null;
  clicked: number | null;
  opens_unique_raw: number | null;
  opens_unique_filtered: number | null;
  open_rate_filtered: number | null;
  bounces: number | null;
  unsubscribes: number | null;
  raw: Record<string, unknown> | null;
  fetched_at: string;
}

/** A show the ingest can attribute a send to. */
export interface D2CShowKey {
  eventId: string;
  clientId: string;
  /** events.mailchimp_tag — the show's tag, usually `CQ-{slug}`. */
  tag: string | null;
  /** events.cirqlin_page_slug — the `{slug}` of the `CQ-{slug}` list. */
  slug: string | null;
  /** events.mailchimp_audience_id — a Mailchimp tag only counts on this list. */
  mailchimpAudienceId: string | null;
}

/** An account read once per run: a Bird workspace or a Mailchimp account. */
export interface D2CStatsSource {
  provider: D2CStatsProvider;
  /** Bird workspace id; for Mailchimp the server prefix until the account id is read. */
  accountHint: string;
  /** Clients whose connections point at this account (more than one = shared). */
  clientIds: string[];
  /** d2c_connections ids that point at this account, or "env:VAR" for a local key. */
  connectionIds: string[];
  apiKey: string;
  /** Mailchimp only. */
  serverPrefix?: string;
}

/** Counts a run reports. No names, no ids of people. */
export interface D2CStatsSourceSummary {
  provider: D2CStatsProvider;
  accountId: string;
  connectionIds: string[];
  calls: number;
  rows: number;
  byAttribution: Record<D2CStatsAttribution, number>;
  byChannel: Partial<Record<D2CStatsChannel, number>>;
  ticketHolderRows: number;
  /** Notes worth recording per workspace (e.g. a 403 on /groups). */
  notes: string[];
  error?: string;
}
