/**
 * lib/dashboard/registrations-card-model.ts
 *
 * What the REGISTRATIONS card says, as a pure value.
 *
 * Cirqlin counted signups are the primary number when we have a page
 * for the tag. Mailchimp is the secondary line — subscribed
 * (segment member_count). A tagged-any-status count has no source in
 * this PR and is not invented from member_count.
 *
 * `computeRegistrationsData` is untouched. Cirqlin sits beside it.
 */

import type {
  CirqlinFetchFailureReason,
  CirqlinSnapshotRow,
  CirqlinSyncBucket,
} from "../cirqlin/types.ts";
import type { MailchimpRegistrationsData } from "../mailchimp/compute-registrations.ts";
import {
  signupPhaseCpr,
  signupPhaseSpend,
  type SignupPhaseCpr,
  type SignupPhaseSpendRow,
} from "./signup-phase-cpr.ts";
import {
  cirqlinSignupsInWindow,
  resolveSignupWindow,
  signupCardWindowLine,
} from "./signup-window.ts";

/** Pinned en-GB short months so "Sept" does not depend on ICU. */
const AS_OF_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sept",
  "Oct",
  "Nov",
  "Dec",
] as const;

export function fmtCirqlinAsOf(snapshotAt: string): string {
  const day = snapshotAt.slice(0, 10);
  const month = Number(day.slice(5, 7));
  const d = Number(day.slice(8, 10));
  if (!Number.isFinite(month) || !Number.isFinite(d) || month < 1 || month > 12) {
    return day;
  }
  return `${d} ${AS_OF_MONTHS[month - 1]}`;
}

export type RegistrationsPrimarySource = "cirqlin" | "mailchimp" | "none";

/** Same window `RegistrationsCard` applies to Mailchimp `lastSyncedAt`. */
export const CIRQLIN_STALE_MS = 48 * 3_600_000;

export const CIRQLIN_UNREACHABLE_LINE =
  "Cirqlin could not be reached — showing Mailchimp.";

export interface RegistrationsCardModel {
  source: RegistrationsPrimarySource;
  /** Large number on the card. Null → em-dash. */
  primary: number | null;
  primaryCaption: string | null;
  /** `Counted across 2 Cirqlin pages on this tag.` — scope, not a correction. */
  scopeLine: string | null;
  /** `1,686 subscribed in Mailchimp` */
  mailchimpLine: string | null;
  /** `4 signups did not reach Mailchimp (invalid email)` */
  syncFailureLine: string | null;
  /** Cirqlin was asked and either has no page or did not answer. */
  fallbackLine: string | null;
  /** `4 signups before the campaign window — excluded.` */
  windowLine: string | null;
  cpr: SignupPhaseCpr | null;
}

export interface BuildRegistrationsCardInput {
  mailchimp: MailchimpRegistrationsData | null;
  /**
   * Latest Cirqlin snapshot rows for the event, oldest → newest.
   * A `raw_json.reason === "no_page"` row means Cirqlin answered and
   * has no page for the tag — the card falls back to Mailchimp.
   */
  cirqlinSnapshots: readonly CirqlinSnapshotRow[] | null;
  spendRows: readonly SignupPhaseSpendRow[];
  generalSaleAt: string | null;
  /**
   * Last Cirqlin fetch reason when the caller just tried. `no_page`
   * keeps its own sentence; other failures share the unreachable line.
   */
  cirqlinFailure?: CirqlinFetchFailureReason | null;
  /** Injectable clock so stale captions can be pinned. */
  now?: Date;
  nowMs?: number;
}

const SENTINEL_REASONS = new Set(["no_page", "unauthorized", "error"]);

function snapshotReason(row: CirqlinSnapshotRow | null): string | null {
  const reason = row?.raw_json?.reason;
  return typeof reason === "string" ? reason : null;
}

function isSentinel(row: CirqlinSnapshotRow | null): boolean {
  const reason = snapshotReason(row);
  return reason != null && SENTINEL_REASONS.has(reason);
}

function isNoPage(row: CirqlinSnapshotRow | null): boolean {
  return snapshotReason(row) === "no_page";
}

function latestCirqlin(
  rows: readonly CirqlinSnapshotRow[],
  liveOnly: boolean,
): CirqlinSnapshotRow | null {
  const filtered = liveOnly ? rows.filter((row) => !isSentinel(row)) : [...rows];
  if (filtered.length === 0) return null;
  if (liveOnly) {
    return filtered.sort((a, b) => a.day.localeCompare(b.day)).at(-1) ?? null;
  }
  // Failure markers share 1970-01-01. The latest write is the reason
  // to show — a stale no_page must not outrank a fresh unauthorized.
  return (
    filtered.sort((a, b) => a.snapshot_at.localeCompare(b.snapshot_at)).at(-1) ??
    null
  );
}

function syncFromRaw(raw: Record<string, unknown> | null): CirqlinSyncBucket | null {
  if (!raw) return null;
  const sync = raw.sync;
  if (sync == null || typeof sync !== "object") return null;
  const mailchimp = (sync as { mailchimp?: unknown }).mailchimp;
  if (mailchimp == null || typeof mailchimp !== "object") return null;
  const failed = (mailchimp as { failed?: unknown }).failed;
  const skipped = (mailchimp as { skipped?: unknown }).skipped;
  const synced = (mailchimp as { synced?: unknown }).synced;
  if (typeof failed !== "number") return null;
  return {
    synced: typeof synced === "number" ? synced : 0,
    failed,
    skipped: typeof skipped === "number" ? skipped : 0,
  };
}

function fmtInt(n: number): string {
  return n.toLocaleString("en-GB");
}

/**
 * Cirqlin sums `totals` across every page on the tag, but we map one
 * tag to one event. When the tag spans pages the number is right and
 * its scope is wider than the event — say so instead of leaving it
 * silent. Fixing the join is a later problem.
 */
function scopeLineFromRaw(raw: Record<string, unknown> | null): string | null {
  if (!raw || raw.multiple !== true) return null;
  const pages = Array.isArray(raw.pages) ? raw.pages.length : 0;
  if (pages < 2) return "Counted across multiple Cirqlin pages on this tag.";
  return `Counted across ${fmtInt(pages)} Cirqlin pages on this tag.`;
}

function mailchimpSecondaryLine(subscribed: number | null): string | null {
  if (subscribed == null) return null;
  return `${fmtInt(subscribed)} subscribed in Mailchimp`;
}

function syncFailureLine(sync: CirqlinSyncBucket | null): string | null {
  if (!sync || sync.failed <= 0) return null;
  const noun = sync.failed === 1 ? "signup" : "signups";
  return `${fmtInt(sync.failed)} ${noun} did not reach Mailchimp (invalid email)`;
}

export function cirqlinPrimaryCaption(
  snapshotAt: string,
  now: Date,
): string {
  const captured = new Date(snapshotAt).getTime();
  if (!Number.isFinite(captured)) return "signups · Cirqlin";
  const age = now.getTime() - captured;
  if (age <= CIRQLIN_STALE_MS) return "signups · Cirqlin";
  return `signups · Cirqlin · as of ${fmtCirqlinAsOf(snapshotAt)}`;
}

function unreachableFallback(
  failure: CirqlinFetchFailureReason | string | null | undefined,
): string {
  if (failure === "no_page") {
    return "Cirqlin has no page for this tag — showing Mailchimp.";
  }
  return CIRQLIN_UNREACHABLE_LINE;
}

export function buildRegistrationsCardModel(
  input: BuildRegistrationsCardInput,
): RegistrationsCardModel {
  const now =
    input.now ??
    (input.nowMs != null ? new Date(input.nowMs) : new Date());
  const rows = input.cirqlinSnapshots ?? [];
  const live = input.cirqlinSnapshots ? latestCirqlin(rows, true) : null;
  const newest = input.cirqlinSnapshots ? latestCirqlin(rows, false) : null;
  const noPage =
    live == null &&
    (isNoPage(newest) || input.cirqlinFailure === "no_page");
  const failureReason = snapshotReason(newest);
  const failureFromRow =
    failureReason === "unauthorized" || failureReason === "error";

  const subscribed = input.mailchimp?.totalSubscribers ?? null;
  const mailchimpLine = mailchimpSecondaryLine(subscribed);
  const askedFailed =
    (input.cirqlinFailure != null && input.cirqlinFailure !== "no_page") ||
    failureFromRow;

  if (live) {
    const window = resolveSignupWindow(rows);
    const signups =
      window.startDay != null ? window.windowSignups : live.signups_total;
    const spend = signupPhaseSpend(input.spendRows, input.generalSaleAt);
    const spendSignups = cirqlinSignupsInWindow(
      rows,
      spend.allTime ? (window.startDay ?? spend.fromDay) : spend.fromDay,
      spend.toDay,
    );
    return {
      source: "cirqlin",
      primary: signups,
      primaryCaption: cirqlinPrimaryCaption(live.snapshot_at, now),
      scopeLine: scopeLineFromRaw(live.raw_json),
      mailchimpLine,
      syncFailureLine: syncFailureLine(syncFromRaw(live.raw_json)),
      fallbackLine: null,
      windowLine: signupCardWindowLine(window, live.signups_total),
      cpr: signupPhaseCpr(
        input.spendRows,
        input.generalSaleAt,
        spend.fromDay != null ? spendSignups : signups,
      ),
    };
  }

  if (noPage) {
    const signups = subscribed;
    return {
      source: subscribed != null ? "mailchimp" : "none",
      primary: signups,
      primaryCaption: signups != null ? "subscribed · Mailchimp" : null,
      scopeLine: null,
      mailchimpLine: null,
      syncFailureLine: null,
      fallbackLine: "Cirqlin has no page for this tag — showing Mailchimp.",
      windowLine: null,
      cpr:
        signups != null
          ? signupPhaseCpr(input.spendRows, input.generalSaleAt, signups)
          : null,
    };
  }

  if (askedFailed) {
    const signups = subscribed;
    return {
      source: signups != null ? "mailchimp" : "none",
      primary: signups,
      primaryCaption: signups != null ? "subscribed · Mailchimp" : null,
      scopeLine: null,
      mailchimpLine: null,
      syncFailureLine: null,
      fallbackLine: unreachableFallback(
        input.cirqlinFailure ??
          (failureFromRow ? (failureReason as CirqlinFetchFailureReason) : null),
      ),
      windowLine: null,
      cpr:
        signups != null
          ? signupPhaseCpr(input.spendRows, input.generalSaleAt, signups)
          : null,
    };
  }

  const signups = subscribed;
  return {
    source: signups != null ? "mailchimp" : "none",
    primary: signups,
    primaryCaption: signups != null ? "subscribed · Mailchimp" : null,
    scopeLine: null,
    mailchimpLine: null,
    syncFailureLine: null,
    fallbackLine: null,
    windowLine: null,
    cpr:
      signups != null
        ? signupPhaseCpr(input.spendRows, input.generalSaleAt, signups)
        : null,
  };
}

/** One event's worth of inputs the venue / share surfaces already have. */
export interface PortalRegistrationsEvent {
  id: string;
  mailchimp_registrations: number | null;
  mailchimp_tag: string | null;
  general_sale_at: string | null;
  cirqlin_snapshots?: readonly CirqlinSnapshotRow[] | null;
}

function mailchimpFromCount(
  count: number | null,
  hasTag: boolean,
): MailchimpRegistrationsData {
  return {
    newSinceBaseline: count,
    totalSubscribers: count,
    baselineSubscribers: 0,
    lastSyncedAt: null,
    hasAudience: hasTag || count != null,
    mailchimpAccountConnected: true,
  };
}

/**
 * Venue / multi-event: prefer the single tagged event (D.O.D), else
 * the first event that has Cirqlin snapshots. Multi-event Cirqlin
 * sums are a later problem — this card is per campaign. When Cirqlin
 * says the tag spans pages, `scopeLine` names it rather than leaving
 * the wider scope unsaid.
 */
export function buildRegistrationsCardModelForEvents(
  events: readonly PortalRegistrationsEvent[],
  spendRows: ReadonlyArray<SignupPhaseSpendRow & { event_id?: string }>,
  now?: Date,
): RegistrationsCardModel {
  const tagged = events.filter((e) => e.mailchimp_tag);
  const withCirqlin = events.filter((e) => (e.cirqlin_snapshots?.length ?? 0) > 0);
  const chosen =
    tagged.length === 1
      ? tagged[0]
      : withCirqlin.length === 1
        ? withCirqlin[0]
        : tagged[0] ?? events[0] ?? null;
  if (!chosen) {
    return buildRegistrationsCardModel({
      mailchimp: null,
      cirqlinSnapshots: null,
      spendRows: [],
      generalSaleAt: null,
      now,
    });
  }
  const rows = spendRows.filter(
    (row) => row.event_id == null || row.event_id === chosen.id,
  );
  return buildRegistrationsCardModel({
    mailchimp: mailchimpFromCount(
      chosen.mailchimp_registrations,
      chosen.mailchimp_tag != null,
    ),
    cirqlinSnapshots: chosen.cirqlin_snapshots ?? null,
    spendRows: rows,
    generalSaleAt: chosen.general_sale_at,
    now,
  });
}
