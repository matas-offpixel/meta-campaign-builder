/**
 * lib/dashboard/direct-to-fan.ts
 *
 * E5 "Direct-to-fan" (dashboard v2 phase 2, HE3 panel): Bird and
 * Mailchimp send stats as the panel draws them, per show, venue or client,
 * built from the HE3 read helpers (lib/d2c/stats-ingest). Pure.
 *
 * Rulings: 2026-11-13-dashboard-v2-phase-2.html (E5, EV4) as amended by
 * 2026-11-15-dashboard-v2-phase-2-ingest.html (PI4–PI7):
 *   - the email open rate is the bot-filtered figure only; the raw rate is
 *     never shown, internally or on the share link (PI4);
 *   - click rate = clicks ÷ delivered, the like-for-like figure;
 *   - WhatsApp cost = delivered × the client's per-message rate; with no
 *     rate, "Rate not set" internally (linked to the rate field) and "—"
 *     on the share link, never £0 (PI5);
 *   - a show's figures never include a whole-list send; the client view
 *     lists them as "Whole list"; a venue view counts one only when its
 *     audience belongs to that venue; unattributed sends are one internal
 *     review line (PI6).
 *
 * Relative imports only: the `node --test` runner can't resolve `@/`.
 */

import { summariseD2CStats, type BroadcastStat, type ChannelGroup, type ChannelTotals, type MessageRate, type StoredStatsRow } from "../d2c/stats-ingest/summary.ts";
import type { D2CShowVenue } from "../d2c/stats-ingest/read.ts";
import { cqListNames } from "../d2c/stats-ingest/attribution.ts";

export const DIRECT_TO_FAN_TITLE = "Direct-to-fan";
export const RATE_NOT_SET = "Rate not set";
export const WHOLE_LIST = "Whole list";
/** A client's own send that matched no show and is not its whole list (migration 248). */
export const NOT_TIED = "Not tied to a show";
export const BOT_FILTER_FOOTNOTE = "Email opens are Mailchimp's bot-filtered opens: Apple Mail Privacy and link-scanner opens removed.";
export const DIRECT_TO_FAN_EMPTY = "No direct-to-fan sends yet";
export const CLICK_RATE_TITLE = "Click rate · clicks ÷ delivered";

export type D2CSurface = "internal" | "share";

export type D2CScope =
  | { kind: "client"; label: string }
  | { kind: "venue"; label: string; venueKey: string | null }
  | { kind: "show"; label: string; eventId: string };

export type ChannelRow = {
  group: ChannelGroup;
  label: string;
  sendsText: string;
  deliveredText: string;
  readOpenedText: string;
  clickedText: string;
  clickRateText: string;
  /** "£8,147", "—", or RATE_NOT_SET (internal, WhatsApp with no rate). */
  costText: string;
  costPerClickText: string;
  /** True when costText is RATE_NOT_SET: drawn muted and linked to the client's rate field. */
  rateNotSet: boolean;
  clickRate: number | null;
};

export type SendRow = {
  id: string;
  dayText: string;
  name: string;
  /** The show's name, WHOLE_LIST or NOT_TIED. */
  showText: string;
  channelText: string;
  deliveredText: string;
  readOpenedText: string;
  clickedText: string;
  clickRateText: string;
};

export type PhoneRate = { label: string; rateText: string; clickRate: number | null };

export type PhoneCost = { label: string; text: string; rateNotSet: boolean };

export type DirectToFanModel = {
  title: string;
  /** "WhatsApp vs email · Electric Group". */
  tableTitle: string;
  empty: string | null;
  channels: ChannelRow[];
  /** "WhatsApp's click rate is 3.68× email's. …"; null without both channels. */
  headline: string | null;
  /** "Electric Group · 281 sends · 3 Jul – 13 Nov · includes 234 whole-list sends". */
  totalsLine: string;
  /** PI4's footnote when any email row is drawn. */
  footnote: string | null;
  /** PI6's internal review line; always null on the share link. */
  reviewLine: string | null;
  /** PT1: not-tied sends whose audience couldn't be read; internal only, null on a show. */
  unreadLine: string | null;
  sends: SendRow[];
  /** Whether the Show column is drawn (not on a show's own view). */
  showColumn: boolean;
  /** Whether the Send column is drawn: false when no send has a name, so a column of "—" never reads as "no sends". */
  nameColumn: boolean;
  /** EV4 393. */
  phone: { title: string; rates: PhoneRate[]; costs: PhoneCost[] };
  /** Where "Rate not set" links (internal only). */
  rateHref: string | null;
};

// ---- formatting -----------------------------------------------------------

const DASH = "—";
const SYMBOL: Record<string, string> = { GBP: "£", EUR: "€", USD: "$" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function sym(currency: string): string {
  return SYMBOL[currency] ?? `${currency} `;
}
function money0(v: number, currency: string): string {
  return `${sym(currency)}${Math.round(v).toLocaleString("en-GB")}`;
}
function money2(v: number, currency: string): string {
  return `${sym(currency)}${v.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function count(v: number | null): string {
  return v == null ? DASH : Math.round(v).toLocaleString("en-GB");
}
/** 0..1 → "13.4 %"; under 1 % gets two places ("0.52 %"), as EV4's small rates would otherwise read 0.5 %. */
export function ratePct(v: number | null): string {
  if (v == null) return DASH;
  const p = v * 100;
  return `${p > 0 && p < 1 ? p.toFixed(2) : p.toFixed(1)} %`;
}
/** "2026-11-13T18:00:00Z" → "13 Nov" (London date). */
export function sendDay(iso: string | null): string {
  if (!iso) return DASH;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return DASH;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "numeric" }).formatToParts(d);
  const day = Number(parts.find((p) => p.type === "day")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  return `${day} ${MONTHS[month - 1]}`;
}

/** The year a moment falls in, in London (the panel's dates are London dates). */
export function londonYear(iso: string | number): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric" }).format(d);
}

/**
 * A send's day as the Sends table shows it: "13 Nov" in the current year,
 * "1 Dec 2022" in an earlier one. The current year is `nowMs`'s, in London,
 * never the machine clock read here.
 */
export function sendDate(iso: string | null, nowMs: number): string {
  const day = sendDay(iso);
  if (day === DASH || !iso) return day;
  const year = londonYear(iso);
  return year && year !== londonYear(nowMs) ? `${day} ${year}` : day;
}

// ---- scope ----------------------------------------------------------------

/**
 * PI6's venue rule: a Mailchimp audience belongs to a venue when that
 * venue's shows name it (events.mailchimp_audience_id) and no other
 * venue's show does.
 */
export function venueAudiences(shows: readonly D2CShowVenue[], venueKey: string | null): Set<string> {
  const byAudience = new Map<string, Set<string | null>>();
  for (const s of shows) {
    if (!s.mailchimp_audience_id) continue;
    const venues = byAudience.get(s.mailchimp_audience_id) ?? new Set<string | null>();
    venues.add(s.venue_key ?? null);
    byAudience.set(s.mailchimp_audience_id, venues);
  }
  const out = new Set<string>();
  for (const [audience, venues] of byAudience) if (venues.size === 1 && venues.has(venueKey)) out.add(audience);
  return out;
}

/**
 * PT3: the CQ lists (and tiers) of the umbrella events at a venue, names as
 * stored. A whole-list send to one of them counts on that venue's view.
 */
export function venueUmbrellaLists(shows: readonly D2CShowVenue[], venueKey: string | null): Set<string> {
  const out = new Set<string>();
  for (const s of shows) {
    if (s.is_umbrella !== true || (s.venue_key ?? null) !== venueKey) continue;
    for (const name of cqListNames(s.cirqlin_page_slug)) out.add(name);
  }
  return out;
}

function namesUmbrellaList(row: StoredStatsRow, lists: ReadonlySet<string>): boolean {
  if (!lists.size || !Array.isArray(row.audience_refs)) return false;
  return row.audience_refs.some((ref) => ref.include && typeof ref.name === "string" && lists.has(ref.name));
}

/**
 * The sends that count in a scope. Unattributed sends never count anywhere
 * (PI6). A not-tied send counts like a whole-list one: on the client, and on
 * a venue only when its Mailchimp audience is that venue's; never in a show.
 * A whole-list send to an umbrella event's list also counts on the umbrella
 * event's venue, by Bird or Mailchimp (PT3).
 */
export function scopeRows(rows: readonly StoredStatsRow[], shows: readonly D2CShowVenue[], scope: D2CScope): StoredStatsRow[] {
  if (scope.kind === "show") return rows.filter((r) => r.attribution === "show" && r.event_id === scope.eventId);
  if (scope.kind === "client") return rows.filter((r) => r.attribution !== "unattributed");
  const ids = new Set(shows.filter((s) => (s.venue_key ?? null) === scope.venueKey).map((s) => s.id));
  const audiences = venueAudiences(shows, scope.venueKey);
  const umbrellaLists = venueUmbrellaLists(shows, scope.venueKey);
  return rows.filter(
    (r) =>
      (r.attribution === "show" && r.event_id != null && ids.has(r.event_id)) ||
      ((r.attribution === "client" || r.attribution === "not_tied") && r.provider === "mailchimp" && r.list_id != null && audiences.has(r.list_id)) ||
      (r.attribution === "client" && namesUmbrellaList(r, umbrellaLists)),
  );
}

// ---- rows -----------------------------------------------------------------

const CHANNEL_LABEL: Record<ChannelGroup, string> = {
  whatsapp: "WhatsApp (Bird) · read receipts",
  sms: "SMS (Bird)",
  email_marketing: "Email · marketing · bot-filtered",
  email_ticket_holder: "Email · ticket holders · bot-filtered",
};

const PHONE_LABEL: Record<ChannelGroup, string> = {
  whatsapp: "WhatsApp",
  sms: "SMS",
  email_marketing: "Email · marketing",
  email_ticket_holder: "Email · tickets",
};

function readOpened(c: { group?: ChannelGroup; channel?: string; readRate: number | null; openRate: number | null; estimated: boolean }): string {
  const email = c.group ? c.group.startsWith("email") : c.channel === "email";
  if (email) return c.openRate == null ? DASH : `${ratePct(c.openRate)}${c.estimated ? " (est.)" : ""}`;
  return c.readRate == null ? DASH : `${ratePct(c.readRate)} read`;
}

function channelRow(c: ChannelTotals, currency: string, surface: D2CSurface, ratePerMessage: number | null): ChannelRow {
  const isEmail = c.group.startsWith("email");
  const rateNotSet = c.group === "whatsapp" && ratePerMessage == null && surface === "internal";
  const costText = c.cost != null ? money0(c.cost, currency) : rateNotSet ? RATE_NOT_SET : DASH;
  return {
    group: c.group,
    label: `${CHANNEL_LABEL[c.group]}${isEmail && c.opensEstimated ? " (est.)" : ""}`,
    sendsText: count(c.broadcasts),
    deliveredText: count(c.delivered),
    readOpenedText: readOpened({ group: c.group, readRate: c.readRate, openRate: c.openRate, estimated: c.opensEstimated }),
    clickedText: count(c.clicked),
    clickRateText: ratePct(c.clickRate),
    costText,
    costPerClickText: c.costPerClick != null ? money2(c.costPerClick, currency) : DASH,
    rateNotSet,
    clickRate: c.clickRate,
  };
}

function sendRow(b: BroadcastStat, showName: (eventId: string) => string, nowMs: number): SendRow {
  const channelText =
    b.channel === "whatsapp" ? "WhatsApp" : b.channel === "sms" ? "SMS" : b.audienceKind === "ticket_holder" ? "Email · ticket holders" : "Email";
  return {
    id: b.id,
    dayText: sendDate(b.sentAt, nowMs),
    name: b.name ?? DASH,
    showText: b.attribution === "show" && b.eventId ? showName(b.eventId) : b.attribution === "not_tied" ? NOT_TIED : WHOLE_LIST,
    channelText,
    deliveredText: count(b.delivered),
    readOpenedText: readOpened({ channel: b.channel, readRate: b.readRate, openRate: b.opens?.rate ?? null, estimated: b.opens?.estimated ?? false }),
    clickedText: count(b.clicked),
    clickRateText: ratePct(b.clickRate),
  };
}

/** E5's headline: click rates, never open rates. WhatsApp against all email. */
export function clickHeadline(channels: readonly ChannelTotals[]): string | null {
  const wa = channels.find((c) => c.group === "whatsapp");
  const emails = channels.filter((c) => c.group.startsWith("email"));
  const emailDelivered = emails.reduce((s, c) => s + c.delivered, 0);
  const emailClicked = emails.reduce((s, c) => s + c.clicked, 0);
  if (!wa || wa.clickRate == null || !emails.length || emailDelivered <= 0) return null;
  const email = emailClicked / emailDelivered;
  const estimated = emails.some((c) => c.opensEstimated);
  const opens = `Clicks are the like-for-like figure: WhatsApp's opens are read receipts, and email's are ${estimated ? "estimates after bot filtering" : "bot-filtered"}.`;
  if (email <= 0 || wa.clickRate <= 0) return opens;
  const times = (a: number, b: number) => `${(a / b).toFixed(2)}×`;
  const lead = wa.clickRate >= email ? `WhatsApp's click rate is ${times(wa.clickRate, email)} email's.` : `Email's click rate is ${times(email, wa.clickRate)} WhatsApp's.`;
  return `${lead} ${opens}`;
}

/**
 * The totals line's send span, earliest to latest send. `firstSentAt` is the
 * scope's real first send when the summary carries only some of its sends
 * (the frames' fixture), so the span never starts at a row the frame happens
 * to show. The year rule (London years; the current year is `nowMs`'s):
 *   - across years, both years: "1 Dec 2022 – 13 Nov 2026";
 *   - wholly inside an earlier year, the year once at the end: "3 Jul – 13 Nov 2025";
 *   - inside the current year, no year: "10 Sep – 13 Nov".
 */
export function sendSpan(sentAts: readonly (string | null)[], firstSentAt: string | null | undefined, nowMs: number): string | null {
  const days = [...sentAts, firstSentAt ?? null]
    .filter((d): d is string => !!d && !Number.isNaN(new Date(d).getTime()))
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  if (!days.length) return null;
  const firstIso = days[0]!;
  const lastIso = days[days.length - 1]!;
  const first = sendDay(firstIso);
  const last = sendDay(lastIso);
  const y1 = londonYear(firstIso);
  const y2 = londonYear(lastIso);
  if (y1 && y2 && y1 !== y2) return `${first} ${y1} – ${last} ${y2}`;
  const span = first === last ? first : `${first} – ${last}`;
  return y2 && y2 !== londonYear(nowMs) ? `${span} ${y2}` : span;
}

/** Options every scope's panel takes. `nowMs` decides the current year for dates (Date.now() when left out). */
export type DirectToFanOpts = { surface: D2CSurface; showName: (eventId: string) => string; rateHref: string | null; nowMs?: number };

export type DirectToFanInput = {
  /** The client's stored rows (every attribution). */
  rows: readonly StoredStatsRow[];
  rate: MessageRate;
  shows: readonly D2CShowVenue[];
  unattributed: number;
};

/**
 * The panel for one scope. `showName` names a show for the Show column;
 * `rateHref` is where internal "Rate not set" links.
 */
export function buildDirectToFan(
  input: DirectToFanInput,
  scope: D2CScope,
  opts: DirectToFanOpts,
): DirectToFanModel {
  const scoped = scopeRows(input.rows, input.shows, scope);
  const ratioRows = input.rows.filter((r) => r.attribution !== "unattributed");
  const summary = summariseD2CStats(scoped, input.rate, ratioRows);
  return modelFromSummary(summary, scope, opts, input.unattributed);
}

/**
 * PT1: "includes {w} whole-list sends and {t} sends not tied to a show". A
 * clause with 0 is dropped; with both 0 there is no clause.
 */
export function includesClause(wholeList: number, notTied: number): string | null {
  const parts = [
    wholeList > 0 ? `${wholeList.toLocaleString("en-GB")} whole-list ${wholeList === 1 ? "send" : "sends"}` : null,
    notTied > 0 ? `${notTied.toLocaleString("en-GB")} ${notTied === 1 ? "send" : "sends"} not tied to a show` : null,
  ].filter((p): p is string => p !== null);
  return parts.length ? `includes ${parts.join(" and ")}` : null;
}

/** PT1's internal line for not-tied sends whose audience couldn't be read. */
export function unreadText(n: number): string {
  return n === 1
    ? "1 send's audience couldn't be read, so it isn't tied to a show."
    : `${n.toLocaleString("en-GB")} sends' audiences couldn't be read, so they aren't tied to a show.`;
}

/** The same model from a summary (fixtures, and the scope already filtered). */
export function modelFromSummary(
  summary: ReturnType<typeof summariseD2CStats>,
  scope: D2CScope,
  opts: DirectToFanOpts,
  unattributed: number,
  sendCount?: { sends: number; wholeList: number; notTied?: number; unread?: number; firstSentAt?: string },
): DirectToFanModel {
  const channels = summary.channels.map((c) => channelRow(c, summary.currency, opts.surface, summary.ratePerMessage));
  const nowMs = opts.nowMs ?? Date.now();
  const sends = summary.broadcasts.map((b) => sendRow(b, opts.showName, nowMs));
  const total = sendCount?.sends ?? summary.broadcasts.length;
  const wholeList = sendCount?.wholeList ?? summary.broadcasts.filter((b) => b.attribution === "client").length;
  const notTiedRows = summary.broadcasts.filter((b) => b.attribution === "not_tied");
  const notTied = sendCount?.notTied ?? notTiedRows.length;
  const unread = sendCount?.unread ?? notTiedRows.filter((b) => !b.audienceRead).length;
  const totalsLine = [
    scope.label,
    `${total.toLocaleString("en-GB")} ${total === 1 ? "send" : "sends"}`,
    sendSpan(summary.broadcasts.map((b) => b.sentAt), sendCount?.firstSentAt, nowMs),
    scope.kind !== "show" ? includesClause(wholeList, notTied) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const hasEmail = summary.channels.some((c) => c.group.startsWith("email"));
  const rates = [...channels]
    .sort((a, b) => (b.clickRate ?? -1) - (a.clickRate ?? -1))
    .map((c): PhoneRate => ({ label: PHONE_LABEL[c.group], rateText: c.clickRateText, clickRate: c.clickRate }));
  const costs: PhoneCost[] = [];
  for (const c of channels) {
    if (c.group === "whatsapp") costs.push({ label: "WhatsApp", text: c.costPerClickText !== DASH ? `${c.costPerClickText} a click` : c.rateNotSet ? RATE_NOT_SET : DASH, rateNotSet: c.rateNotSet && c.costPerClickText === DASH });
    if (c.group === "sms") costs.push({ label: "SMS", text: c.costPerClickText, rateNotSet: false });
  }
  if (hasEmail) costs.push({ label: "email", text: DASH, rateNotSet: false });
  return {
    title: DIRECT_TO_FAN_TITLE,
    tableTitle: `WhatsApp vs email · ${scope.label}`,
    empty: summary.broadcasts.length || sendCount?.sends ? null : DIRECT_TO_FAN_EMPTY,
    channels,
    headline: clickHeadline(summary.channels),
    totalsLine,
    footnote: hasEmail ? BOT_FILTER_FOOTNOTE : null,
    reviewLine:
      opts.surface === "internal" && unattributed > 0
        ? `${unattributed.toLocaleString("en-GB")} ${unattributed === 1 ? "send" : "sends"} on a shared account couldn't be tied to a client.`
        : null,
    unreadLine: opts.surface === "internal" && scope.kind !== "show" && unread > 0 ? unreadText(unread) : null,
    sends,
    showColumn: scope.kind !== "show",
    nameColumn: sends.some((s) => s.name !== DASH),
    phone: { title: CLICK_RATE_TITLE, rates, costs },
    rateHref: opts.surface === "internal" ? opts.rateHref : null,
  };
}
