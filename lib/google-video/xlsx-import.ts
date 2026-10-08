/**
 * lib/google-video/xlsx-import.ts
 *
 * Parses a YouTube video build sheet (IRW0004 CamelPhat format) into a
 * plan tree. Read:
 *   - Campaign Settings (Setting | Value): budget, CPV bid, dates,
 *     networks, final/display URL, CTA, frequency cap.
 *   - Targeting & Exclusions (Type | Setting | Adjustment): locations,
 *     language, connected TV.
 *   - Placements (Tier | Campaign | Placement | Type | URL / ID | Status
 *     | Note): one campaign per distinct Campaign value, one ad group
 *     each. Paused rows import paused.
 *   - Ad Copy & Creative (Ad | Field | Text), one ad per Ad value.
 * Summary, Measurement and Checklist are not read. Every Settings and
 * Targeting row is kept as written for the Review step.
 *
 * Names are kept exactly as written: `[IRW0004]` stays as it is.
 */

import type * as XLSX from "xlsx";

import { derivePlanDailyBudget } from "../google-search/budget.ts";
import {
  cell,
  headerKey,
  isCampaignSettingsTab,
  isPlacementsTab,
  rawRows,
  readWorkbook,
  recordsFromRawRowsWithHeaderScan,
  sheetTokens,
} from "../google-search/workbook.ts";
import {
  AD_FIELD_LABELS,
  AD_LIMITS,
  CONNECTED_TV,
  type AdLimitField,
  type GoogleVideoCampaignDraftNode,
  type GoogleVideoEntityStatus,
  type GoogleVideoGeoTarget,
  type GoogleVideoImportWarning,
  type GoogleVideoPlanDraftTree,
  type GoogleVideoSheetRow,
} from "./types.ts";
import { findYouTubeRef, parseYouTubeRef, videoIdFrom } from "./youtube-url.ts";

export interface ParseVideoXlsxOptions {
  fallbackPlanName?: string;
  sourceFilename?: string | null;
}

function isTargetingTab(name: string): boolean {
  return sheetTokens(name).includes("targeting");
}

function isAdCopyTab(name: string): boolean {
  const tokens = sheetTokens(name);
  return tokens.includes("ad") && (tokens.includes("copy") || tokens.includes("creative"));
}

function findTab(workbook: XLSX.WorkBook, test: (name: string) => boolean): XLSX.WorkSheet | null {
  const name = workbook.SheetNames.find(test);
  return name ? workbook.Sheets[name] : null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** `9 Oct 2026` and `2026-10-09` dates in text order, as ISO dates. */
export function datesInText(text: string): string[] {
  const out: { at: number; iso: string }[] = [];
  for (const m of text.matchAll(/\b(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})\b/g)) {
    const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    if (month < 0) continue;
    const iso = `${m[3]}-${String(month + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    out.push({ at: m.index ?? 0, iso });
  }
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    out.push({ at: m.index ?? 0, iso: m[0] });
  }
  return out.sort((a, b) => a.at - b.at).map((d) => d.iso);
}

/** First `£8.80` / `8.80` amount in the text. */
export function poundsInText(text: string): number | null {
  const m = text.match(/£\s*(\d+(?:\.\d+)?)/) ?? text.match(/\b(\d+(?:\.\d+)?)\b/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** `2 per user per day, 8 per user per week` → { day: 2, week: 8 }. */
export function frequencyCapInText(text: string): { day: number | null; week: number | null } {
  const day = text.match(/(\d+)[^,;]*?\bper\s+(?:user\s+per\s+)?day\b/i);
  const week = text.match(/(\d+)[^,;]*?\bper\s+(?:user\s+per\s+)?week\b/i);
  return { day: day ? Number(day[1]) : null, week: week ? Number(week[1]) : null };
}

const LANGUAGE_CODES: Record<string, string> = {
  english: "en",
  french: "fr",
  german: "de",
  spanish: "es",
  italian: "it",
  dutch: "nl",
  portuguese: "pt",
};

const AD_FIELDS = new Set(["video", "finalurl", "cta", "calltoaction", "headline", "longheadline", "description"]);

function isPausedText(text: string): boolean {
  return /\bpaused?\b/i.test(text);
}

function isHeldAd(text: string): boolean {
  return /\(hold\)|\bhold\b|don['’]?t launch|do not launch|\bpaused?\b/i.test(text);
}

function percentIn(text: string): number | null {
  const m = text.match(/([+-]?\d+(?:\.\d+)?)\s*%/);
  return m ? Number(m[1]) : null;
}

function stripParenthetical(text: string): string {
  return text.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
}

export function parseGoogleVideoPlanXlsx(
  buffer: Uint8Array | ArrayBuffer,
  options: ParseVideoXlsxOptions = {},
): GoogleVideoPlanDraftTree {
  const workbook = readWorkbook(buffer);
  const tabs = [...workbook.SheetNames];
  const warnings: GoogleVideoImportWarning[] = [];

  const settingsSheet = findTab(workbook, isCampaignSettingsTab);
  const targetingSheet = findTab(workbook, isTargetingTab);
  const placementsSheet = findTab(workbook, isPlacementsTab);
  const adsSheet = findTab(workbook, isAdCopyTab);
  if (!settingsSheet) warnings.push({ code: "missing_tab", message: "No Campaign Settings tab: budget, bid and dates are blank." });
  if (!adsSheet) warnings.push({ code: "missing_tab", message: "No Ad Copy & Creative tab: the plan has no ads." });

  // ── Campaign Settings ──
  const settingsRows: GoogleVideoSheetRow[] = [];
  let dailyBudget: number | null = null;
  let totalBudget: number | null = null;
  let cpvBid: number | null = null;
  let startDate: string | null = null;
  let endDate: string | null = null;
  let includePartners = false;
  let finalUrl: string | null = null;
  let displayUrl: string | null = null;
  let callToAction: string | null = null;
  let capDay: number | null = null;
  let capWeek: number | null = null;

  for (const r of recordsFromRawRowsWithHeaderScan(rawRows(settingsSheet), ["setting", "value"])) {
    const setting = cell(r.setting);
    const value = cell(r.value);
    if (!setting) continue;
    settingsRows.push({ setting, value, note: cell(r.whynote ?? r.note ?? r.why) || undefined });
    const key = headerKey(setting);
    if (key.includes("bidstrategy") || key === "bid" || key.includes("cpv")) {
      if (/cpv/i.test(value)) cpvBid = poundsInText(value);
    } else if (key.includes("budget")) {
      const amount = poundsInText(value);
      if (/total|lifetime/i.test(value)) totalBudget = amount;
      else dailyBudget = amount;
    } else if (key.startsWith("start") || key.startsWith("end") || key === "dates") {
      const dates = datesInText(value);
      if (key === "dates" || (key.startsWith("start") && key.includes("end"))) {
        startDate = dates[0] ?? null;
        endDate = dates[1] ?? null;
      } else if (key.startsWith("start")) startDate = dates[0] ?? null;
      else endDate = dates[0] ?? null;
    } else if (key.includes("network")) {
      includePartners = /partners/i.test(value) && !/\boff\b|\bno\b|exclud/i.test(value);
    } else if (key === "finalurl") {
      finalUrl = value || null;
    } else if (key === "displayurl") {
      displayUrl = value || null;
    } else if (key === "calltoaction" || key === "cta") {
      callToAction = value || null;
    } else if (key.includes("frequency")) {
      ({ day: capDay, week: capWeek } = frequencyCapInText(value));
    }
  }

  // ── Targeting & Exclusions ──
  const targetingRows: GoogleVideoSheetRow[] = [];
  const geoTargets: GoogleVideoGeoTarget[] = [];
  const languageCodes: string[] = [];
  let deviceExclusions = [CONNECTED_TV];
  for (const r of recordsFromRawRowsWithHeaderScan(rawRows(targetingSheet), ["type", "setting"])) {
    const type = cell(r.type);
    const setting = cell(r.setting);
    const adjustment = cell(r.adjustment);
    if (!type && !setting) continue;
    targetingRows.push({ type, setting, value: adjustment, note: cell(r.why ?? r.note) || undefined });
    const typeKey = headerKey(type);
    if (typeKey === "location") {
      const negative = /exclud/i.test(adjustment);
      const name = stripParenthetical(setting);
      if (negative && /^outside\b/i.test(name)) {
        warnings.push({
          code: "location_skipped",
          message: `Location "${setting}" (${adjustment}) is not a place Google can target; targeting the other locations already keeps delivery inside them.`,
        });
        continue;
      }
      geoTargets.push({ name, bid_modifier_pct: negative ? null : percentIn(adjustment), negative });
    } else if (typeKey === "language") {
      for (const part of setting.split(/[,;/]|\band\b/)) {
        const lang = part.trim().toLowerCase();
        if (!lang) continue;
        const code = LANGUAGE_CODES[lang];
        if (code) languageCodes.push(code);
        else warnings.push({ code: "language_unknown", message: `Language "${part.trim()}" has no code here; add it in Editor.` });
      }
    } else if (typeKey === "device" && /\btv\b|connected/i.test(setting)) {
      deviceExclusions = /exclud/i.test(adjustment) ? [CONNECTED_TV] : [];
    } else if (typeKey.includes("frequency") && capDay == null && capWeek == null) {
      ({ day: capDay, week: capWeek } = frequencyCapInText(`${setting} ${adjustment}`));
    }
  }

  // ── Placements ──
  const campaigns: GoogleVideoCampaignDraftNode[] = [];
  const byCampaign = new Map<string, GoogleVideoCampaignDraftNode>();
  for (const r of recordsFromRawRowsWithHeaderScan(rawRows(placementsSheet), ["campaign", "placement"])) {
    const campaignName = cell(r.campaign);
    const label = cell(r.placement);
    if (!campaignName || !label) continue;
    const value = cell(r.urlid ?? r.url ?? r.id);
    const status: GoogleVideoEntityStatus = isPausedText(cell(r.status)) ? "paused" : "enabled";
    let campaign = byCampaign.get(campaignName);
    if (!campaign) {
      const tier = cell(r.tier) || null;
      campaign = {
        name: campaignName,
        tier,
        status: "paused",
        daily_budget: null,
        google_campaign_resource_name: null,
        sort_order: campaigns.length,
        ad_groups: [
          {
            name: tier ? `${tier} In-stream` : "In-stream",
            status: "paused",
            cpv_bid: null,
            sort_order: 0,
            placements: [],
          },
        ],
      };
      byCampaign.set(campaignName, campaign);
      campaigns.push(campaign);
    }
    const adGroup = campaign.ad_groups[0];
    const ref = parseYouTubeRef(value);
    if (!ref) {
      warnings.push({
        code: "placement_unparseable",
        message: `Placement "${label}" (${campaignName}): "${value}" is not a YouTube video or channel link.`,
      });
    }
    adGroup.placements.push({
      label,
      value,
      kind: ref?.kind ?? null,
      resolved_id: ref?.id ?? null,
      status,
      note: cell(r.note) || null,
      sort_order: adGroup.placements.length,
    });
    if (status === "enabled") {
      campaign.status = "enabled";
      adGroup.status = "enabled";
    }
  }

  // ── Ad Copy & Creative ──
  const adsByName = new Map<string, GoogleVideoPlanDraftTree["ads"][number] & { notes: string[] }>();
  for (const r of recordsFromRawRowsWithHeaderScan(rawRows(adsSheet), ["ad", "field", "text"])) {
    const name = cell(r.ad);
    const field = headerKey(r.field);
    if (!name || !AD_FIELDS.has(field)) continue;
    let ad = adsByName.get(name);
    if (!ad) {
      ad = {
        name,
        status: "enabled",
        video_value: null,
        video_id: null,
        final_url: null,
        call_to_action: null,
        headline: null,
        long_headline: null,
        description: null,
        note: null,
        sort_order: adsByName.size,
        notes: [],
      };
      adsByName.set(name, ad);
    }
    const text = cell(r.text) || null;
    const note = cell(r.note);
    if (note) ad.notes.push(note);
    if (field === "video") {
      ad.video_value = text;
      ad.video_id = videoIdFrom(text);
      if (text && !ad.video_id) {
        const inNote = findYouTubeRef(note);
        warnings.push({
          code: "ad_video_not_a_link",
          message:
            `${name}: Video "${text}" is a title, not a YouTube link. Paste the video's link on Ads.` +
            (inNote ? ` The note mentions ${inNote.url}; it was not used.` : ""),
        });
      }
    } else if (field === "finalurl") ad.final_url = text;
    else if (field === "cta" || field === "calltoaction") ad.call_to_action = text;
    else if (field === "headline") ad.headline = text;
    else if (field === "longheadline") ad.long_headline = text;
    else if (field === "description") ad.description = text;
  }

  const ads = [...adsByName.values()].map(({ notes, ...ad }) => {
    const note = notes.join(" ") || null;
    const status: GoogleVideoEntityStatus = isHeldAd(`${ad.name} ${note ?? ""}`) ? "paused" : "enabled";
    for (const field of Object.keys(AD_LIMITS) as AdLimitField[]) {
      const value = ad[field];
      if (value && value.length > AD_LIMITS[field]) {
        warnings.push({
          code: "ad_over_limit",
          message: `${ad.name}: ${AD_FIELD_LABELS[field]} "${value}" is ${value.length} characters; the limit is ${AD_LIMITS[field]}.`,
        });
      }
      if (value?.includes(";")) {
        warnings.push({
          code: "ad_semicolon",
          message: `${ad.name}: ${AD_FIELD_LABELS[field]} "${value}" contains ";". Editor reads ";" as a separator between values in one cell; replace it.`,
        });
      }
    }
    return { ...ad, note, status };
  });

  if (cpvBid == null && settingsSheet) {
    warnings.push({ code: "no_cpv_bid", message: "No CPV bid found under Bid strategy. Set one in Settings." });
  }
  const dateRange = startDate && endDate ? { since: startDate, until: endDate } : null;
  if (dailyBudget == null && derivePlanDailyBudget(totalBudget, dateRange) == null) {
    warnings.push({ code: "no_daily_budget", message: "No daily budget, and no total budget with start and end dates to derive one." });
  }

  return {
    plan: {
      event_id: null,
      google_ads_account_id: null,
      name: options.fallbackPlanName ?? campaigns[0]?.name ?? "Imported YouTube video plan",
      status: "draft",
      daily_budget: dailyBudget,
      total_budget: totalBudget,
      start_date: startDate,
      end_date: endDate,
      cpv_bid: cpvBid,
      include_video_partners: includePartners,
      device_exclusions: deviceExclusions,
      frequency_cap_per_day: capDay,
      frequency_cap_per_week: capWeek,
      language_codes: languageCodes,
      geo_targets: geoTargets,
      final_url: finalUrl,
      display_url: displayUrl,
      call_to_action: callToAction,
      settings_rows: settingsRows,
      targeting_rows: targetingRows,
      source_filename: options.sourceFilename ?? null,
    },
    campaigns,
    ads,
    warnings,
    tabs,
  };
}

export function countDraftPlacements(draft: Pick<GoogleVideoPlanDraftTree, "campaigns">): number {
  return draft.campaigns.reduce(
    (n, c) => n + c.ad_groups.reduce((m, ag) => m + ag.placements.length, 0),
    0,
  );
}

export function describeEmptyGoogleVideoImport(tabs: string[]): string {
  const found = tabs.length > 0 ? tabs.join(", ") : "none";
  return `Parsed 0 placements. Tabs found: ${found}. A video plan needs a Placements tab with Campaign and Placement columns.`;
}
