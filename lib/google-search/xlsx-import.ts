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
 *   - Keywords        — campaign | ad group | keyword | match type
 *                       (also "Criterion Type", "Type", "Match") |
 *                       est cpc low | est cpc high | max cpc | intent |
 *                       notes | final url | status
 *   - Ad Copy         — tall: campaign | type (H1..H15, D1..D4) | content
 *                       wide: one row per ad group, Headline 1..15 and
 *                       Description 1..4 columns (tab may be named RSAs)
 *   - Negative Keywords — scope (all / campaign name) | negative keyword |
 *                       match type (also "Criterion Type") | reason
 *   - Campaigns       — status at launch, bid strategy, max CPC cap,
 *                       ad schedule, start, end, networks. Stored on
 *                       notes, bid_adjustments, and ad-group default CPC.
 *   - Budget Phasing  — not read.
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
  DEFAULT_GEO_TARGET_TYPE,
  DEFAULT_STRUCTURE_MODE,
  GOOGLE_SEARCH_LIMITS,
  type GoogleSearchAdGroupDraftNode,
  type GoogleSearchBiddingStrategy,
  type GoogleSearchCampaignDraftNode,
  type GoogleSearchDateRange,
  type GoogleSearchImportWarning,
  type GoogleSearchKeywordDraft,
  type GoogleSearchMatchType,
  type GoogleSearchNegativeDraft,
  type GoogleSearchPlanDraftTree,
  type GoogleSearchRsaDraft,
  type GoogleSearchStructureMode,
  type RsaDescription,
  type RsaHeadline,
  MATCH_TYPES,
} from "./types.ts";

// ─── Public entry point ────────────────────────────────────────────────

export interface ParseXlsxOptions {
  /** Plan name fallback when no Overview tab is present. */
  fallbackPlanName?: string;
  /**
   * Campaign structure mode for this import.
   *
   * - `single_campaign` (DEFAULT): all C-codes become ad groups under ONE
   *   campaign. Recommended for single events.
   * - `campaign_per_theme`: one campaign per C-code (legacy behaviour).
   *
   * Defaults to `single_campaign` — the new recommended default.
   */
  structureMode?: GoogleSearchStructureMode;
}

export function parseGoogleSearchPlanXlsx(
  buffer: Uint8Array | ArrayBuffer,
  options: ParseXlsxOptions = {},
): GoogleSearchPlanDraftTree {
  const view =
    buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const workbook = XLSX.read(view, { type: "array" });
  const tabs = indexTabs(workbook);

  const structureMode: GoogleSearchStructureMode =
    options.structureMode ?? DEFAULT_STRUCTURE_MODE;
  const warnings: GoogleSearchImportWarning[] = [];

  // Step 1: keywords build the campaign/ad-group skeleton.
  const skeleton = parseKeywordsTab(tabs.keywords, warnings);

  // Step 2: overview enriches campaign meta (priority, monthly budget, notes).
  applyOverview(skeleton.campaigns, tabs.overview);

  // Step 2b: the Campaigns tab (status, bid, schedule, dates, networks).
  // Stored on fields the tree writer already persists. Push does not
  // read a per-campaign pause, schedule, or network flag.
  const campaignHints = applyCampaignsSheet(
    skeleton.campaigns,
    tabs.campaigns,
    warnings,
  );

  // Step 3: landing URL. Metadata above the Ad Copy / Overview header
  // still wins. A Final URL column on Keywords (or, later, on a wide
  // RSA row) is the fallback — those cells are below the header, so
  // extractFinalUrlFromTab never sees them.
  const metadataUrl =
    extractFinalUrlFromTab(tabs.adCopy) ?? extractFinalUrlFromTab(tabs.overview);
  const planFinalUrl = metadataUrl ?? skeleton.columnFinalUrl;

  // Step 4: ad copy. Tall sheets copy one RSA onto every ad group.
  // Wide sheets (Headline 1..N) attach each row to the named ad group.
  applyAdCopy(
    skeleton.campaigns,
    tabs.adCopy,
    warnings,
    planFinalUrl,
    skeleton.finalUrlByAdGroup,
  );

  const anyRsaUrl = skeleton.campaigns.some((c) =>
    c.ad_groups.some((ag) => ag.rsas.some((rsa) => rsa.final_url)),
  );
  if (!planFinalUrl && !anyRsaUrl) {
    warnings.push({
      code: "missing_final_url",
      message:
        "No landing URL found in the Ad Copy / Overview metadata or in a Final URL column. " +
        "Set a Default final URL in the wizard before push — Google " +
        "Ads rejects RSAs without finalUrls.",
    });
  }

  // Step 5: negatives — plan-scoped or campaign-scoped.
  const negatives = parseNegativesTab(
    tabs.negativeKeywords,
    skeleton.campaigns.map((c) => c.name),
    warnings,
  );

  const planName =
    extractPlanNameFromOverview(tabs.overview) ??
    options.fallbackPlanName ??
    "Imported Google Search Plan";

  // Step 6: apply structure mode.
  // In single_campaign mode: collapse all C-code campaigns into one campaign
  // whose ad groups are named "{C-prefix} – {original ad group name}".
  // In campaign_per_theme mode: pass the skeleton through unchanged.
  let finalCampaigns = skeleton.campaigns;
  let finalNegatives = negatives;
  if (structureMode === "single_campaign" && skeleton.campaigns.length > 0) {
    const result = restructureAsSingleCampaign(
      skeleton.campaigns,
      negatives,
      planName,
      warnings,
    );
    finalCampaigns = [result.campaign];
    finalNegatives = result.negatives;
  }

  return {
    plan: {
      name: planName,
      event_id: null,
      google_ads_account_id: null,
      status: "draft",
      structure_mode: structureMode,
      total_budget: null,
      bidding_strategy: campaignHints.biddingStrategy ?? "maximize_clicks",
      geo_targets: [],
      geo_target_type: DEFAULT_GEO_TARGET_TYPE,
      date_range: campaignHints.dateRange,
    },
    campaigns: finalCampaigns,
    negatives: finalNegatives,
    // Sitelinks are not extracted from xlsx in Phase 1 — the API route
    // seeds defaults via `defaultSitelinkSeeds()` once it knows the
    // event's venue. Empty list lets the route layer decide.
    sitelinks: [],
    warnings,
  };
}

// ─── Helpers exported for tests ────────────────────────────────────────

/**
 * Collapse N campaign-per-C-code drafts into a SINGLE campaign whose ad
 * groups are named `{C-prefix} – {original ad group name}` (e.g.
 * "C2 – Adam Beyer Tickets"). RSAs and keywords are unchanged; they remain
 * attached to their ad groups.
 *
 * Negatives:
 *   - Plan-scoped negatives pass through unchanged.
 *   - Campaign-scoped negatives are PROMOTED to plan-scoped, because in
 *     single-campaign mode there is only one campaign and per-C-code
 *     campaign isolation is meaningless. Each promoted negative emits a
 *     `campaign_negative_promoted_to_plan` info warning so the operator
 *     knows what happened.
 *
 * The merged campaign inherits no `monthly_budget` or `daily_budget` —
 * the operator sets the daily budget in the wizard (the plan `total_budget`
 * envelope is the reference figure). Source-campaign notes, including a
 * Paused-at-launch line, are concatenated onto the merged campaign.
 * Ad-group default CPC set from a campaign CPC cap stays on each ad group.
 */
export function restructureAsSingleCampaign(
  campaigns: GoogleSearchCampaignDraftNode[],
  negatives: GoogleSearchNegativeDraft[],
  planName: string,
  warnings: GoogleSearchImportWarning[],
): { campaign: GoogleSearchCampaignDraftNode; negatives: GoogleSearchNegativeDraft[] } {
  const adGroups: GoogleSearchAdGroupDraftNode[] = [];
  let adGroupSortOrder = 0;

  for (const campaign of campaigns) {
    const prefix = extractCCodePrefix(campaign.name);
    if (campaign.bid_adjustments.status_at_launch === "PAUSED") {
      warnings.push({
        code: "sheet_field_recorded",
        message:
          `Campaign "${campaign.name}" is marked Paused at launch. ` +
          "Single-campaign mode keeps that note on the merged campaign. " +
          "Push creates the one campaign PAUSED and has no per-theme pause.",
        context: { campaign: campaign.name },
      });
    }
    for (const ag of campaign.ad_groups) {
      adGroups.push({
        ...ag,
        name: prefix ? `${prefix} – ${ag.name}` : `${campaign.name} – ${ag.name}`,
        sort_order: adGroupSortOrder++,
      });
    }
  }

  // Promote campaign-scoped negatives to plan-scoped.
  const promotedNegatives: GoogleSearchNegativeDraft[] = negatives.map((neg) => {
    if (neg.scope.kind === "campaign") {
      warnings.push({
        code: "campaign_negative_promoted_to_plan",
        message: `Negative "${neg.keyword}" was scoped to campaign "${neg.scope.campaign_name}" — promoted to plan-scoped (single-campaign mode, all C-codes share one campaign).`,
        context: { keyword: neg.keyword, original_campaign: neg.scope.campaign_name },
      });
      return { ...neg, scope: { kind: "plan" } };
    }
    return neg;
  });

  const noteLines = campaigns
    .map((c) => c.notes)
    .filter((n): n is string => Boolean(n && n.trim()));
  const launchByCampaign: Record<string, string> = {};
  for (const source of campaigns) {
    const status = source.bid_adjustments.status_at_launch;
    if (typeof status === "string" && status.length > 0) {
      launchByCampaign[source.name] = status;
    }
  }

  const campaign: GoogleSearchCampaignDraftNode = {
    name: planName,
    priority: null,
    monthly_budget: null,
    daily_budget: null,
    bid_adjustments:
      Object.keys(launchByCampaign).length > 0
        ? { status_at_launch_by_campaign: launchByCampaign }
        : {},
    notes: noteLines.length > 0 ? noteLines.join("\n") : null,
    sort_order: 0,
    ad_groups: adGroups,
  };

  return { campaign, negatives: promotedNegatives };
}

/**
 * C-code anywhere in the name, as a whole token.
 * "C1 Brand Defence" → "C1"
 * "C2 – Adam Beyer" → "C2"
 * "[IRW0001] JJ | Search | C1 Brand-Event-Venue" → "C1"
 * "Brand" → null
 */
const C_CODE_PATTERN = /\bc(\d+)\b/i;

export function extractCCodePrefix(name: string): string | null {
  const digits = cCodeDigits(name);
  return digits ? `C${digits}` : null;
}

function cCodeDigits(name: string): string | null {
  const match = C_CODE_PATTERN.exec(name.trim());
  return match ? match[1] : null;
}

/**
 * Header keys that mean "match type", in preference order.
 * Keywords sheets from Google Ads Editor say "Criterion Type";
 * the Negatives tab in the same workbook says "Match type".
 */
const MATCH_TYPE_COLUMN_KEYS = ["matchtype", "criteriontype", "type", "match"] as const;

function readMatchTypeRaw(record: Record<string, unknown>): unknown {
  for (const key of MATCH_TYPE_COLUMN_KEYS) {
    if (!(key in record)) continue;
    if (cell(record[key]) !== "") return record[key];
  }
  for (const key of MATCH_TYPE_COLUMN_KEYS) {
    if (key in record) return record[key];
  }
  return undefined;
}

/**
 * 422 copy when the parser produced no campaigns. Counts the warnings
 * the parser already emitted so the operator is sent to the column
 * that failed, not to a tab that parsed.
 */
export function describeEmptyGoogleSearchImport(
  warnings: GoogleSearchImportWarning[],
): string {
  const keywordMatchDrops = warnings.filter(
    (w) => w.code === "unknown_match_type" && w.message.startsWith("Keyword "),
  ).length;
  const sentences = ["Parsed 0 campaigns."];
  if (keywordMatchDrops > 0) {
    const rows = keywordMatchDrops === 1 ? "row was" : "rows were";
    sentences.push(
      `${keywordMatchDrops} keyword ${rows} dropped: unrecognised match type.`,
    );
  }
  const missingCampaign = warnings.filter((w) => w.code === "missing_campaign").length;
  if (missingCampaign > 0) {
    const rows = missingCampaign === 1 ? "row" : "rows";
    sentences.push(`${missingCampaign} ${rows} had no campaign.`);
  }
  const missingAdGroup = warnings.filter((w) => w.code === "missing_ad_group").length;
  if (missingAdGroup > 0) {
    const rows = missingAdGroup === 1 ? "row" : "rows";
    sentences.push(`${missingAdGroup} ${rows} had no ad group.`);
  }
  if (warnings.some((w) => w.code === "missing_final_url")) {
    sentences.push("No landing URL was found.");
  }
  if (sentences.length === 1) {
    sentences.push("No keyword rows became a campaign.");
  }
  return sentences.join(" ");
}

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
  campaigns: XLSX.WorkSheet | null;
  // budget phasing intentionally not consumed (no daily-budget grid reader).
}

function sheetTokens(name: string): string[] {
  return String(name)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

/**
 * Ad-copy tabs by whole token. `5 RSAs` → `rsas`. `Ad Copy` → `ad` + `copy`.
 * A bare `ad` token is not enough: it would claim `Ad Schedule` or `Radio`.
 */
function isAdCopySheet(name: string): boolean {
  const tokens = sheetTokens(name);
  if (tokens.includes("rsa") || tokens.includes("rsas") || tokens.includes("adcopy")) {
    return true;
  }
  return tokens.includes("ad") && tokens.includes("copy");
}

function isCampaignsSheet(name: string): boolean {
  const tokens = sheetTokens(name);
  return tokens.includes("campaign") || tokens.includes("campaigns");
}

function indexTabs(workbook: XLSX.WorkBook): IndexedTabs {
  const out: IndexedTabs = {
    overview: null,
    keywords: null,
    adCopy: null,
    negativeKeywords: null,
    campaigns: null,
  };
  for (const name of workbook.SheetNames) {
    const key = headerKey(name);
    const sheet = workbook.Sheets[name];
    if (key.includes("negative")) out.negativeKeywords ??= sheet;
    else if (key.includes("keyword")) out.keywords ??= sheet;
    else if (isAdCopySheet(name)) out.adCopy ??= sheet;
    else if (isCampaignsSheet(name)) out.campaigns ??= sheet;
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
  /** First non-empty Final URL column value, if that column exists. */
  columnFinalUrl: string | null;
  /** `${campaign}::${adGroup}` → Final URL from the keyword rows. */
  finalUrlByAdGroup: Map<string, string>;
}

function parseKeywordsTab(
  sheet: XLSX.WorkSheet | null,
  warnings: GoogleSearchImportWarning[],
): KeywordsParseResult {
  const rows = recordsFromRawRowsWithHeaderScan(rawRows(sheet), ["campaign", "keyword"]);
  const campaignMap = new Map<string, GoogleSearchCampaignDraftNode>();
  const adGroupMap = new Map<string, GoogleSearchAdGroupDraftNode>();
  const finalUrlByAdGroup = new Map<string, string>();
  let columnFinalUrl: string | null = null;
  let pausedKeywordCount = 0;
  let sawKeywordMaxCpc = false;

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

    const rawMatch = readMatchTypeRaw(idx);
    const matchType = normaliseMatchType(rawMatch);
    if (!matchType) {
      warnings.push({
        code: "unknown_match_type",
        message: `Keyword "${keywordText}" has unrecognised match type "${cell(rawMatch)}" — skipped.`,
        context: { keyword: keywordText, raw: cell(rawMatch) || null },
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

    if (idx.maxcpc != null && cell(idx.maxcpc) !== "") sawKeywordMaxCpc = true;
    const rowUrl = urlFromCell(idx.finalurl);
    if (rowUrl) {
      columnFinalUrl ??= rowUrl;
      const urlKey = `${campaignName}::${adGroupName}`;
      if (!finalUrlByAdGroup.has(urlKey)) finalUrlByAdGroup.set(urlKey, rowUrl);
    }

    const statusRaw = cell(idx.status);
    let notes = cell(idx.notes) || null;
    if (statusRaw && !/^enabled$/i.test(statusRaw)) {
      notes = notes ? `${notes} (${statusRaw})` : statusRaw;
      if (isPausedStatus(statusRaw)) pausedKeywordCount += 1;
    }

    const keyword: GoogleSearchKeywordDraft = {
      keyword: keywordText,
      match_type: matchType,
      est_cpc_low: numericOrNull(idx.estcpclow ?? idx.cpclow ?? idx.estcpc ?? idx.maxcpc),
      est_cpc_high: numericOrNull(idx.estcpchigh ?? idx.cpchigh),
      intent: cell(idx.intent ?? idx.intentnote) || null,
      notes,
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

  if (pausedKeywordCount > 0) {
    warnings.push({
      code: "sheet_field_recorded",
      message:
        `${pausedKeywordCount} keyword ${pausedKeywordCount === 1 ? "row is" : "rows are"} marked Paused. ` +
        "The status is stored on the keyword notes. Push creates keywords ENABLED.",
      context: { count: pausedKeywordCount },
    });
  }
  if (sawKeywordMaxCpc) {
    warnings.push({
      code: "sheet_field_recorded",
      message:
        "Keyword Max CPC values were stored as est_cpc_low. Push does not send a keyword bid.",
    });
  }

  return {
    campaigns: Array.from(campaignMap.values()),
    columnFinalUrl,
    finalUrlByAdGroup,
  };
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

/**
 * Real-world J2 plan structure: the Ad Copy tab uses full-width SECTION
 * HEADER banner rows (e.g. `C1 – BRAND: JUNCTION 2`) above each block
 * of headlines / descriptions, and the same campaign appears TWICE —
 * once over its H1..Hn block, then again over its D1..Dn block. Every
 * H/D row leaves the Campaign column BLANK; the section header is the
 * only signal that ties the rows to a campaign.
 *
 * We therefore walk the raw rows below the header and carry forward
 * the most recent campaign matched from a section banner. We still
 * honour an explicit Campaign cell when present so the simpler flat
 * layout (the original test fixture) keeps working.
 *
 * Headlines and descriptions for the same campaign — wherever they
 * appear — accumulate into a SINGLE RSA per campaign, which is then
 * attached to every ad group under that campaign (the wizard can
 * specialise per ad group later).
 */
/**
 * Scan the top of a tab (above the canonical header row) for the first
 * cell containing a URL. The real J2 Ad Copy tab has a metadata row
 * like `Headlines: max 30 chars … · Final URL: https://www.seetickets.com/event/...`;
 * we accept any `https?://...` anywhere in any pre-header cell.
 *
 * Returns the first match (trimmed, with trailing punctuation
 * stripped) or `null`. Tabs without a recognisable header are scanned
 * end-to-end so we still surface a URL in an oddly-structured sheet.
 */
export function extractFinalUrlFromTab(sheet: XLSX.WorkSheet | null): string | null {
  if (!sheet) return null;
  const raw = rawRows(sheet);
  if (raw.length === 0) return null;
  // Limit scanning to the rows before the first canonical header
  // (campaign + type for Ad Copy, campaign + anything else otherwise);
  // if none found, scan the first 12 rows as a fallback.
  let scanUntil = raw.length;
  for (let i = 0; i < raw.length; i += 1) {
    const keys = (raw[i] ?? []).map((c) => headerKey(c));
    if (keys.includes(headerKey("campaign")) && keys.length > 1) {
      scanUntil = i;
      break;
    }
  }
  if (scanUntil === raw.length) scanUntil = Math.min(12, raw.length);

  const urlPattern = /https?:\/\/[^\s"'<>\]\),]+/i;
  for (let i = 0; i < scanUntil; i += 1) {
    for (const value of raw[i] ?? []) {
      const text = cell(value);
      if (!text) continue;
      const match = urlPattern.exec(text);
      if (match) return stripTrailingPunctuation(match[0]);
    }
  }
  return null;
}

function stripTrailingPunctuation(url: string): string {
  return url.replace(/[).,;:!?]+$/u, "");
}

function applyAdCopy(
  campaigns: GoogleSearchCampaignDraftNode[],
  sheet: XLSX.WorkSheet | null,
  warnings: GoogleSearchImportWarning[],
  planFinalUrl: string | null,
  finalUrlByAdGroup: Map<string, string>,
): void {
  const raw = rawRows(sheet);
  if (raw.length === 0) return;

  // Wide (Headline 1..N) wins when both shapes are present. Tall needs
  // a Type column the wide sheet does not have.
  let wideIdx = -1;
  let headerIdx = -1;
  for (let i = 0; i < raw.length; i += 1) {
    const keys = (raw[i] ?? []).map((c) => headerKey(c));
    if (wideIdx < 0 && isWideRsaHeader(keys)) wideIdx = i;
    if (
      headerIdx < 0 &&
      keys.includes(headerKey("campaign")) &&
      keys.includes(headerKey("type"))
    ) {
      headerIdx = i;
    }
  }
  if (wideIdx >= 0) {
    applyWideAdCopy(
      campaigns,
      raw,
      wideIdx,
      warnings,
      planFinalUrl,
      finalUrlByAdGroup,
    );
    return;
  }
  if (headerIdx < 0) return;

  warnings.push({
    code: "rsa_layout",
    message:
      "RSA layout: tall. One RSA per campaign was copied onto every ad group.",
  });

  const headerKeys = (raw[headerIdx] ?? []).map((c) => headerKey(c));
  const campaignCol = headerKeys.indexOf(headerKey("campaign"));
  const typeCol = headerKeys.indexOf(headerKey("type"));
  const contentCol =
    headerKeys.indexOf(headerKey("content")) >= 0
      ? headerKeys.indexOf(headerKey("content"))
      : headerKeys.indexOf(headerKey("text")) >= 0
        ? headerKeys.indexOf(headerKey("text"))
        : headerKeys.indexOf(headerKey("copy"));

  // Lookups for matching section-header text to a skeleton campaign.
  // Exact (normalised) match wins; the `C\d+` prefix is the fallback so
  // a stray casing / punctuation difference between the Keywords tab
  // and the Ad Copy banner doesn't strand a whole block of rows.
  const skeletonByExact = new Map<string, string>();
  const skeletonByPrefix = new Map<string, string>();
  for (const c of campaigns) {
    skeletonByExact.set(normaliseCampaignKey(c.name), c.name);
    const digits = cCodeDigits(c.name);
    if (digits) skeletonByPrefix.set(digits, c.name);
  }
  const resolveCampaign = (text: string): string | null => {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const key = normaliseCampaignKey(trimmed);
    const exact = skeletonByExact.get(key);
    if (exact) return exact;
    const digits = cCodeDigits(trimmed);
    if (digits) {
      const byPrefix = skeletonByPrefix.get(digits);
      if (byPrefix) return byPrefix;
    }
    return null;
  };

  const byCampaign = new Map<
    string,
    { headlines: RsaHeadline[]; descriptions: RsaDescription[] }
  >();
  let currentCampaign: string | null = null;

  for (let i = headerIdx + 1; i < raw.length; i += 1) {
    const row = raw[i] ?? [];
    if (row.every((c) => c == null || c === "")) continue;

    const campaignCell = campaignCol >= 0 ? cell(row[campaignCol]) : "";
    const typeCell = typeCol >= 0 ? cell(row[typeCol]).toUpperCase() : "";
    const contentCell = contentCol >= 0 ? cell(row[contentCol]) : "";
    const isHeadline = /^H\d+$/.test(typeCell);
    const isDescription = /^D\d+$/.test(typeCell);
    const isDataRow = isHeadline || isDescription;

    if (!isDataRow) {
      // Section banner — try to resolve the first non-empty cell to a
      // skeleton campaign and update currentCampaign. Anything that
      // isn't recognisable is treated as a benign separator row.
      const banner = (row.map((c) => cell(c)).find((s) => s.length > 0) ?? "");
      const matched = resolveCampaign(banner);
      if (matched) currentCampaign = matched;
      continue;
    }

    // Data row — resolve the campaign: explicit Campaign cell wins,
    // else carry-forward from the most recent section banner.
    const explicit = campaignCell ? resolveCampaign(campaignCell) : null;
    const resolved = explicit ?? currentCampaign;
    if (!resolved) {
      warnings.push({
        code: "ad_copy_orphan",
        message: `Ad copy row "${typeCell}: ${contentCell}" has no campaign context — skipped.`,
        context: { type: typeCell, content: contentCell || null },
      });
      continue;
    }
    if (!contentCell || contentCell.startsWith("=")) continue;

    const bucket = byCampaign.get(resolved) ?? { headlines: [], descriptions: [] };
    if (isHeadline) {
      const overflow = classifyCharOverflow(contentCell, "headline");
      if (overflow) {
        warnings.push({
          ...overflow,
          context: { ...overflow.context, campaign: resolved, slot: typeCell },
        });
      }
      bucket.headlines.push({ text: contentCell });
    } else {
      const overflow = classifyCharOverflow(contentCell, "description");
      if (overflow) {
        warnings.push({
          ...overflow,
          context: { ...overflow.context, campaign: resolved, slot: typeCell },
        });
      }
      bucket.descriptions.push({ text: contentCell });
    }
    byCampaign.set(resolved, bucket);
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
      // Plan-level default extracted from Ad Copy / Overview metadata.
      // Wizard can override per RSA in Ad Copy step; Review hard-blocks
      // on null at push time.
      final_url: planFinalUrl,
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

/**
 * Normalise a campaign-name candidate for fuzzy matching: lowercase,
 * collapse all dash variants (- – —) to `-`, collapse whitespace.
 * Used by `applyAdCopy` to match section-banner text (`C1 – BRAND:
 * JUNCTION 2`) to a skeleton campaign (`C1 – Brand: Junction 2`).
 */
export function normaliseCampaignKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function isWideRsaHeader(keys: string[]): boolean {
  return keys.includes("campaign") && keys.some((key) => /^headline\d+$/.test(key));
}

function isPausedStatus(raw: string): boolean {
  return raw.trim().toLowerCase().startsWith("pause");
}

function urlFromCell(value: unknown): string | null {
  const text = cell(value);
  if (!text || text.startsWith("=")) return null;
  const match = /https?:\/\/[^\s"'<>\]\),]+/i.exec(text);
  if (!match) return null;
  return stripTrailingPunctuation(match[0]);
}

/** Spreadsheet copy. Formula cells (`=MAX(LEN(...))`) are not headlines. */
function copyCell(value: unknown): string {
  const text = cell(value);
  if (!text || text.startsWith("=")) return "";
  return text;
}

function dateCell(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number" && value > 20000 && value < 80000) {
    const utc = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86400000);
    return utc.toISOString().slice(0, 10);
  }
  const text = cell(value);
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(text);
  if (iso) return iso[1];
  return text || null;
}

function normaliseBidStrategy(raw: string): GoogleSearchBiddingStrategy | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (s.includes("manual")) return "manual_cpc";
  if (s.includes("click")) return "maximize_clicks";
  return null;
}

function normaliseLaunchStatus(raw: string): "PAUSED" | "ENABLED" | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (s.startsWith("pause")) return "PAUSED";
  if (s === "enabled" || s === "active" || s === "live") return "ENABLED";
  return null;
}

function numberedColumns(headerKeys: string[], prefix: string): number[] {
  const found: Array<{ index: number; n: number }> = [];
  const pattern = new RegExp(`^${prefix}(\\d+)$`);
  headerKeys.forEach((key, index) => {
    const match = pattern.exec(key);
    if (!match) return;
    found.push({ index, n: Number(match[1]) });
  });
  found.sort((a, b) => a.n - b.n);
  return found.map((entry) => entry.index);
}

function applyWideAdCopy(
  campaigns: GoogleSearchCampaignDraftNode[],
  raw: unknown[][],
  headerIdx: number,
  warnings: GoogleSearchImportWarning[],
  planFinalUrl: string | null,
  finalUrlByAdGroup: Map<string, string>,
): void {
  warnings.push({
    code: "rsa_layout",
    message:
      "RSA layout: wide. Each row was attached to the named ad group, so per-ad-group copy was kept.",
  });

  const headerKeys = (raw[headerIdx] ?? []).map((c) => headerKey(c));
  const campaignCol = headerKeys.indexOf("campaign");
  const adGroupCol = headerKeys.indexOf("adgroup");
  const finalUrlCol = headerKeys.indexOf("finalurl");
  const path1Col = headerKeys.indexOf("path1");
  const path2Col = headerKeys.indexOf("path2");
  const headlineCols = numberedColumns(headerKeys, "headline");
  const descriptionCols = numberedColumns(headerKeys, "description");

  const byName = new Map(campaigns.map((c) => [c.name, c]));
  const byPrefix = new Map<string, GoogleSearchCampaignDraftNode>();
  for (const c of campaigns) {
    const digits = cCodeDigits(c.name);
    if (digits) byPrefix.set(digits, c);
  }
  const resolveCampaignNode = (text: string): GoogleSearchCampaignDraftNode | null => {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const exact = byName.get(trimmed) ?? null;
    if (exact) return exact;
    const folded = campaigns.find(
      (c) => normaliseCampaignKey(c.name) === normaliseCampaignKey(trimmed),
    );
    if (folded) return folded;
    const digits = cCodeDigits(trimmed);
    return digits ? byPrefix.get(digits) ?? null : null;
  };

  for (let i = headerIdx + 1; i < raw.length; i += 1) {
    const row = raw[i] ?? [];
    if (row.every((c) => c == null || c === "")) continue;
    const campaignCell = campaignCol >= 0 ? cell(row[campaignCol]) : "";
    const adGroupName = adGroupCol >= 0 ? cell(row[adGroupCol]) : "";
    const campaign = resolveCampaignNode(campaignCell);
    if (!campaign || !adGroupName) {
      warnings.push({
        code: "ad_copy_orphan",
        message: `Wide RSA row for "${adGroupName || campaignCell || "(blank)"}" did not match an ad group — skipped.`,
        context: { campaign: campaignCell || null, ad_group: adGroupName || null },
      });
      continue;
    }
    const adGroup = campaign.ad_groups.find(
      (ag) => normaliseCampaignKey(ag.name) === normaliseCampaignKey(adGroupName),
    );
    if (!adGroup) {
      warnings.push({
        code: "ad_copy_orphan",
        message: `Wide RSA row names ad group "${adGroupName}" which is not under "${campaign.name}" — skipped.`,
        context: { campaign: campaign.name, ad_group: adGroupName },
      });
      continue;
    }

    const headlines: RsaHeadline[] = [];
    for (const col of headlineCols) {
      const text = copyCell(row[col]);
      if (!text) continue;
      const overflow = classifyCharOverflow(text, "headline");
      if (overflow) {
        warnings.push({
          ...overflow,
          context: { ...overflow.context, campaign: campaign.name, ad_group: adGroup.name },
        });
      }
      headlines.push({ text });
    }
    const descriptions: RsaDescription[] = [];
    for (const col of descriptionCols) {
      const text = copyCell(row[col]);
      if (!text) continue;
      const overflow = classifyCharOverflow(text, "description");
      if (overflow) {
        warnings.push({
          ...overflow,
          context: { ...overflow.context, campaign: campaign.name, ad_group: adGroup.name },
        });
      }
      descriptions.push({ text });
    }
    if (headlines.length === 0 && descriptions.length === 0) continue;

    const rowUrl = finalUrlCol >= 0 ? urlFromCell(row[finalUrlCol]) : null;
    const groupUrl = finalUrlByAdGroup.get(`${campaign.name}::${adGroup.name}`) ?? null;
    adGroup.rsas.push({
      headlines,
      descriptions,
      final_url: rowUrl ?? groupUrl ?? planFinalUrl,
      path1: path1Col >= 0 ? copyCell(row[path1Col]) || null : null,
      path2: path2Col >= 0 ? copyCell(row[path2Col]) || null : null,
    });
  }

  for (const campaign of campaigns) {
    const missing = campaign.ad_groups.filter((ag) => ag.rsas.length === 0);
    if (missing.length === 0 || campaign.ad_groups.length === 0) continue;
    if (missing.length === campaign.ad_groups.length) {
      warnings.push({
        code: "empty_rsa",
        message: `No RSA copy found for campaign "${campaign.name}".`,
        context: { campaign: campaign.name },
      });
      continue;
    }
    for (const adGroup of missing) {
      warnings.push({
        code: "empty_rsa",
        message: `No RSA copy found for ad group "${adGroup.name}" in campaign "${campaign.name}".`,
        context: { campaign: campaign.name, ad_group: adGroup.name },
      });
    }
  }
}

interface CampaignSheetHints {
  biddingStrategy: GoogleSearchBiddingStrategy | null;
  dateRange: GoogleSearchDateRange | null;
}

/**
 * `3 Campaigns` holds launch status, bid strategy, a CPC cap, schedule,
 * dates, and network flags. Those land on notes and bid_adjustments,
 * which the existing tree writer already stores. The CPC cap is also
 * written to each ad group's default CPC, because that is the bid push
 * actually sends. There is no campaign-status column, and this function
 * does not invent one.
 */
function applyCampaignsSheet(
  campaigns: GoogleSearchCampaignDraftNode[],
  sheet: XLSX.WorkSheet | null,
  warnings: GoogleSearchImportWarning[],
): CampaignSheetHints {
  const empty: CampaignSheetHints = { biddingStrategy: null, dateRange: null };
  if (!sheet) return empty;
  const records = recordsFromRawRowsWithHeaderScan(rawRows(sheet), ["campaign"]);
  if (records.length === 0) {
    warnings.push({
      code: "sheet_field_recorded",
      message:
        "Campaigns tab was found but had no campaign header row, so launch status, bids, schedule, and dates were not read.",
    });
    return empty;
  }

  const byName = new Map(campaigns.map((c) => [normaliseCampaignKey(c.name), c]));
  const byPrefix = new Map<string, GoogleSearchCampaignDraftNode>();
  for (const c of campaigns) {
    const digits = cCodeDigits(c.name);
    if (digits && !byPrefix.has(digits)) byPrefix.set(digits, c);
  }

  const strategies = new Set<GoogleSearchBiddingStrategy>();
  const ranges: GoogleSearchDateRange[] = [];
  let matched = 0;

  for (const row of records) {
    const name = cell(row.campaign);
    if (!name) continue;
    const digits = cCodeDigits(name);
    const campaign =
      byName.get(normaliseCampaignKey(name)) ??
      (digits ? byPrefix.get(digits) ?? null : null);
    if (!campaign) continue;
    matched += 1;

    const status = normaliseLaunchStatus(cell(row.statusatlaunch ?? row.status));
    const bidRaw = cell(row.bidstrategy);
    const bid = normaliseBidStrategy(bidRaw);
    const cap = numericOrNull(row.maxcpccap ?? row.maxcpc);
    const schedule = cell(row.adschedule);
    const start = dateCell(row.start);
    const end = dateCell(row.end);
    const networks = cell(row.networks);

    if (bid) strategies.add(bid);
    if (start && end && /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end)) {
      ranges.push({ since: start, until: end });
    }
    if (cap != null) {
      for (const adGroup of campaign.ad_groups) {
        if (adGroup.default_cpc == null) adGroup.default_cpc = cap;
      }
    }

    const lines: string[] = [];
    if (status === "PAUSED") lines.push("Status at launch: Paused");
    else if (status === "ENABLED") lines.push("Status at launch: Enabled");
    if (bidRaw) lines.push(`Bid strategy: ${bidRaw}`);
    if (cap != null) lines.push(`Max CPC cap: ${cap}`);
    if (schedule) lines.push(`Ad schedule: ${schedule}`);
    if (start) lines.push(`Start: ${start}`);
    if (end) lines.push(`End: ${end}`);
    if (networks) lines.push(`Networks: ${networks}`);
    if (lines.length > 0) {
      const block = lines.join("; ");
      campaign.notes = campaign.notes ? `${campaign.notes}\n${block}` : block;
    }

    const adjustments: Record<string, unknown> = { ...campaign.bid_adjustments };
    if (status) adjustments.status_at_launch = status;
    if (bidRaw) adjustments.bid_strategy = bidRaw;
    if (cap != null) adjustments.max_cpc_cap = cap;
    if (schedule) adjustments.ad_schedule = schedule;
    if (start) adjustments.start = start;
    if (end) adjustments.end = end;
    if (networks) adjustments.networks = networks;
    campaign.bid_adjustments = adjustments;
  }

  if (matched > 0) {
    warnings.push({
      code: "sheet_field_recorded",
      message:
        "Campaigns tab was stored on each campaign (status at launch, bid strategy, max CPC cap, ad schedule, start, end, networks). " +
        "Max CPC cap is also written to each ad group's default CPC, which push sends as the ad group bid. " +
        "Push still creates every campaign PAUSED and does not apply the sheet's status, ad schedule, or network flags.",
      context: { campaigns: matched },
    });
  }

  let biddingStrategy: GoogleSearchBiddingStrategy | null = null;
  if (strategies.size === 1) {
    biddingStrategy = [...strategies][0] ?? null;
  } else if (strategies.size > 1) {
    warnings.push({
      code: "sheet_field_recorded",
      message:
        "Campaigns tab lists more than one bid strategy. The plan keeps the default maximize_clicks; each campaign's strategy is in its notes.",
    });
  }

  const uniqueRanges = new Set(ranges.map((range) => `${range.since}|${range.until}`));
  const dateRange = uniqueRanges.size === 1 ? ranges[0] ?? null : null;
  if (uniqueRanges.size > 1) {
    warnings.push({
      code: "sheet_field_recorded",
      message:
        "Campaigns tab lists more than one start/end. Dates stay on each campaign's notes; the plan date range was left empty.",
    });
  }

  return { biddingStrategy, dateRange };
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
  if (raw.length === 0) return [];
  const rows =
    recordsFromRawRowsWithHeaderScan(raw, ["negativekeyword"]).length > 0
      ? recordsFromRawRowsWithHeaderScan(raw, ["negativekeyword"])
      : recordsFromRawRowsWithHeaderScan(raw, ["keyword"]);
  if (rows.length === 0) {
    warnings.push({
      code: "negatives_header_not_found",
      message:
        "Negative Keywords tab had no recognisable header row " +
        "(expected `Negative Keyword` or `Keyword`). No negatives imported.",
    });
    return [];
  }
  const skeletonByExact = new Map<string, string>();
  const skeletonByPrefix = new Map<string, string>();
  for (const name of campaignNames) {
    skeletonByExact.set(normaliseCampaignKey(name), name);
    const digits = cCodeDigits(name);
    if (digits) skeletonByPrefix.set(digits, name);
  }
  const out: GoogleSearchNegativeDraft[] = [];
  for (const idx of rows) {
    const keyword = cell(idx.negativekeyword ?? idx.keyword);
    if (!keyword) continue;
    const rawMatch = readMatchTypeRaw(idx);
    const matchType = normaliseMatchType(rawMatch);
    if (!matchType) {
      warnings.push({
        code: "unknown_match_type",
        message: `Negative "${keyword}" has unrecognised match type "${cell(rawMatch)}" — skipped.`,
        context: { keyword, raw: cell(rawMatch) || null },
      });
      continue;
    }
    // Real J2 sheet uses a `Campaign / Level` header — headerKey() makes
    // that `campaignlevel`. Older / simpler sheets use `Scope`,
    // `Campaign`, or `Level`. Read all four.
    const scopeRaw = cell(
      idx.scope ?? idx.campaign ?? idx.level ?? idx.campaignlevel,
    );
    const scope = resolveNegativeScope(
      scopeRaw,
      skeletonByExact,
      skeletonByPrefix,
      keyword,
      warnings,
    );

    out.push({
      keyword,
      match_type: matchType,
      reason: cell(idx.reason) || null,
      scope,
    });
  }
  return out;
}

/**
 * Decide whether a `scope` cell on the Negative Keywords tab means
 * "shared / plan-scoped" or "specific campaign", with a graceful
 * fallback to plan-scope when nothing matches (better to share than
 * to silently drop a negative).
 *
 * Plan-scope signals (matched lowercased / whitespace-trimmed):
 *   - empty
 *   - "all", "all campaigns", "all campaign"
 *   - "plan", "shared", "shared list"
 *   - any text that starts with "all"
 *
 * Campaign-scope: exact normalised match against a skeleton campaign
 * name, else a `C\d+` prefix match.
 */
export function resolveNegativeScope(
  scopeRaw: string,
  skeletonByExact: Map<string, string>,
  skeletonByPrefix: Map<string, string>,
  keyword: string,
  warnings: GoogleSearchImportWarning[],
): GoogleSearchNegativeDraft["scope"] {
  const trimmed = scopeRaw.trim();
  const lower = trimmed.toLowerCase();
  if (
    lower === "" ||
    lower === "plan" ||
    lower === "shared" ||
    lower === "shared list" ||
    lower.startsWith("all")
  ) {
    return { kind: "plan" };
  }
  const key = normaliseCampaignKey(trimmed);
  const exact = skeletonByExact.get(key);
  if (exact) return { kind: "campaign", campaign_name: exact };
  const digits = cCodeDigits(trimmed);
  if (digits) {
    const byPrefix = skeletonByPrefix.get(digits);
    if (byPrefix) return { kind: "campaign", campaign_name: byPrefix };
  }
  warnings.push({
    code: "missing_campaign",
    message: `Negative "${keyword}" scoped to unknown campaign "${trimmed}" — added as plan-scoped fallback.`,
    context: { keyword, scope: trimmed },
  });
  return { kind: "plan" };
}
