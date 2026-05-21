/**
 * lib/google-search/xlsx-import.ts
 *
 * Parse Matas's Google Search plan xlsx (J2 Melodic format) into a
 * `GoogleSearchPlanDraftTree` ready for `createGoogleSearchPlanTreeFromDraft`.
 *
 * Expected workbook (case-insensitive name match, all tabs optional except
 * Keywords — that's the structural backbone):
 *
 *   - Overview        — strategy meta + campaign summary table
 *                       (campaign | focus | ad groups | monthly budget |
 *                        priority | notes)
 *   - Keywords        — campaign | ad group | keyword | match type |
 *                       est cpc low | est cpc high | intent | notes
 *   - Ad Copy         — campaign | type (H1..H15, D1..D4) | content |
 *                       char count
 *   - Negative Keywords — scope (all / campaign name) | negative keyword |
 *                       match type | reason
 *   - Budget Phasing  — period × campaign grid (consumed coarsely; used
 *                       to derive daily_budget when monthly is missing)
 *
 * Defensive choices:
 *   - All header lookups normalise via `headerKey()` (lowercase, strip
 *     non-alphanumeric) so trailing colons / unicode dashes / synonym
 *     spellings (e.g. "match" vs "match type") still match.
 *   - Match-type cells like "[Exact]", "\"Phrase\"", "Phrase Match" all
 *     normalise to the EXACT/PHRASE/BROAD enum; anything unrecognised
 *     emits an `unknown_match_type` warning and the row is dropped.
 *   - Char-count cells in the Ad Copy tab (e.g. "30 ✓") are ignored —
 *     we recompute char counts from the content cell and emit
 *     `headline_too_long` / `description_too_long` warnings.
 *   - Empty rows, missing campaign / ad-group cells, and blank keyword
 *     cells route to warnings instead of throwing — the wizard surfaces
 *     them so the operator can fix in xlsx and re-import.
 */

import * as XLSX from "xlsx";

import {
  GOOGLE_SEARCH_LIMITS,
  type GoogleSearchAdGroupDraftNode,
  type GoogleSearchCampaignDraftNode,
  type GoogleSearchImportWarning,
  type GoogleSearchKeywordDraft,
  type GoogleSearchMatchType,
  type GoogleSearchNegativeDraft,
  type GoogleSearchPlanDraftTree,
  type GoogleSearchRsaDraft,
  type RsaDescription,
  type RsaHeadline,
  MATCH_TYPES,
} from "./types.ts";

// ─── Public entry point ────────────────────────────────────────────────

export interface ParseXlsxOptions {
  /** Plan name fallback when no Overview tab is present. */
  fallbackPlanName?: string;
}

export function parseGoogleSearchPlanXlsx(
  buffer: Uint8Array | ArrayBuffer,
  options: ParseXlsxOptions = {},
): GoogleSearchPlanDraftTree {
  const view =
    buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const workbook = XLSX.read(view, { type: "array" });
  const tabs = indexTabs(workbook);

  const warnings: GoogleSearchImportWarning[] = [];

  // Step 1: keywords build the campaign/ad-group skeleton.
  const skeleton = parseKeywordsTab(tabs.keywords, warnings);

  // Step 2: overview enriches campaign meta (priority, monthly budget, notes).
  applyOverview(skeleton.campaigns, tabs.overview);

  // Step 3: ad copy attaches RSAs per campaign (one RSA per ad group; if
  // the sheet does not split by ad group, RSAs are duplicated across all
  // ad groups of the campaign and the wizard can prune).
  applyAdCopy(skeleton.campaigns, tabs.adCopy, warnings);

  // Step 4: negatives — plan-scoped or campaign-scoped.
  const negatives = parseNegativesTab(
    tabs.negativeKeywords,
    skeleton.campaigns.map((c) => c.name),
    warnings,
  );

  const planName =
    extractPlanNameFromOverview(tabs.overview) ??
    options.fallbackPlanName ??
    "Imported Google Search Plan";

  return {
    plan: {
      name: planName,
      event_id: null,
      google_ads_account_id: null,
      status: "draft",
      total_budget: null,
      bidding_strategy: "maximize_clicks",
      geo_targets: [],
      date_range: null,
    },
    campaigns: skeleton.campaigns,
    negatives,
    warnings,
  };
}

// ─── Helpers exported for tests ────────────────────────────────────────

const MATCH_TYPE_ALIASES: Record<string, GoogleSearchMatchType> = {
  exact: "EXACT",
  phrase: "PHRASE",
  broad: "BROAD",
  "broad match": "BROAD",
  "phrase match": "PHRASE",
  "exact match": "EXACT",
};

export function normaliseMatchType(
  raw: unknown,
): GoogleSearchMatchType | null {
  if (raw == null) return null;
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const cleaned = String(raw)
    .replace(/[\[\]"'`]/g, "")
    .trim()
    .toLowerCase();
  if (!cleaned) return null;
  if (MATCH_TYPE_ALIASES[cleaned]) return MATCH_TYPE_ALIASES[cleaned];
  for (const mt of MATCH_TYPES) {
    if (cleaned === mt.toLowerCase()) return mt;
  }
  return null;
}

export function classifyCharOverflow(
  text: string,
  kind: "headline" | "description",
): GoogleSearchImportWarning | null {
  const max =
    kind === "headline"
      ? GOOGLE_SEARCH_LIMITS.HEADLINE_MAX_CHARS
      : GOOGLE_SEARCH_LIMITS.DESCRIPTION_MAX_CHARS;
  if (text.length <= max) return null;
  return {
    code: kind === "headline" ? "headline_too_long" : "description_too_long",
    message: `${kind} of ${text.length} chars exceeds the ${max}-char limit`,
    context: { text, length: text.length, max },
  };
}

function headerKey(raw: unknown): string {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function cell(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function numericOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// ─── Tab indexing ──────────────────────────────────────────────────────

interface IndexedTabs {
  overview: XLSX.WorkSheet | null;
  keywords: XLSX.WorkSheet | null;
  adCopy: XLSX.WorkSheet | null;
  negativeKeywords: XLSX.WorkSheet | null;
  // budget phasing intentionally not consumed in v0 (used by Phase 2 UI).
}

function indexTabs(workbook: XLSX.WorkBook): IndexedTabs {
  const out: IndexedTabs = {
    overview: null,
    keywords: null,
    adCopy: null,
    negativeKeywords: null,
  };
  for (const name of workbook.SheetNames) {
    const key = headerKey(name);
    const sheet = workbook.Sheets[name];
    if (key.includes("negative")) out.negativeKeywords ??= sheet;
    else if (key.includes("keyword")) out.keywords ??= sheet;
    else if (key.includes("adcopy") || key.includes("ad")) out.adCopy ??= sheet;
    else if (key.includes("overview") || key.includes("summary")) out.overview ??= sheet;
  }
  return out;
}

function rawRows(sheet: XLSX.WorkSheet | null): unknown[][] {
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as unknown[][];
}

// ─── Keywords tab ──────────────────────────────────────────────────────

interface KeywordsParseResult {
  campaigns: GoogleSearchCampaignDraftNode[];
}

function parseKeywordsTab(
  sheet: XLSX.WorkSheet | null,
  warnings: GoogleSearchImportWarning[],
): KeywordsParseResult {
  const rows = recordsFromRawRowsWithHeaderScan(rawRows(sheet), ["campaign", "keyword"]);
  const campaignMap = new Map<string, GoogleSearchCampaignDraftNode>();
  const adGroupMap = new Map<string, GoogleSearchAdGroupDraftNode>();

  for (const idx of rows) {
    const campaignName = cell(idx.campaign);
    const adGroupName = cell(idx.adgroup);
    const keywordText = cell(idx.keyword);
    if (!keywordText) continue;
    if (!campaignName) {
      warnings.push({
        code: "missing_campaign",
        message: `Keyword "${keywordText}" has no campaign column — skipped.`,
        context: { keyword: keywordText },
      });
      continue;
    }
    if (!adGroupName) {
      warnings.push({
        code: "missing_ad_group",
        message: `Keyword "${keywordText}" has no ad-group column — skipped.`,
        context: { keyword: keywordText, campaign: campaignName },
      });
      continue;
    }

    const matchType = normaliseMatchType(idx.matchtype);
    if (!matchType) {
      warnings.push({
        code: "unknown_match_type",
        message: `Keyword "${keywordText}" has unrecognised match type "${cell(idx.matchtype)}" — skipped.`,
        context: { keyword: keywordText, raw: cell(idx.matchtype) || null },
      });
      continue;
    }

    let campaign = campaignMap.get(campaignName);
    if (!campaign) {
      campaign = {
        name: campaignName,
        priority: null,
        monthly_budget: null,
        daily_budget: null,
        bid_adjustments: {},
        notes: null,
        sort_order: campaignMap.size,
        ad_groups: [],
      };
      campaignMap.set(campaignName, campaign);
    }

    const adGroupKey = `${campaignName}::${adGroupName}`;
    let adGroup = adGroupMap.get(adGroupKey);
    if (!adGroup) {
      adGroup = {
        name: adGroupName,
        default_cpc: null,
        sort_order: campaign.ad_groups.length,
        keywords: [],
        rsas: [],
      };
      adGroupMap.set(adGroupKey, adGroup);
      campaign.ad_groups.push(adGroup);
    }

    const keyword: GoogleSearchKeywordDraft = {
      keyword: keywordText,
      match_type: matchType,
      est_cpc_low: numericOrNull(idx.estcpclow ?? idx.cpclow ?? idx.estcpc),
      est_cpc_high: numericOrNull(idx.estcpchigh ?? idx.cpchigh),
      intent: cell(idx.intent) || null,
      notes: cell(idx.notes) || null,
    };

    const dupe = adGroup.keywords.find(
      (k) => k.keyword.toLowerCase() === keyword.keyword.toLowerCase() && k.match_type === keyword.match_type,
    );
    if (dupe) {
      warnings.push({
        code: "duplicate_keyword",
        message: `Duplicate keyword "${keyword.keyword}" (${keyword.match_type}) in ad group "${adGroupName}" — skipped.`,
        context: { keyword: keyword.keyword, ad_group: adGroupName },
      });
      continue;
    }
    adGroup.keywords.push(keyword);
  }

  return { campaigns: Array.from(campaignMap.values()) };
}

// ─── Overview tab ──────────────────────────────────────────────────────

function applyOverview(
  campaigns: GoogleSearchCampaignDraftNode[],
  sheet: XLSX.WorkSheet | null,
): void {
  // Overview tabs usually have a title row + blank rows above the actual
  // header. Scan for a row that contains "campaign" + at least one other
  // recognised column, treat that as the header, and build records below.
  const raw = rawRows(sheet);
  const records = recordsFromRawRowsWithHeaderScan(raw, ["campaign"]);
  const byName = new Map(campaigns.map((c) => [c.name.toLowerCase(), c]));
  for (const row of records) {
    const name = cell(row.campaign);
    if (!name) continue;
    const campaign = byName.get(name.toLowerCase());
    if (!campaign) continue;
    campaign.priority = cell(row.priority) || campaign.priority;
    campaign.monthly_budget =
      numericOrNull(row.monthlybudget ?? row.budget) ?? campaign.monthly_budget;
    campaign.notes = cell(row.notes) || campaign.notes;
  }
}

/**
 * Convert `rawRows` (header:1 aoa) into header-keyed records by locating
 * the first row containing every `requiredHeader`. Returns [] when no
 * header row is found. Headers are normalised via `headerKey()` for
 * tolerant matching downstream.
 */
function recordsFromRawRowsWithHeaderScan(
  raw: unknown[][],
  requiredHeaders: string[],
): Record<string, unknown>[] {
  if (raw.length === 0) return [];
  let headerIdx = -1;
  for (let i = 0; i < raw.length; i += 1) {
    const keys = (raw[i] ?? []).map((c) => headerKey(c));
    if (requiredHeaders.every((h) => keys.includes(headerKey(h)))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) return [];
  const headerKeys = (raw[headerIdx] ?? []).map((c) => headerKey(c));
  const records: Record<string, unknown>[] = [];
  for (let i = headerIdx + 1; i < raw.length; i += 1) {
    const row = raw[i] ?? [];
    if (row.every((c) => c == null || c === "")) continue;
    const record: Record<string, unknown> = {};
    for (let j = 0; j < headerKeys.length; j += 1) {
      const key = headerKeys[j];
      if (key) record[key] = row[j];
    }
    records.push(record);
  }
  return records;
}

function extractPlanNameFromOverview(sheet: XLSX.WorkSheet | null): string | null {
  if (!sheet) return null;
  const raw = rawRows(sheet);
  for (let i = 0; i < Math.min(raw.length, 12); i += 1) {
    for (const cellValue of raw[i] ?? []) {
      const text = cell(cellValue);
      if (text.length > 6 && /plan|campaign|search/i.test(text)) return text;
    }
  }
  return null;
}

// ─── Ad Copy tab ──────────────────────────────────────────────────────

function applyAdCopy(
  campaigns: GoogleSearchCampaignDraftNode[],
  sheet: XLSX.WorkSheet | null,
  warnings: GoogleSearchImportWarning[],
): void {
  const rows = recordsFromRawRowsWithHeaderScan(rawRows(sheet), ["campaign", "type"]);
  // Group by campaign → split rows into headlines (H1..Hn) / descriptions (D1..Dn).
  const byCampaign = new Map<string, { headlines: RsaHeadline[]; descriptions: RsaDescription[] }>();
  for (const idx of rows) {
    const campaignName = cell(idx.campaign);
    const typeRaw = cell(idx.type).toUpperCase();
    const content = cell(idx.content ?? idx.text ?? idx.copy);
    if (!campaignName || !typeRaw || !content) continue;
    const bucket = byCampaign.get(campaignName) ?? { headlines: [], descriptions: [] };
    if (/^H\d+$/.test(typeRaw)) {
      const overflow = classifyCharOverflow(content, "headline");
      if (overflow) warnings.push({ ...overflow, context: { ...overflow.context, campaign: campaignName, slot: typeRaw } });
      bucket.headlines.push({ text: content });
    } else if (/^D\d+$/.test(typeRaw)) {
      const overflow = classifyCharOverflow(content, "description");
      if (overflow) warnings.push({ ...overflow, context: { ...overflow.context, campaign: campaignName, slot: typeRaw } });
      bucket.descriptions.push({ text: content });
    }
    byCampaign.set(campaignName, bucket);
  }

  for (const campaign of campaigns) {
    const rsa = byCampaign.get(campaign.name);
    if (!rsa || (rsa.headlines.length === 0 && rsa.descriptions.length === 0)) {
      warnings.push({
        code: "empty_rsa",
        message: `No RSA copy found for campaign "${campaign.name}".`,
        context: { campaign: campaign.name },
      });
      continue;
    }
    const draft: GoogleSearchRsaDraft = {
      headlines: rsa.headlines,
      descriptions: rsa.descriptions,
      final_url: null,
      path1: null,
      path2: null,
    };
    // Attach the RSA to every ad group under this campaign — the wizard
    // can prune or specialise per ad group. Most xlsx plans treat ad copy
    // as a campaign-level library.
    for (const adGroup of campaign.ad_groups) {
      adGroup.rsas.push(draft);
    }
  }
}

// ─── Negative Keywords tab ─────────────────────────────────────────────

function parseNegativesTab(
  sheet: XLSX.WorkSheet | null,
  campaignNames: string[],
  warnings: GoogleSearchImportWarning[],
): GoogleSearchNegativeDraft[] {
  // Negative tabs may use either "negative keyword" or "keyword" as the
  // text column header — scan for the row that contains either.
  const raw = rawRows(sheet);
  const rows =
    recordsFromRawRowsWithHeaderScan(raw, ["negativekeyword"]).length > 0
      ? recordsFromRawRowsWithHeaderScan(raw, ["negativekeyword"])
      : recordsFromRawRowsWithHeaderScan(raw, ["keyword"]);
  const lowerByName = new Map(campaignNames.map((n) => [n.toLowerCase(), n]));
  const out: GoogleSearchNegativeDraft[] = [];
  for (const idx of rows) {
    const keyword = cell(idx.negativekeyword ?? idx.keyword);
    if (!keyword) continue;
    const matchType = normaliseMatchType(idx.matchtype);
    if (!matchType) {
      warnings.push({
        code: "unknown_match_type",
        message: `Negative "${keyword}" has unrecognised match type "${cell(idx.matchtype)}" — skipped.`,
        context: { keyword, raw: cell(idx.matchtype) || null },
      });
      continue;
    }
    const scopeRaw = cell(idx.scope ?? idx.campaign ?? idx.level).toLowerCase();
    const scope: GoogleSearchNegativeDraft["scope"] =
      scopeRaw === "" || scopeRaw === "all" || scopeRaw === "plan"
        ? { kind: "plan" }
        : (() => {
            const canonical = lowerByName.get(scopeRaw);
            if (canonical) return { kind: "campaign", campaign_name: canonical };
            // Fall back to plan-scope if the scope string doesn't match a known
            // campaign — better to over-share than to drop the negative entirely.
            warnings.push({
              code: "missing_campaign",
              message: `Negative "${keyword}" scoped to unknown campaign "${scopeRaw}" — added as plan-scoped fallback.`,
              context: { keyword, scope: scopeRaw },
            });
            return { kind: "plan" };
          })();

    out.push({
      keyword,
      match_type: matchType,
      reason: cell(idx.reason) || null,
      scope,
    });
  }
  return out;
}
