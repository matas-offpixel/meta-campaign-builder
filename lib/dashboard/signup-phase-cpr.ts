/**
 * lib/dashboard/signup-phase-cpr.ts
 *
 * Cost per registration = signup-phase spend ÷ signups.
 *
 * The window is the first day with any paid spend through
 * `events.general_sale_at`'s calendar day, inclusive. Spend after
 * that day is ticket spend, not signup spend. When general sale is
 * unset the window is all-time and the label says so.
 *
 * Inclusive of the general-sale day on purpose — D.O.D opened
 * presale at 12:00 and general sale at 14:00 on the same afternoon,
 * so that day's media still belongs to the signup campaign.
 */

import { paidSpendOf } from "./paid-spend.ts";
import { fmtShortDay } from "./tracker-phase.ts";

export interface SignupPhaseSpendRow {
  date: string;
  ad_spend?: number | string | null;
  ad_spend_allocated?: number | string | null;
  ad_spend_presale?: number | string | null;
  tiktok_spend?: number | string | null;
  google_ads_spend?: number | string | null;
}

export interface SignupPhaseCpr {
  spend: number;
  signups: number;
  cpr: number | null;
  /** First day in the window that carried spend. */
  fromDay: string | null;
  /** Inclusive last day of the window. Null = all-time. */
  toDay: string | null;
  allTime: boolean;
  /** `£0.91 per signup · 1,589 signups, £1,439.37 all-platform spend, 26 Aug – 9 Sept` */
  label: string;
}

function dayOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const day = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

function money(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rounded);
}

function rowSpend(row: SignupPhaseSpendRow): number {
  return paidSpendOf({
    ad_spend: row.ad_spend,
    ad_spend_allocated: row.ad_spend_allocated,
    ad_spend_presale: row.ad_spend_presale,
    tiktok_spend: row.tiktok_spend ?? null,
    google_ads_spend: row.google_ads_spend,
  });
}

/**
 * Sum paid spend from the first spend day through `generalSaleAt`'s
 * day (inclusive). A day after general sale is ignored even if it
 * spent more than the whole signup phase.
 */
export function signupPhaseSpend(
  rows: readonly SignupPhaseSpendRow[],
  generalSaleAt: string | null,
): { spend: number; fromDay: string | null; toDay: string | null; allTime: boolean } {
  const cutoff = dayOf(generalSaleAt);
  let fromDay: string | null = null;
  let spend = 0;
  for (const row of rows) {
    const day = dayOf(row.date);
    if (!day) continue;
    const amount = rowSpend(row);
    if (amount === 0) continue;
    if (cutoff && day > cutoff) continue;
    if (fromDay == null || day < fromDay) fromDay = day;
    spend += amount;
  }
  return {
    spend: Math.round(spend * 100) / 100,
    fromDay,
    toDay: cutoff,
    allTime: cutoff == null,
  };
}

export function signupPhaseCpr(
  rows: readonly SignupPhaseSpendRow[],
  generalSaleAt: string | null,
  signups: number | null,
): SignupPhaseCpr {
  const window = signupPhaseSpend(rows, generalSaleAt);
  const counted = signups != null && Number.isFinite(signups) ? signups : 0;
  const cpr =
    counted > 0 && window.spend > 0 ? window.spend / counted : null;

  const countedLabel = `${counted.toLocaleString("en-GB")} ${counted === 1 ? "signup" : "signups"}`;
  let label: string;
  if (cpr == null) {
    label = window.allTime
      ? "Cost per signup · all-time window — no spend or signups yet"
      : "Cost per signup — no spend or signups in the signup phase";
  } else if (window.allTime) {
    label = `${money(cpr)} per signup · ${countedLabel}, ${money(window.spend)} all-platform spend, all-time`;
  } else if (window.fromDay && window.toDay) {
    label = `${money(cpr)} per signup · ${countedLabel}, ${money(window.spend)} all-platform spend, ${fmtShortDay(window.fromDay)} – ${fmtShortDay(window.toDay)}`;
  } else {
    label = `${money(cpr)} per signup · ${countedLabel}, ${money(window.spend)} all-platform spend`;
  }

  return {
    spend: window.spend,
    signups: counted,
    cpr,
    fromDay: window.fromDay,
    toDay: window.toDay,
    allTime: window.allTime,
    label,
  };
}
