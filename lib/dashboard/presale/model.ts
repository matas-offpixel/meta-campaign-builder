/**
 * lib/dashboard/presale/model.ts
 *
 * HE4, the presale log: pure. Turns a show's stored rows into E3's figures,
 * each naming its source (docs/design-record/2026-11-13-dashboard-v2-phase-2.html
 * E2, E3, EV2; PB4 of 2026-11-15-dashboard-v2-panels-and-he2-gaps.html).
 *
 * Sources are E3's four words:
 *   counted  read from a system (CIRQLIN, Internal Counts, Meta).
 *   entered  typed into the presale log, with who and when.
 *   derived  worked out from other figures.
 *   est.     an estimate. A figure built on an estimate is an estimate.
 *
 * Rules, each from E3 unless marked:
 *   - Window start: entered, else presale open − 30 min (derived).
 *   - Signups at presale: CIRQLIN's daily signups on the days before the
 *     presale day. A daily count can't be split at the open, so the presale
 *     day itself is left out and `throughDay` says where the count stops.
 *     Days are the page's own days (signup_source_snapshots.day). The figure
 *     names its last day: "Signups at presale · to Tue 4 Aug" (design's
 *     ruling on #1255, the weekday worked out from the date).
 *     A show with no CIRQLIN history falls back to its Mailchimp tag's
 *     stored count for that same last day (the day's 12:00Z row in
 *     mailchimp_tag_snapshots), from "Mailchimp · {tag} · {day}". Never
 *     today's count and never a nearer day: with no row for that day the
 *     figure is missing ("no_mailchimp_count_for_day").
 *   - Community at presale: the entered member count nearest before
 *     presale (counted on or before the presale day). PB4: until HE4 the
 *     record falls back to CIRQLIN community_joined up to presale open; a
 *     dated community_joined read doesn't exist yet (see
 *     DATED_COMMUNITY_JOINED_NEEDS), so without an entered count the figure
 *     is missing, never today's all-time count.
 *   - Presale-day tickets: counted from Internal Counts when a count lands
 *     within 24 h after presale open (the latest such count's paid tickets,
 *     less the paid tickets of the latest count that landed before the
 *     open). Otherwise the entered figure, marked entered.
 *   - Community conversion: sold in window ÷ community at presale.
 *   - Wider conversion: (presale-day tickets − sold in window) ÷
 *     (signups at presale − community at presale).
 *   - Signup spend per presale ticket: the show's registration-objective
 *     spend ÷ presale-day tickets. Meta only for now, from "Meta signup
 *     spend"; TikTok joins once HE6 stores TikTok's objective.
 *   - Presale return (est.): presale-day tickets × average ticket price ÷
 *     registration-objective spend. Always "est.". The price is entered,
 *     else the presale-day count's own paid revenue ÷ paid tickets when
 *     Internal Counts hasn't held its revenue ("from tier prices").
 *   - Relaunches: signups since each relaunch date, counted from CIRQLIN,
 *     through the latest day held.
 *   - Nothing entered yet: the counted half, and "Add the window figures".
 *
 * Relative imports only: the `node --test` runner can't resolve `@/`.
 */

export type FigureSource = "counted" | "entered" | "derived" | "est.";

export const ADD_WINDOW_FIGURES = "Add the window figures";

/**
 * Who typed an entered figure in, and when. `by` is the auth user id
 * (entered_by); `name` is that person's first name for "entered by {name},
 * {date}" (enteredByWords), null when the read couldn't resolve it.
 */
export interface Entered {
  by: string | null;
  at: string;
  name: string | null;
}

/** entered_by id → first name, as the read helper resolved them. */
export type EnteredNames = ReadonlyMap<string, string>;

/** The source words for Meta's registration-objective spend (design's ruling on #1255). */
export const META_SIGNUP_SPEND = "Meta signup spend";

export type MissingReason =
  /** events.presale_at is not set, so nothing tied to the open can be read. */
  | "no_presale_time"
  /** The show has no CIRQLIN signup history (no linked page, or only sentinel rows). */
  | "no_cirqlin_signups"
  /** CIRQLIN rows exist but none falls on a day before the presale. */
  | "no_signups_before_presale"
  /** No CIRQLIN history; the Mailchimp tag has no stored count (12:00Z row) for the day before presale. */
  | "no_mailchimp_count_for_day"
  /** Nobody has entered it. */
  | "not_entered"
  /** No Internal Counts count landed within 24 h after presale open, and none was entered. */
  | "no_count_within_24h"
  /** No registration-objective spend is attributed to the show. */
  | "no_registration_spend"
  /** A figure this one is worked out from is missing. */
  | "needs_inputs"
  /** The denominator is zero or below (e.g. community ≥ signups). */
  | "not_meaningful";

export type Figure<T> =
  | {
      kind: "value";
      value: T;
      source: FigureSource;
      /** The system or input it came from, e.g. "CIRQLIN", "Internal Counts", "Meta signup spend", "Mailchimp · {tag} · Tue 4 Aug". */
      from: string;
      /** Set on entered figures. */
      entered: Entered | null;
      /** Figure-specific detail (the day a count stops, the count that was used). */
      detail?: Record<string, string | number | null>;
    }
  | { kind: "missing"; reason: MissingReason };

// ── inputs ──────────────────────────────────────────────────────────────

export interface PresaleLogRow {
  window_start_at: string | null;
  window_start_entered_by: string | null;
  window_start_entered_at: string | null;
  sold_in_window: number | null;
  sold_in_window_entered_by: string | null;
  sold_in_window_entered_at: string | null;
  avg_ticket_price: number | string | null;
  avg_ticket_price_entered_by: string | null;
  avg_ticket_price_entered_at: string | null;
  presale_day_tickets: number | null;
  presale_day_tickets_entered_by: string | null;
  presale_day_tickets_entered_at: string | null;
}

export interface RelaunchRow {
  id: string;
  relaunched_on: string;
  what_we_did: string;
  entered_by: string | null;
  entered_at: string;
  result: string | null;
  result_entered_by: string | null;
  result_entered_at: string | null;
}

export interface MemberCountRow {
  counted_on: string;
  members: number;
  entered_by: string | null;
  entered_at: string;
}

/** One CIRQLIN day: signup_source_snapshots, sentinel rows already dropped. */
export interface SignupDay {
  day: string;
  signups: number;
}

/** One written Internal Counts count for the show, with when it landed (the email's Date header, else received). */
export interface InternalCount {
  blockId: string;
  landedAt: string;
  countDate: string | null;
  paid: number;
  /** Paid revenue in pence, null when Internal Counts holds it. */
  paidRevenuePence: number | null;
}

export interface PresaleInputs {
  eventId: string;
  /** events.presale_at. */
  presaleAt: string | null;
  /** Time zone that decides the presale day. Europe/London unless the caller knows better. */
  timeZone?: string;
  log: PresaleLogRow | null;
  relaunches: readonly RelaunchRow[];
  memberCounts: readonly MemberCountRow[];
  /** Null when the show has no CIRQLIN history at all. */
  signupDays: readonly SignupDay[] | null;
  internalCounts: readonly InternalCount[];
  /** The show's registration-objective spend (Meta), or null when none is attributed. */
  registrationSpend: number | null;
  /**
   * The fallback for "Signups at presale" when the show has no CIRQLIN
   * history: the Mailchimp tag's stored count for the day before presale.
   * Null when the show has no tag (or the caller didn't read it).
   */
  mailchimp?: MailchimpDayCount | null;
  /** entered_by id → name; ids not in it read as name null. */
  names?: EnteredNames;
}

/** One Mailchimp tag's stored count for one day: that day's 12:00Z mailchimp_tag_snapshots row. */
export interface MailchimpDayCount {
  tag: string;
  day: string;
  /** email_subscribers on that row; null when the tag has no row for the day. */
  subscribers: number | null;
}

// ── output ──────────────────────────────────────────────────────────────

export interface RelaunchView {
  id: string;
  on: string;
  whatWeDid: Figure<string>;
  result: Figure<string>;
  signupsSince: Figure<number>;
}

export interface PresaleLog {
  eventId: string;
  presaleOpenAt: string | null;
  /** The presale day in `timeZone`. */
  presaleDay: string | null;
  /** "Signups at presale · to Tue 4 Aug": the figure's name with its last day. Null without a presale time. */
  signupsAtPresaleLabel: string | null;
  /** "empty" = nothing entered yet: show the counted half and {@link ADD_WINDOW_FIGURES}. */
  state: "empty" | "entered";
  prompt: typeof ADD_WINDOW_FIGURES | null;
  windowStart: Figure<string>;
  signupsAtPresale: Figure<number>;
  communityAtPresale: Figure<number>;
  soldInWindow: Figure<number>;
  presaleDayTickets: Figure<number>;
  averageTicketPrice: Figure<number>;
  registrationSpend: Figure<number>;
  communityConversion: Figure<number>;
  widerConversion: Figure<number>;
  signupSpendPerPresaleTicket: Figure<number>;
  /** Ticket revenue the presale day is estimated to have brought in. Always "est.". */
  presaleRevenue: Figure<number>;
  /** presaleRevenue ÷ registrationSpend. Always "est.". */
  presaleReturn: Figure<number>;
  relaunches: RelaunchView[];
}

/**
 * PB4 / PA3: what a dated CIRQLIN community_joined read would need before
 * "Community at presale" can fall back to it. Listed, not built (HE4 brief).
 */
export const DATED_COMMUNITY_JOINED_NEEDS: readonly string[] = [
  "CIRQLIN: the partner page-audience read accepts to= (an instant), and community_joined counts only joins at or before it.",
  "CIRQLIN: the join time is stored per join (today community_joined is an all-time count as of the read).",
  "Ours: a stored figure per show at presale (event_id, as_of = events.presale_at, community_joined), read once after presale open; a past presale never changes, so it is never re-read.",
  "Ours: the read uses the instant, not cirqlin_page_audience.fetch_day; HE2's nightly rows began 15 Nov 2026, so presales before then have no row to fall back to.",
  "Ours: when events.presale_at changes, the stored figure is dropped and read again.",
];

export const COMMUNITY_WINDOW_DEFAULT_MINUTES = 30;
export const PRESALE_COUNT_HOURS = 24;

const missing = (reason: MissingReason): Figure<never> => ({ kind: "missing", reason });

function value<T>(v: T, source: FigureSource, from: string, entered: Entered | null = null, detail?: Record<string, string | number | null>): Figure<T> {
  return detail ? { kind: "value", value: v, source, from, entered, detail } : { kind: "value", value: v, source, from, entered };
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function entered(by: string | null, at: string | null, names?: EnteredNames): Entered | null {
  return at ? { by, at, name: (by && names?.get(by)) || null } : null;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** A calendar day (YYYY-MM-DD) as "Tue 4 Aug", the weekday worked out from the date itself. */
export function formatDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "Signups at presale · to Tue 4 Aug": the count's last day is the day before the presale day. */
export function signupsAtPresaleLabel(presaleDay: string | null): string | null {
  return presaleDay ? `Signups at presale · to ${formatDay(prevDay(presaleDay))}` : null;
}

/** "entered by Matas, 4 Aug" (design's ruling on #1255); "entered 4 Aug" when the name isn't known. */
export function enteredByWords(e: Entered, timeZone = "Europe/London"): string {
  const d = new Date(`${dayIn(e.at, timeZone)}T12:00:00Z`);
  const date = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return e.name ? `entered by ${e.name}, ${date}` : `entered ${date}`;
}

/** The calendar day of an instant in a time zone, as YYYY-MM-DD. */
export function dayIn(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(instant));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function prevDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Built on an estimate → an estimate; otherwise derived. */
function derivedFrom(...inputs: Figure<unknown>[]): FigureSource {
  return inputs.some((f) => f.kind === "value" && f.source === "est.") ? "est." : "derived";
}

function ratio(top: Figure<number>, bottom: Figure<number>): Figure<number> {
  if (top.kind !== "value" || bottom.kind !== "value") return missing("needs_inputs");
  if (bottom.value <= 0 || top.value < 0) return missing("not_meaningful");
  return value(top.value / bottom.value, derivedFrom(top, bottom), "Derived");
}

// ── figures ─────────────────────────────────────────────────────────────

export function windowStartFigure(presaleAt: string | null, log: PresaleLogRow | null, names?: EnteredNames): Figure<string> {
  if (log?.window_start_at) return value(log.window_start_at, "entered", "Presale log", entered(log.window_start_entered_by, log.window_start_entered_at, names));
  if (!presaleAt) return missing("no_presale_time");
  const start = new Date(new Date(presaleAt).getTime() - COMMUNITY_WINDOW_DEFAULT_MINUTES * 60_000).toISOString();
  return value(start, "derived", "Presale open − 30 min");
}

export function signupsAtPresaleFigure(
  signupDays: readonly SignupDay[] | null,
  presaleDay: string | null,
  mailchimp: MailchimpDayCount | null = null,
): Figure<number> {
  if (!presaleDay) return missing("no_presale_time");
  if (!signupDays || signupDays.length === 0) return mailchimpSignupsFigure(mailchimp, presaleDay);
  const before = signupDays.filter((d) => d.day < presaleDay);
  if (before.length === 0) return missing("no_signups_before_presale");
  const total = before.reduce((sum, d) => sum + d.signups, 0);
  const days = before.map((d) => d.day).sort();
  return value(total, "counted", "CIRQLIN", null, { fromDay: days[0]!, throughDay: prevDay(presaleDay) });
}

/**
 * The fallback for a show with no CIRQLIN history: the tag's stored count
 * for the day before the presale day, and only that day.
 */
export function mailchimpSignupsFigure(mailchimp: MailchimpDayCount | null, presaleDay: string): Figure<number> {
  const throughDay = prevDay(presaleDay);
  if (!mailchimp || !mailchimp.tag) return missing("no_cirqlin_signups");
  if (mailchimp.day !== throughDay || mailchimp.subscribers == null) return missing("no_mailchimp_count_for_day");
  return value(mailchimp.subscribers, "counted", `Mailchimp · ${mailchimp.tag} · ${formatDay(throughDay)}`, null, { tag: mailchimp.tag, throughDay });
}

/** The entered member count nearest before presale: counted on or before the presale day, latest first. */
export function nearestCountBefore(counts: readonly MemberCountRow[], presaleDay: string): MemberCountRow | null {
  const candidates = counts.filter((c) => c.counted_on <= presaleDay);
  candidates.sort((a, b) => b.counted_on.localeCompare(a.counted_on) || b.entered_at.localeCompare(a.entered_at));
  return candidates[0] ?? null;
}

export function communityAtPresaleFigure(counts: readonly MemberCountRow[], presaleDay: string | null, names?: EnteredNames): Figure<number> {
  if (!presaleDay) return missing("no_presale_time");
  const c = nearestCountBefore(counts, presaleDay);
  if (!c) return missing("not_entered");
  return value(c.members, "entered", "Entered member count", entered(c.entered_by, c.entered_at, names), { countedOn: c.counted_on });
}

export function enteredFigure(v: number | string | null | undefined, by: string | null, at: string | null, names?: EnteredNames): Figure<number> {
  const n = num(v);
  if (n == null || !at) return missing("not_entered");
  return value(n, "entered", "Presale log", entered(by, at, names));
}

/**
 * Internal Counts' presale-day tickets (E3): the latest count that landed
 * in (open, open + 24 h], less the latest count that landed at or before
 * the open (0 when none). Null when no count landed in the window.
 */
export function presaleDayCount(counts: readonly InternalCount[], presaleAt: string): { tickets: number; used: InternalCount; base: InternalCount | null } | null {
  const open = new Date(presaleAt).getTime();
  const end = open + PRESALE_COUNT_HOURS * 3_600_000;
  const at = (c: InternalCount) => new Date(c.landedAt).getTime();
  const latest = (list: InternalCount[]) => list.sort((a, b) => at(b) - at(a) || b.blockId.localeCompare(a.blockId))[0] ?? null;
  const used = latest(counts.filter((c) => at(c) > open && at(c) <= end));
  if (!used) return null;
  const base = latest(counts.filter((c) => at(c) <= open));
  return { tickets: Math.max(0, used.paid - (base?.paid ?? 0)), used, base };
}

export function presaleDayTicketsFigure(counts: readonly InternalCount[], presaleAt: string | null, log: PresaleLogRow | null, names?: EnteredNames): Figure<number> {
  if (presaleAt) {
    const c = presaleDayCount(counts, presaleAt);
    if (c) {
      return value(c.tickets, "counted", "Internal Counts", null, {
        countLandedAt: c.used.landedAt,
        countDate: c.used.countDate,
        countPaid: c.used.paid,
        baseLandedAt: c.base?.landedAt ?? null,
        basePaid: c.base?.paid ?? null,
      });
    }
  }
  const e = enteredFigure(log?.presale_day_tickets, log?.presale_day_tickets_entered_by ?? null, log?.presale_day_tickets_entered_at ?? null, names);
  if (e.kind === "value") return e;
  return missing(presaleAt ? "no_count_within_24h" : "no_presale_time");
}

export function averageTicketPriceFigure(counts: readonly InternalCount[], presaleAt: string | null, log: PresaleLogRow | null, names?: EnteredNames): Figure<number> {
  const e = enteredFigure(log?.avg_ticket_price, log?.avg_ticket_price_entered_by ?? null, log?.avg_ticket_price_entered_at ?? null, names);
  if (e.kind === "value") return e;
  if (presaleAt) {
    const c = presaleDayCount(counts, presaleAt);
    if (c && c.used.paid > 0 && c.used.paidRevenuePence != null && c.used.paidRevenuePence > 0) {
      return value(c.used.paidRevenuePence / 100 / c.used.paid, "derived", "Internal Counts tier prices", null, { countLandedAt: c.used.landedAt });
    }
  }
  return missing("not_entered");
}

function hasAnyEntry(input: PresaleInputs): boolean {
  const l = input.log;
  const logEntered = !!l && !!(l.window_start_entered_at || l.sold_in_window_entered_at || l.avg_ticket_price_entered_at || l.presale_day_tickets_entered_at);
  return logEntered || input.relaunches.length > 0 || input.memberCounts.length > 0;
}

export function buildPresaleLog(input: PresaleInputs): PresaleLog {
  const timeZone = input.timeZone ?? "Europe/London";
  const presaleAt = input.presaleAt;
  const presaleDay = presaleAt ? dayIn(presaleAt, timeZone) : null;
  const log = input.log;
  const names = input.names;

  const signupsAtPresale = signupsAtPresaleFigure(input.signupDays, presaleDay, input.mailchimp ?? null);
  const communityAtPresale = communityAtPresaleFigure(input.memberCounts, presaleDay, names);
  const soldInWindow = enteredFigure(log?.sold_in_window, log?.sold_in_window_entered_by ?? null, log?.sold_in_window_entered_at ?? null, names);
  const presaleDayTickets = presaleDayTicketsFigure(input.internalCounts, presaleAt, log, names);
  const averageTicketPrice = averageTicketPriceFigure(input.internalCounts, presaleAt, log, names);
  const registrationSpend: Figure<number> =
    input.registrationSpend != null && input.registrationSpend > 0
      ? value(input.registrationSpend, "counted", META_SIGNUP_SPEND)
      : missing("no_registration_spend");

  let laterPresaleDay: Figure<number> = missing("needs_inputs");
  if (presaleDayTickets.kind === "value" && soldInWindow.kind === "value") {
    laterPresaleDay = value(presaleDayTickets.value - soldInWindow.value, derivedFrom(presaleDayTickets, soldInWindow), "Derived");
  }
  let widerPool: Figure<number> = missing("needs_inputs");
  if (signupsAtPresale.kind === "value" && communityAtPresale.kind === "value") {
    widerPool = value(signupsAtPresale.value - communityAtPresale.value, derivedFrom(signupsAtPresale, communityAtPresale), "Derived");
  }

  let presaleRevenue: Figure<number> = missing("needs_inputs");
  if (presaleDayTickets.kind === "value" && averageTicketPrice.kind === "value") {
    presaleRevenue = value(presaleDayTickets.value * averageTicketPrice.value, "est.", "Derived");
  }
  const presaleReturnRatio = ratio(presaleRevenue, registrationSpend);
  const presaleReturn: Figure<number> = presaleReturnRatio.kind === "value" ? { ...presaleReturnRatio, source: "est." } : presaleReturnRatio;

  const latestDay = input.signupDays?.length ? [...input.signupDays].map((d) => d.day).sort().at(-1)! : null;
  const relaunches: RelaunchView[] = [...input.relaunches]
    .sort((a, b) => a.relaunched_on.localeCompare(b.relaunched_on) || a.entered_at.localeCompare(b.entered_at))
    .map((r) => {
      let signupsSince: Figure<number>;
      if (!input.signupDays || input.signupDays.length === 0) signupsSince = missing("no_cirqlin_signups");
      else {
        const since = input.signupDays.filter((d) => d.day >= r.relaunched_on);
        signupsSince = value(
          since.reduce((s, d) => s + d.signups, 0),
          "counted",
          "CIRQLIN",
          null,
          { fromDay: r.relaunched_on, throughDay: latestDay },
        );
      }
      return {
        id: r.id,
        on: r.relaunched_on,
        whatWeDid: value(r.what_we_did, "entered", "Presale log", entered(r.entered_by, r.entered_at, names)),
        result: r.result && r.result_entered_at ? value(r.result, "entered", "Presale log", entered(r.result_entered_by, r.result_entered_at, names)) : missing("not_entered"),
        signupsSince,
      };
    });

  const empty = !hasAnyEntry(input);
  return {
    eventId: input.eventId,
    presaleOpenAt: presaleAt,
    presaleDay,
    signupsAtPresaleLabel: signupsAtPresaleLabel(presaleDay),
    state: empty ? "empty" : "entered",
    prompt: empty ? ADD_WINDOW_FIGURES : null,
    windowStart: windowStartFigure(presaleAt, log, names),
    signupsAtPresale,
    communityAtPresale,
    soldInWindow,
    presaleDayTickets,
    averageTicketPrice,
    registrationSpend,
    communityConversion: ratio(soldInWindow, communityAtPresale),
    widerConversion: ratio(laterPresaleDay, widerPool),
    signupSpendPerPresaleTicket: ratio(registrationSpend, presaleDayTickets),
    presaleRevenue,
    presaleReturn,
    relaunches,
  };
}
