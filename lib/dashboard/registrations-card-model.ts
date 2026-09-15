/**
 * lib/dashboard/registrations-card-model.ts
 *
 * What the REGISTRATIONS card says, as a pure value.
 *
 * Cirqlin counted signups are the primary number when we have a page
 * for the tag. Mailchimp is the secondary line — subscribed
 * (segment member_count) and, when we have it as a distinct figure,
 * tagged-any-status. The steps between Cirqlin's synced count and
 * Mailchimp's two numbers are Mailchimp-side and unknown until a
 * member-status breakdown is captured; the card names the sources
 * and does not invent a reason.
 *
 * `computeRegistrationsData` is untouched. Cirqlin sits beside it.
 */

import type { CirqlinSnapshotRow, CirqlinSyncBucket } from "../cirqlin/types.ts";
import type { MailchimpRegistrationsData } from "../mailchimp/compute-registrations.ts";
import {
  signupPhaseCpr,
  type SignupPhaseCpr,
  type SignupPhaseSpendRow,
} from "./signup-phase-cpr.ts";

export type RegistrationsPrimarySource = "cirqlin" | "mailchimp" | "none";

export interface RegistrationsCardModel {
  source: RegistrationsPrimarySource;
  /** Large number on the card. Null → em-dash. */
  primary: number | null;
  primaryCaption: string | null;
  /** `1,686 subscribed in Mailchimp · 1,723 tagged` */
  mailchimpLine: string | null;
  /** `4 signups did not reach Mailchimp (invalid email)` */
  syncFailureLine: string | null;
  /** Shown when Cirqlin was asked and has no page for the tag. */
  fallbackLine: string | null;
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
   * Mailchimp tagged-any-status count, when a source actually
   * captured it. We do not invent this from member_count.
   */
  mailchimpTagged?: number | null;
}

function latestCirqlin(
  rows: readonly CirqlinSnapshotRow[],
): CirqlinSnapshotRow | null {
  if (rows.length === 0) return null;
  return [...rows].sort((a, b) => a.day.localeCompare(b.day)).at(-1) ?? null;
}

function isNoPage(row: CirqlinSnapshotRow | null): boolean {
  return row?.raw_json?.reason === "no_page";
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

function mailchimpSecondaryLine(
  subscribed: number | null,
  tagged: number | null,
): string | null {
  if (subscribed == null) return null;
  if (tagged != null && tagged !== subscribed) {
    return `${fmtInt(subscribed)} subscribed in Mailchimp · ${fmtInt(tagged)} tagged`;
  }
  return `${fmtInt(subscribed)} subscribed in Mailchimp`;
}

function syncFailureLine(sync: CirqlinSyncBucket | null): string | null {
  if (!sync || sync.failed <= 0) return null;
  const noun = sync.failed === 1 ? "signup" : "signups";
  return `${fmtInt(sync.failed)} ${noun} did not reach Mailchimp (invalid email)`;
}

export function buildRegistrationsCardModel(
  input: BuildRegistrationsCardInput,
): RegistrationsCardModel {
  const latest = input.cirqlinSnapshots
    ? latestCirqlin(input.cirqlinSnapshots)
    : null;
  const noPage = isNoPage(latest);
  const cirqlinLive = latest != null && !noPage ? latest : null;

  const subscribed = input.mailchimp?.totalSubscribers ?? null;
  const tagged = input.mailchimpTagged ?? null;
  const mailchimpLine = mailchimpSecondaryLine(subscribed, tagged);

  if (cirqlinLive) {
    const signups = cirqlinLive.signups_total;
    return {
      source: "cirqlin",
      primary: signups,
      primaryCaption: "signups · Cirqlin",
      mailchimpLine,
      syncFailureLine: syncFailureLine(syncFromRaw(cirqlinLive.raw_json)),
      fallbackLine: null,
      cpr: signupPhaseCpr(input.spendRows, input.generalSaleAt, signups),
    };
  }

  if (noPage) {
    const signups = subscribed;
    return {
      source: subscribed != null ? "mailchimp" : "none",
      primary: signups,
      primaryCaption: signups != null ? "subscribed · Mailchimp" : null,
      mailchimpLine: null,
      syncFailureLine: null,
      fallbackLine:
        "Cirqlin has no page for this tag — showing Mailchimp.",
      cpr:
        signups != null
          ? signupPhaseCpr(input.spendRows, input.generalSaleAt, signups)
          : null,
    };
  }

  // Cirqlin never asked, or never answered. Mailchimp only.
  const signups = subscribed;
  return {
    source: signups != null ? "mailchimp" : "none",
    primary: signups,
    primaryCaption: signups != null ? "subscribed · Mailchimp" : null,
    mailchimpLine: null,
    syncFailureLine: null,
    fallbackLine: null,
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
 * sums are a later problem — this card is per campaign.
 */
export function buildRegistrationsCardModelForEvents(
  events: readonly PortalRegistrationsEvent[],
  spendRows: ReadonlyArray<SignupPhaseSpendRow & { event_id?: string }>,
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
  });
}
