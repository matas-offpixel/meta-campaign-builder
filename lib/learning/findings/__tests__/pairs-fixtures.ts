/**
 * Fixtures cut from prod, read 23 Nov 2026 (ad_daily_insights 12–22 Nov, events.*).
 * Ad rows: [campaign, ad set, ad set name, ad, ad name, date, spend, registrations].
 * Every ad set here is a signup ad set (promoted event COMPLETE_REGISTRATION, objective OUTCOME_LEADS).
 */

import type { PhaseEvent } from "../phase.ts";
import type { CurveDay } from "../phase-curve.ts";
import type { PairAdDay } from "../variant-pairs.ts";

export const EVENTS: Record<string, PhaseEvent> = {
  "NX27-EWANMCVICAR": { announcement_at: "2026-11-18 17:00:00+00", presale_at: "2026-11-20 12:00:00+00", general_sale_at: "2026-11-20 14:00:00+00" },
  "EBR27-GLITTERBOX": { announcement_at: "2026-11-17 17:00:00+00", presale_at: "2026-11-19 12:00:00+00", general_sale_at: "2026-11-19 14:00:00+00" },
  "ES27-LPRHYTHM": { announcement_at: "2026-11-17 17:00:00+00", presale_at: "2026-11-20 12:00:00+00", general_sale_at: "2026-11-20 14:00:00+00" },
  "P26-BDAY": { announcement_at: null, presale_at: "2026-10-21 11:00:00+00", general_sale_at: "2026-10-30 12:00:00+00" },
  "NX26-ROBBIEDOHERTY": { announcement_at: null, presale_at: "2026-10-08 11:00:00+00", general_sale_at: null },
  "NX26-SCHAK": { announcement_at: null, presale_at: null, general_sale_at: null },
  "I26-NYC": { announcement_at: null, presale_at: null, general_sale_at: null },
};

type AdRow = [string, string, string, string, string, string, number, number];

const AD_ROWS: AdRow[] = [
  ["[EBR27-GLITTERBOX] SIGNUP", "120250477496090716", "Lifestyle", "120250477504030716", "Glitterbox  - static", "2026-11-12", 8.6, 25],
  ["[EBR27-GLITTERBOX] SIGNUP", "120250477496090716", "Lifestyle", "120250477504030716", "Glitterbox  - static", "2026-11-13", 22.78, 41],
  ["[EBR27-GLITTERBOX] SIGNUP", "120250477496090716", "Lifestyle", "120250477504030716", "Glitterbox  - static", "2026-11-14", 27.75, 32],
  ["[EBR27-GLITTERBOX] SIGNUP", "120250477496090716", "Lifestyle", "120250477504030716", "Glitterbox  - static", "2026-11-15", 21.17, 16],
  ["[EBR27-GLITTERBOX] SIGNUP", "120250477496090716", "Lifestyle", "120250477504030716", "Glitterbox  - static", "2026-11-16", 22.04, 22],
  ["[EBR27-GLITTERBOX] SIGNUP", "120250477496090716", "Lifestyle", "120250477504030716", "Glitterbox  - static", "2026-11-17", 13.68, 9],
  ["[EBR27-GLITTERBOX] SIGNUP", "120250477496090716", "Lifestyle", "120250557009960716", "Glitterbox  - static - date", "2026-11-17", 20.32, 1],
  ["[EBR27-GLITTERBOX] SIGNUP", "120250477496090716", "Lifestyle", "120250557009960716", "Glitterbox  - static - date", "2026-11-18", 12.23, 3],
  ["[EBR27-GLITTERBOX] SIGNUP", "120250477496090716", "Lifestyle", "120250557009960716", "Glitterbox  - static - date", "2026-11-19", 7.84, 1],
  ["[ES27-LPRHYTHM] Sign up", "120251798638400239", "Wide", "120251798908920239", "Artist - Static", "2026-11-12", 0.3, 0],
  ["[ES27-LPRHYTHM] Sign up", "120251798638400239", "Wide", "120251798908920239", "Artist - Static", "2026-11-13", 10.06, 15],
  ["[ES27-LPRHYTHM] Sign up", "120251798638400239", "Wide", "120251798908920239", "Artist - Static", "2026-11-14", 7.05, 5],
  ["[ES27-LPRHYTHM] Sign up", "120251798638400239", "Wide", "120251798908920239", "Artist - Static", "2026-11-15", 12.47, 9],
  ["[ES27-LPRHYTHM] Sign up", "120251798638400239", "Wide", "120251798908920239", "Artist - Static", "2026-11-16", 11.96, 6],
  ["[ES27-LPRHYTHM] Sign up", "120251798638400239", "Wide", "120251798908920239", "Artist - Static", "2026-11-17", 8.83, 6],
  ["[ES27-LPRHYTHM] Sign up", "120251798638400239", "Wide", "120251889747380239", "Artist - Static - date", "2026-11-17", 6.08, 4],
  ["[ES27-LPRHYTHM] Sign up", "120251798638400239", "Wide", "120251889747380239", "Artist - Static - date", "2026-11-18", 10.15, 0],
  ["[ES27-LPRHYTHM] Sign up", "120251798638400239", "Wide", "120251889747380239", "Artist - Static - date", "2026-11-19", 5.53, 0],
  ["[ES27-LPRHYTHM] Sign up", "120251798638400239", "Wide", "120251889747380239", "Artist - Static - date", "2026-11-20", 2.01, 1],
  ["[NX27-EWANMCVICAR] Signup", "120252632030230755", "Data", "120252632030260755", "NX Loves  - Static", "2026-11-17", 10.4, 15],
  ["[NX27-EWANMCVICAR] Signup", "120252632030230755", "Data", "120252632030260755", "NX Loves  - Static", "2026-11-18", 3.35, 7],
  ["[NX27-EWANMCVICAR] Signup", "120252632030230755", "Data", "120252662821080755", "NX Loves  - Static with date", "2026-11-18", 0.13, 0],
  ["[NX27-EWANMCVICAR] Signup", "120252632030230755", "Data", "120252662821080755", "NX Loves  - Static with date", "2026-11-19", 0.16, 0],
  ["[NX27-EWANMCVICAR] Signup", "120252630586600755", "Lifestyle", "120252630591010755", "NX Loves  - Promo vid", "2026-11-16", 4.19, 12],
  ["[NX27-EWANMCVICAR] Signup", "120252630586600755", "Lifestyle", "120252630591010755", "NX Loves  - Promo vid", "2026-11-17", 0.73, 7],
  ["[NX27-EWANMCVICAR] Signup", "120252630586600755", "Lifestyle", "120252630591010755", "NX Loves  - Promo vid", "2026-11-18", 3.39, 0],
  ["[NX27-EWANMCVICAR] Signup", "120252630586600755", "Lifestyle", "120252630589680755", "NX Loves  - Promo vid no text", "2026-11-16", 3.17, 10],
  ["[NX27-EWANMCVICAR] Signup", "120252630586600755", "Lifestyle", "120252630589680755", "NX Loves  - Promo vid no text", "2026-11-17", 0.67, 1],
  ["[NX27-EWANMCVICAR] Signup", "120252630586600755", "Lifestyle", "120252630589680755", "NX Loves  - Promo vid no text", "2026-11-18", 1.95, 0],
  ["[NX27-EWANMCVICAR] Signup", "120252630586600755", "Lifestyle", "120252630589680755", "NX Loves  - Promo vid no text", "2026-11-19", 21.87, 8],
  ["[NX27-EWANMCVICAR] Signup", "120252630586600755", "Lifestyle", "120252630589680755", "NX Loves  - Promo vid no text", "2026-11-20", 15.09, 6],
  ["[NX27-EWANMCVICAR] Signup", "120252630584870755", "Tech House Pages", "120252630591910755", "NX Loves  - Promo vid", "2026-11-16", 3.57, 9],
  ["[NX27-EWANMCVICAR] Signup", "120252630584870755", "Tech House Pages", "120252630591910755", "NX Loves  - Promo vid", "2026-11-17", 4.66, 10],
  ["[NX27-EWANMCVICAR] Signup", "120252630584870755", "Tech House Pages", "120252630591910755", "NX Loves  - Promo vid", "2026-11-18", 14.74, 17],
  ["[NX27-EWANMCVICAR] Signup", "120252630584870755", "Tech House Pages", "120252630589570755", "NX Loves  - Promo vid no text", "2026-11-16", 5.71, 14],
  ["[NX27-EWANMCVICAR] Signup", "120252630584870755", "Tech House Pages", "120252630589570755", "NX Loves  - Promo vid no text", "2026-11-17", 4.23, 5],
  ["[NX27-EWANMCVICAR] Signup", "120252630584870755", "Tech House Pages", "120252630589570755", "NX Loves  - Promo vid no text", "2026-11-18", 8.64, 6],
  ["[NX27-EWANMCVICAR] Signup", "120252630584870755", "Tech House Pages", "120252630589570755", "NX Loves  - Promo vid no text", "2026-11-19", 2.11, 1],
  ["[NX27-EWANMCVICAR] Signup", "120252630584870755", "Tech House Pages", "120252630589570755", "NX Loves  - Promo vid no text", "2026-11-20", 0.5, 0],
];

export const AD_DAYS: PairAdDay[] = AD_ROWS.map(([campaign, adset, adsetName, ad, name, date, spend, regs]) => ({
  date,
  meta_ad_id: ad,
  meta_adset_id: adset,
  meta_campaign_id: `c-${campaign}`,
  campaign_name: campaign,
  adset_name: adsetName,
  ad_name: name,
  ad_account_id: "act_606252931141334",
  spend,
  landing_page_views: 0,
  registrations: regs,
  purchases: 0,
  actions: [],
  promoted_event: "COMPLETE_REGISTRATION",
  optimization_goal: "OFFSITE_CONVERSIONS",
  campaign_objective: "OUTCOME_LEADS",
}));

/** EBR27-GLITTERBOX by campaign and day: [campaign, date, spend, registrations, initiate checkouts]. */
const GLITTERBOX_ROWS: [string, string, number, number, number][] = [
  ["[EBR27-GLITTERBOX] SIGNUP", "2026-11-12", 73.37, 284, 0],
  ["[EBR27-GLITTERBOX] SIGNUP", "2026-11-13", 167.11, 369, 0],
  ["[EBR27-GLITTERBOX] SIGNUP", "2026-11-14", 199.77, 239, 0],
  ["[EBR27-GLITTERBOX] SIGNUP", "2026-11-15", 168.82, 157, 0],
  ["[EBR27-GLITTERBOX] SIGNUP", "2026-11-16", 201.22, 146, 0],
  ["[EBR27-GLITTERBOX] SIGNUP", "2026-11-17", 178.93, 98, 0],
  ["[EBR27-GLITTERBOX] SIGNUP", "2026-11-18", 151.51, 58, 0],
  ["[EBR27-GLITTERBOX] SIGNUP", "2026-11-19", 184.94, 389, 0],
  ["[EBR27-GLITTERBOX] SIGNUP", "2026-11-20", 206.96, 386, 0],
  ["[EBR27-GLITTERBOX] SIGNUP", "2026-11-21", 234.3, 234, 0],
  ["[EBR27-GLITTERBOX] SIGNUP", "2026-11-22", 223.77, 176, 0],
  ["[EBR27-GLITTERBOX] ON SALE", "2026-11-19", 5.33, 0, 11],
  ["[EBR27-GLITTERBOX] ON SALE", "2026-11-20", 11.81, 0, 16],
  ["[EBR27-GLITTERBOX] ON SALE", "2026-11-21", 14.74, 0, 10],
  ["[EBR27-GLITTERBOX] ON SALE", "2026-11-22", 12.4, 0, 8],
  ["[EBR27-GLITTERBOX] ON SALE - RETARGETING", "2026-11-19", 0.59, 0, 0],
  ["[EBR27-GLITTERBOX] ON SALE - RETARGETING", "2026-11-20", 0.03, 0, 0],
  ["[EBR27-GLITTERBOX] ON SALE - RETARGETING", "2026-11-21", 0.03, 0, 0],
];

export const GLITTERBOX_DAYS: CurveDay[] = GLITTERBOX_ROWS.map(([campaign, date, spend, regs, ic], i) => ({
  date,
  meta_ad_id: `g-${i}`,
  campaign_name: campaign,
  spend,
  landing_page_views: 0,
  registrations: regs,
  purchases: 0,
  actions: ic ? [{ action_type: "omni_initiated_checkout", value: String(ic) }] : [],
  promoted_event: campaign.includes("SIGNUP") ? "COMPLETE_REGISTRATION" : "INITIATED_CHECKOUT",
  optimization_goal: "OFFSITE_CONVERSIONS",
  campaign_objective: campaign.includes("SIGNUP") ? "OUTCOME_LEADS" : "OUTCOME_SALES",
}));
