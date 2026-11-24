/**
 * Fixtures cut from prod ad_daily_insights, read 23 Nov 2026 (days 17–22 Nov).
 * Test ad sets: [campaign, ad set, ad, ad name, date, spend, LPV, omni IC, promoted event].
 * Show days: per campaign per day, [code, campaign, date, spend, omni IC].
 */

import type { ObservedAdDay } from "../observed-tests.ts";

type TestRow = [string, string, string, string, string, number, number, number, string];

const TEST_ROWS: TestRow[] = [
  ["EBR26-KREAM · AB copy test", "120250552866970716", "120250552877890716", "[AB-A] Static", "2026-11-17", 0.05, 0, 0, "INITIATED_CHECKOUT"],
  ["EBR26-KREAM · AB copy test", "120250552866970716", "120250552877890716", "[AB-A] Static", "2026-11-20", 0.45, 0, 0, "INITIATED_CHECKOUT"],
  ["EBR26-KREAM · AB copy test", "120250552866970716", "120250552877890716", "[AB-A] Static", "2026-11-21", 0.34, 0, 0, "INITIATED_CHECKOUT"],
  ["EBR26-KREAM · AB copy test", "120250552866970716", "120250552884850716", "[AB-B] Static", "2026-11-17", 0.6, 1, 1, "INITIATED_CHECKOUT"],
  ["EBR26-KREAM · AB copy test", "120250552866970716", "120250552884850716", "[AB-B] Static", "2026-11-18", 2.03, 2, 0, "INITIATED_CHECKOUT"],
  ["EBR26-KREAM · AB copy test", "120250552866970716", "120250552884850716", "[AB-B] Static", "2026-11-19", 2.06, 5, 1, "INITIATED_CHECKOUT"],
  ["EBR26-KREAM · AB copy test", "120250552866970716", "120250552884850716", "[AB-B] Static", "2026-11-20", 1.67, 1, 0, "INITIATED_CHECKOUT"],
  ["EBR26-KREAM · AB copy test", "120250552866970716", "120250552884850716", "[AB-B] Static", "2026-11-21", 1.74, 1, 0, "INITIATED_CHECKOUT"],
  ["EBR26-KREAM · Artist cards test", "120250552886780716", "120250553057260716", "[CARD-HEADLINER]", "2026-11-19", 0.16, 1, 0, "INITIATED_CHECKOUT"],
  ["EBR26-KREAM · Artist cards test", "120250552886780716", "120250553057260716", "[CARD-HEADLINER]", "2026-11-20", 0.44, 0, 0, "INITIATED_CHECKOUT"],
  ["EBR26-KREAM · Artist cards test", "120250552886780716", "120250553057260716", "[CARD-HEADLINER]", "2026-11-21", 0.27, 1, 0, "INITIATED_CHECKOUT"],
  ["EBR26-KREAM · Artist cards test", "120250552886780716", "120250553067990716", "[CARD-SUPPORT-Estiva]", "2026-11-19", 0.35, 0, 0, "INITIATED_CHECKOUT"],
  ["EBR26-KREAM · Artist cards test", "120250552886780716", "120250553067990716", "[CARD-SUPPORT-Estiva]", "2026-11-20", 0.17, 0, 0, "INITIATED_CHECKOUT"],
  ["EBR26-KREAM · Artist cards test", "120250552886780716", "120250553067990716", "[CARD-SUPPORT-Estiva]", "2026-11-21", 0.06, 0, 0, "INITIATED_CHECKOUT"],
  ["EBR26-KREAM · Artist cards test", "120250552886780716", "120250553073120716", "[CARD-SUPPORT-LeenaPunks]", "2026-11-19", 0.65, 1, 0, "INITIATED_CHECKOUT"],
  ["EBR26-KREAM · Artist cards test", "120250552886780716", "120250553073120716", "[CARD-SUPPORT-LeenaPunks]", "2026-11-20", 1.26, 2, 0, "INITIATED_CHECKOUT"],
  ["EBR26-KREAM · Artist cards test", "120250552886780716", "120250553073120716", "[CARD-SUPPORT-LeenaPunks]", "2026-11-21", 3.59, 7, 0, "INITIATED_CHECKOUT"],
  ["EBR26-KREAM · Artist cards test", "120250552886780716", "120250553078180716", "[CARD-SUPPORT-Parts]", "2026-11-19", 1.44, 3, 0, "INITIATED_CHECKOUT"],
  ["EBR26-KREAM · Artist cards test", "120250552886780716", "120250553078180716", "[CARD-SUPPORT-Parts]", "2026-11-20", 2.29, 3, 0, "INITIATED_CHECKOUT"],
  ["EBR26-KREAM · Artist cards test", "120250552886780716", "120250553078180716", "[CARD-SUPPORT-Parts]", "2026-11-21", 0.98, 4, 0, "INITIATED_CHECKOUT"],
  ["NX26-ROBBIEDOHERTY · AB copy test", "120252640404890755", "120252640406780755", "[AB-A] Artwork Static – Lineup", "2026-11-17", 1.5, 0, 0, "INITIATED_CHECKOUT"],
  ["NX26-ROBBIEDOHERTY · AB copy test", "120252640404890755", "120252640406780755", "[AB-A] Artwork Static – Lineup", "2026-11-18", 2.7, 5, 2, "INITIATED_CHECKOUT"],
  ["NX26-ROBBIEDOHERTY · AB copy test", "120252640404890755", "120252640406780755", "[AB-A] Artwork Static – Lineup", "2026-11-19", 2.76, 4, 1, "INITIATED_CHECKOUT"],
  ["NX26-ROBBIEDOHERTY · AB copy test", "120252640404890755", "120252640406780755", "[AB-A] Artwork Static – Lineup", "2026-11-20", 2.55, 1, 0, "INITIATED_CHECKOUT"],
  ["NX26-ROBBIEDOHERTY · AB copy test", "120252640404890755", "120252640406780755", "[AB-A] Artwork Static – Lineup", "2026-11-21", 2.97, 1, 0, "INITIATED_CHECKOUT"],
  ["NX26-ROBBIEDOHERTY · AB copy test", "120252640404890755", "120252640408200755", "[AB-B] Artwork Static – Lineup", "2026-11-17", 0.06, 0, 0, "INITIATED_CHECKOUT"],
  ["NX26-ROBBIEDOHERTY · AB copy test", "120252640404890755", "120252640408200755", "[AB-B] Artwork Static – Lineup", "2026-11-20", 0.48, 0, 0, "INITIATED_CHECKOUT"],
  ["NX26-ROBBIEDOHERTY · AB copy test", "120252640404890755", "120252640408200755", "[AB-B] Artwork Static – Lineup", "2026-11-21", 0.41, 0, 0, "INITIATED_CHECKOUT"],
  ["NX27-JULIANFIJMA · AB copy test", "120252640412680755", "120252640416540755", "[AB-A] Venue - UGC 1", "2026-11-17", 0.24, 1, 0, "ADD_TO_CART"],
  ["NX27-JULIANFIJMA · AB copy test", "120252640412680755", "120252640416540755", "[AB-A] Venue - UGC 1", "2026-11-21", 2.32, 2, 0, "ADD_TO_CART"],
  ["NX27-JULIANFIJMA · AB copy test", "120252640412680755", "120252640419580755", "[AB-B] Venue - UGC 1", "2026-11-17", 0.07, 0, 0, "ADD_TO_CART"],
  ["NX27-JULIANFIJMA · AB copy test", "120252640412680755", "120252640419580755", "[AB-B] Venue - UGC 1", "2026-11-21", 0.66, 0, 0, "ADD_TO_CART"],
  ["P26-BDAY · AB copy test", "120248937493960539", "120248937499220539", "[AB-B] Puzzle - Static CTA", "2026-11-17", 0.59, 0, 0, "INITIATED_CHECKOUT"],
  ["P26-BDAY · AB copy test", "120248937493960539", "120248937499220539", "[AB-B] Puzzle - Static CTA", "2026-11-18", 1.02, 0, 0, "INITIATED_CHECKOUT"],
  ["P26-BDAY · AB copy test", "120248937493960539", "120248937499220539", "[AB-B] Puzzle - Static CTA", "2026-11-19", 1.09, 4, 0, "INITIATED_CHECKOUT"],
  ["P26-BDAY · AB copy test", "120248937493960539", "120248937499220539", "[AB-B] Puzzle - Static CTA", "2026-11-20", 0.78, 1, 0, "INITIATED_CHECKOUT"],
  ["P26-BDAY · AB copy test", "120248937493960539", "120248937499220539", "[AB-B] Puzzle - Static CTA", "2026-11-21", 0.94, 3, 0, "INITIATED_CHECKOUT"],
  ["P26-BDAY · Tests", "120248963912920539", "120248964114400539", "Puzzle - Luke Dean Top Tracks Forever", "2026-11-19", 3.64, 14, 0, "INITIATED_CHECKOUT"],
  ["P26-BDAY · Tests", "120248963912920539", "120248964114400539", "Puzzle - Luke Dean Top Tracks Forever", "2026-11-20", 1.83, 4, 0, "INITIATED_CHECKOUT"],
  ["P26-BDAY · Tests", "120248963912920539", "120248964114400539", "Puzzle - Luke Dean Top Tracks Forever", "2026-11-21", 6.18, 15, 1, "INITIATED_CHECKOUT"],
  ["P26-BDAY · Tests", "120248963912920539", "120248964114400539", "Puzzle - Luke Dean Top Tracks Forever", "2026-11-22", 4.37, 7, 1, "INITIATED_CHECKOUT"],
  ["P26-BDAY · Tests", "120248963912920539", "120248964114540539", "Puzzle - Luke Dean Top Tracks Cant Live", "2026-11-19", 1.13, 0, 0, "INITIATED_CHECKOUT"],
  ["P26-BDAY · Tests", "120248963912920539", "120248964114540539", "Puzzle - Luke Dean Top Tracks Cant Live", "2026-11-20", 0.28, 0, 0, "INITIATED_CHECKOUT"],
  ["P26-BDAY · Tests", "120248963912920539", "120248964114540539", "Puzzle - Luke Dean Top Tracks Cant Live", "2026-11-21", 0.93, 2, 0, "INITIATED_CHECKOUT"],
  ["P26-BDAY · Tests", "120248963912920539", "120248964114540539", "Puzzle - Luke Dean Top Tracks Cant Live", "2026-11-22", 0.75, 1, 0, "INITIATED_CHECKOUT"],
  ["P26-BDAY · Tests", "120248963912920539", "120248964114640539", "Puzzle - Luke Dean Top Tracks Level", "2026-11-19", 0.74, 3, 0, "INITIATED_CHECKOUT"],
  ["P26-BDAY · Tests", "120248963912920539", "120248964114640539", "Puzzle - Luke Dean Top Tracks Level", "2026-11-20", 1.36, 1, 0, "INITIATED_CHECKOUT"],
  ["P26-BDAY · Tests", "120248963912920539", "120248964114640539", "Puzzle - Luke Dean Top Tracks Level", "2026-11-21", 4.85, 7, 0, "INITIATED_CHECKOUT"],
  ["P26-BDAY · Tests", "120248963912920539", "120248964114640539", "Puzzle - Luke Dean Top Tracks Level", "2026-11-22", 6.71, 19, 0, "INITIATED_CHECKOUT"],
  ["P26-BDAY · Tests", "120248963912920539", "120248964114780539", "Puzzle - Luke Dean Top Tracks Ranked", "2026-11-19", 11.73, 36, 1, "INITIATED_CHECKOUT"],
  ["P26-BDAY · Tests", "120248963912920539", "120248964114780539", "Puzzle - Luke Dean Top Tracks Ranked", "2026-11-20", 5.72, 19, 0, "INITIATED_CHECKOUT"],
  ["P26-BDAY · Tests", "120248963912920539", "120248964114780539", "Puzzle - Luke Dean Top Tracks Ranked", "2026-11-21", 6.52, 19, 1, "INITIATED_CHECKOUT"],
  ["P26-BDAY · Tests", "120248963912920539", "120248964114780539", "Puzzle - Luke Dean Top Tracks Ranked", "2026-11-22", 3.04, 12, 0, "INITIATED_CHECKOUT"],
];

const ADSET_NAME: Record<string, string> = { "120248963912920539": "Top tracks reels · Luke Dean" };
const CAMPAIGN_ID: Record<string, string> = {
  "EBR26-KREAM · AB copy test": "120250552866110716",
  "EBR26-KREAM · Artist cards test": "120250552886550716",
  "NX26-ROBBIEDOHERTY · AB copy test": "120252640404020755",
  "NX27-JULIANFIJMA · AB copy test": "120252640410280755",
  "P26-BDAY · AB copy test": "120248937493860539",
  "P26-BDAY · Tests": "120248963911740539",
};

export const TEST_DAYS: ObservedAdDay[] = TEST_ROWS.map(([campaign, adset, ad, name, date, spend, lpv, ic, event]) => ({
  date,
  meta_ad_id: ad,
  meta_adset_id: adset,
  meta_campaign_id: CAMPAIGN_ID[campaign]!,
  campaign_name: campaign,
  adset_name: ADSET_NAME[adset] ?? campaign,
  ad_name: name,
  ad_account_id: campaign.startsWith("P26") ? "act_1058599195559790" : campaign.startsWith("EBR") ? "act_2011069725849568" : "act_606252931141334",
  spend,
  landing_page_views: lpv,
  registrations: 0,
  actions: ic ? [{ action_type: "omni_initiated_checkout", value: String(ic) }] : [],
  promoted_event: event,
  optimization_goal: "OFFSITE_CONVERSIONS",
  campaign_objective: "OUTCOME_SALES",
}));

type ShowRow = [string, string, string, number, number];

/** The main campaigns' days. showDaysOf adds the test campaigns' own days, which TF5's benchmark must drop. */
const SHOW_ROWS: ShowRow[] = [
  ["EBR26-KREAM", "261204 Kream | [EBR26-KREAM] KREAM - On Sale", "2026-11-17", 15.92, 15],
  ["EBR26-KREAM", "261204 Kream | [EBR26-KREAM] KREAM - On Sale", "2026-11-18", 27.22, 20],
  ["EBR26-KREAM", "261204 Kream | [EBR26-KREAM] KREAM - On Sale", "2026-11-19", 25.62, 21],
  ["EBR26-KREAM", "261204 Kream | [EBR26-KREAM] KREAM - On Sale", "2026-11-20", 24.26, 15],
  ["EBR26-KREAM", "261204 Kream | [EBR26-KREAM] KREAM - On Sale", "2026-11-21", 23.53, 13],
  ["EBR26-KREAM", "261204 Kream | [EBR26-KREAM] KREAM - On Sale", "2026-11-22", 22.72, 13],
  ["NX26-ROBBIEDOHERTY", "261127 Robbie Doherty | [NX26-ROBBIEDOHERTY] ON SALE", "2026-11-17", 32.72, 4],
  ["NX26-ROBBIEDOHERTY", "261127 Robbie Doherty | [NX26-ROBBIEDOHERTY] ON SALE", "2026-11-18", 24.83, 6],
  ["NX26-ROBBIEDOHERTY", "261127 Robbie Doherty | [NX26-ROBBIEDOHERTY] ON SALE", "2026-11-19", 30.22, 1],
  ["NX26-ROBBIEDOHERTY", "261127 Robbie Doherty | [NX26-ROBBIEDOHERTY] ON SALE", "2026-11-20", 31.73, 10],
  ["NX26-ROBBIEDOHERTY", "261127 Robbie Doherty | [NX26-ROBBIEDOHERTY] ON SALE", "2026-11-21", 35.77, 8],
  ["NX26-ROBBIEDOHERTY", "261127 Robbie Doherty | [NX26-ROBBIEDOHERTY] ON SALE", "2026-11-22", 35.85, 7],
  ["P26-BDAY", "[P26-BDAY] Puzzle - 27 Dec - On Sale V2", "2026-11-17", 20.73, 11],
  ["P26-BDAY", "[P26-BDAY] Puzzle - 27 Dec - On Sale V2", "2026-11-18", 31.46, 11],
  ["P26-BDAY", "[P26-BDAY] Puzzle - 27 Dec - On Sale V2", "2026-11-19", 34.39, 8],
  ["P26-BDAY", "[P26-BDAY] Puzzle - 27 Dec - On Sale V2", "2026-11-20", 28.31, 11],
  ["P26-BDAY", "[P26-BDAY] Puzzle - 27 Dec - On Sale V2", "2026-11-21", 37.27, 7],
  ["P26-BDAY", "[P26-BDAY] Puzzle - 27 Dec - On Sale V2", "2026-11-22", 41.29, 9],
];

export type ShowDay = { code: string; date: string; meta_ad_id: string; campaign_name: string; spend: number; landing_page_views: number; registrations: number; actions: unknown };

export const SHOW_DAYS: ShowDay[] = SHOW_ROWS.map(([code, campaign, date, spend, ic], i) => ({
  code,
  date,
  meta_ad_id: `main-${i}`,
  campaign_name: campaign,
  spend,
  landing_page_views: 0,
  registrations: 0,
  actions: [{ action_type: "omni_initiated_checkout", value: String(ic) }],
}));

export function showDaysOf(code: string): ShowDay[] {
  return [...SHOW_DAYS.filter((d) => d.code === code), ...TEST_DAYS.filter((d) => d.campaign_name?.startsWith(code)).map((d) => ({ code, date: d.date, meta_ad_id: d.meta_ad_id, campaign_name: d.campaign_name!, spend: Number(d.spend), landing_page_views: Number(d.landing_page_views), registrations: 0, actions: d.actions }))];
}
