import { tiktokGet } from "./client.ts";

type TikTokGet = typeof tiktokGet;

export type TikTokInterestKeywordMode = "FUZZ_MATCH" | "SEMANTIC_RECOMMEND";
export type TikTokInterestAudienceType =
  | "GENERAL_INTEREST"
  | "PURCHASE_INTENTION";
export type TikTokHashtagOperator = "AND" | "OR";
export type TikTokTargetingItemKind = "category" | "keyword";

export interface TikTokAudienceCategory {
  id: string;
  label: string;
  parent_id: string | null;
}

export interface TikTokAudienceListItem {
  id: string;
  label: string;
  status: string | null;
}

export interface TikTokAudienceRecommendItem {
  id: string;
  name: string;
  kind: TikTokTargetingItemKind;
  audienceSize: number | null;
}

export interface TikTokRegionOption {
  id: string;
  name: string;
  countryCode: string | null;
}

export interface TikTokLanguageOption {
  id: string;
  name: string;
}

const INTEREST_CATEGORY_KEYS = [
  "list",
  "interest_categories",
  "category_list",
  "categories",
] as const;

const ACTION_CATEGORY_KEYS = [
  "list",
  "action_categories",
  "category_list",
  "categories",
] as const;

const AUDIENCE_LIST_KEYS = [
  "saved_audiences",
  "list",
  "audiences",
  "custom_audiences",
] as const;

const INTEREST_KEYWORD_KEYS = [
  "recommended_keywords",
  "list",
  "keywords",
  "interest_keywords",
  "recommend_list",
] as const;

const HASHTAG_KEYS = [
  "list",
  "hashtags",
  "keyword_list",
  "keywords",
] as const;

const REGION_KEYS = [
  "region_list",
  "list",
  "regions",
  "location_list",
  "locations",
] as const;

const LANGUAGE_KEYS = ["list", "languages", "language_list"] as const;

export function extractAudienceRows(
  res: unknown,
  keys: readonly string[],
): Record<string, unknown>[] {
  if (!res || typeof res !== "object") return [];
  const record = res as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value as Record<string, unknown>[];
  }
  return [];
}

export function logAudienceEnvelope(
  path: string,
  advertiserId: string,
  res: unknown,
  keys: readonly string[],
  mapped = 0,
): void {
  const record =
    res && typeof res === "object" ? (res as Record<string, unknown>) : {};
  const objectKeys =
    res && typeof res === "object" ? Object.keys(res as object) : [];
  const counts = keys
    .map((key) => `${key}:${Array.isArray(record[key]) ? record[key].length : 0}`)
    .join(",");
  const firstRow = extractAudienceRows(res, keys)[0];
  const rowKeys =
    firstRow && typeof firstRow === "object" && !Array.isArray(firstRow)
      ? Object.keys(firstRow)
      : [];
  console.error(
    `[tiktok/audience] ${path} advertiser=${advertiserId} keys=[${objectKeys.join(",")}] counts={${counts}} mapped=${mapped} rowKeys=[${rowKeys.join(",")}]`,
  );
}

export async function fetchTikTokInterestCategories(input: {
  advertiserId: string;
  token: string;
  request?: TikTokGet;
}): Promise<TikTokAudienceCategory[]> {
  const request = input.request ?? tiktokGet;
  const path = "/tool/interest_category/";
  const res = await request<Record<string, unknown>>(
    path,
    {
      advertiser_id: input.advertiserId,
      version: 2,
      language: "en",
    },
    input.token,
  );
  const mapped = mapCategories(extractAudienceRows(res, INTEREST_CATEGORY_KEYS));
  logAudienceEnvelope(path, input.advertiserId, res, INTEREST_CATEGORY_KEYS, mapped.length);
  return mapped;
}

export async function fetchTikTokBehaviourCategories(input: {
  advertiserId: string;
  token: string;
  request?: TikTokGet;
}): Promise<TikTokAudienceCategory[]> {
  const request = input.request ?? tiktokGet;
  const path = "/tool/action_category/";
  const res = await request<Record<string, unknown>>(
    path,
    { advertiser_id: input.advertiserId },
    input.token,
  );
  const mapped = mapCategories(extractAudienceRows(res, ACTION_CATEGORY_KEYS));
  logAudienceEnvelope(path, input.advertiserId, res, ACTION_CATEGORY_KEYS, mapped.length);
  return mapped;
}

export async function fetchTikTokCustomAudiences(input: {
  advertiserId: string;
  token: string;
  request?: TikTokGet;
}): Promise<TikTokAudienceListItem[]> {
  const request = input.request ?? tiktokGet;
  const path = "/dmp/custom_audience/list/";
  const res = await request<Record<string, unknown>>(
    path,
    { advertiser_id: input.advertiserId },
    input.token,
  );
  const mapped = mapAudienceList(
    extractAudienceRows(res, AUDIENCE_LIST_KEYS),
    "custom_audience_id",
  );
  logAudienceEnvelope(path, input.advertiserId, res, AUDIENCE_LIST_KEYS, mapped.length);
  return mapped;
}

export async function fetchTikTokSavedAudiences(input: {
  advertiserId: string;
  token: string;
  request?: TikTokGet;
}): Promise<TikTokAudienceListItem[]> {
  const request = input.request ?? tiktokGet;
  const path = "/dmp/saved_audience/list/";
  const res = await request<Record<string, unknown>>(
    path,
    { advertiser_id: input.advertiserId },
    input.token,
  );
  const mapped = mapAudienceList(
    extractAudienceRows(res, AUDIENCE_LIST_KEYS),
    "saved_audience_id",
  );
  logAudienceEnvelope(path, input.advertiserId, res, AUDIENCE_LIST_KEYS, mapped.length);
  return mapped;
}

export async function fetchTikTokInterestKeywordRecommendations(input: {
  advertiserId: string;
  token: string;
  keyword: string;
  mode?: TikTokInterestKeywordMode;
  audienceType?: TikTokInterestAudienceType;
  limit?: number;
  request?: TikTokGet;
}): Promise<TikTokAudienceRecommendItem[]> {
  const keyword = input.keyword.trim();
  if (!keyword) return [];
  const request = input.request ?? tiktokGet;
  const path = "/tool/interest_keyword/recommend/";
  const limit = Math.max(1, Math.min(50, input.limit ?? 50));
  const res = await request<Record<string, unknown>>(
    path,
    {
      advertiser_id: input.advertiserId,
      keyword,
      language: "en",
      limit,
      mode: input.mode ?? "FUZZ_MATCH",
      audience_type: input.audienceType ?? "GENERAL_INTEREST",
    },
    input.token,
  );
  const mapped = mapRecommendItems(
    extractAudienceRows(res, INTEREST_KEYWORD_KEYS),
    "keyword",
  );
  logAudienceEnvelope(path, input.advertiserId, res, INTEREST_KEYWORD_KEYS, mapped.length);
  return mapped;
}

export async function fetchTikTokHashtagRecommendations(input: {
  advertiserId: string;
  token: string;
  keywords: string[];
  operator?: TikTokHashtagOperator;
  request?: TikTokGet;
}): Promise<TikTokAudienceRecommendItem[]> {
  const keywords = input.keywords
    .map((keyword) => keyword.trim())
    .filter(Boolean)
    .slice(0, 10);
  if (keywords.length === 0) return [];
  const request = input.request ?? tiktokGet;
  const path = "/tool/hashtag/recommend/";
  const res = await request<Record<string, unknown>>(
    path,
    {
      advertiser_id: input.advertiserId,
      keywords,
      operator: input.operator ?? "AND",
    },
    input.token,
  );
  const mapped = mapRecommendItems(extractAudienceRows(res, HASHTAG_KEYS), "keyword");
  logAudienceEnvelope(path, input.advertiserId, res, HASHTAG_KEYS, mapped.length);
  return mapped;
}

export async function fetchTikTokHashtagsByIds(input: {
  advertiserId: string;
  token: string;
  keywordIds: string[];
  request?: TikTokGet;
}): Promise<TikTokAudienceRecommendItem[]> {
  const keywordIds = input.keywordIds.filter(Boolean);
  if (keywordIds.length === 0) return [];
  const request = input.request ?? tiktokGet;
  const path = "/tool/hashtag/get/";
  const res = await request<Record<string, unknown>>(
    path,
    {
      advertiser_id: input.advertiserId,
      keyword_ids: keywordIds,
    },
    input.token,
  );
  const mapped = mapRecommendItems(extractAudienceRows(res, HASHTAG_KEYS), "keyword");
  logAudienceEnvelope(path, input.advertiserId, res, HASHTAG_KEYS, mapped.length);
  return mapped;
}

export async function fetchTikTokRegions(input: {
  advertiserId: string;
  token: string;
  language?: string;
  request?: TikTokGet;
}): Promise<TikTokRegionOption[]> {
  const request = input.request ?? tiktokGet;
  const path = "/search/region/";
  const res = await request<Record<string, unknown>>(
    path,
    {
      advertiser_id: input.advertiserId,
      language: input.language ?? "en",
    },
    input.token,
  );
  const mapped = extractAudienceRows(res, REGION_KEYS)
    .map((row) => {
      const id = firstString(
        row,
        "location_id",
        "region_id",
        "id",
        "country_id",
      );
      if (!id) return null;
      return {
        id,
        name:
          firstString(row, "name", "region_name", "location_name", "country") ??
          id,
        countryCode: firstString(row, "country_code", "region_code", "code"),
      };
    })
    .filter((row): row is TikTokRegionOption => Boolean(row))
    .sort((a, b) => a.name.localeCompare(b.name));
  logAudienceEnvelope(path, input.advertiserId, res, REGION_KEYS, mapped.length);
  return mapped;
}

export async function fetchTikTokLanguages(input: {
  advertiserId: string;
  token: string;
  request?: TikTokGet;
}): Promise<TikTokLanguageOption[]> {
  const request = input.request ?? tiktokGet;
  const path = "/tool/language/";
  const res = await request<Record<string, unknown>>(
    path,
    { advertiser_id: input.advertiserId },
    input.token,
  );
  const mapped = extractAudienceRows(res, LANGUAGE_KEYS)
    .map((row) => {
      const id = firstString(
        row,
        "language_code",
        "code",
        "id",
        "language_id",
      );
      if (!id) return null;
      return {
        id,
        name: firstString(row, "name", "language_name", "language") ?? id,
      };
    })
    .filter((row): row is TikTokLanguageOption => Boolean(row))
    .sort((a, b) => a.name.localeCompare(b.name));
  logAudienceEnvelope(path, input.advertiserId, res, LANGUAGE_KEYS, mapped.length);
  return mapped;
}

function mapCategories(rows: Record<string, unknown>[]): TikTokAudienceCategory[] {
  const parentByChild = parentIdsFromSubCategories(rows);
  return rows
    .map((row) => {
      const id = firstString(
        row,
        "category_id",
        "action_category_id",
        "interest_category_id",
        "id",
      );
      if (!id) return null;
      return {
        id,
        // Official interest row uses interest_category_name, not category_name:
        // https://ads.tiktok.com/marketing_api/docs?id=1737174348712961
        label:
          firstString(
            row,
            "interest_category_name",
            "action_category_name",
            "category_name",
            "name",
          ) ?? id,
        parent_id:
          firstString(row, "parent_category_id", "parent_id") ??
          parentByChild.get(id) ??
          null,
      };
    })
    .filter((row): row is TikTokAudienceCategory => Boolean(row))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function parentIdsFromSubCategories(
  rows: Record<string, unknown>[],
): Map<string, string> {
  const parentByChild = new Map<string, string>();
  for (const row of rows) {
    const id = firstString(
      row,
      "category_id",
      "action_category_id",
      "interest_category_id",
      "id",
    );
    const subs = row.sub_category_ids;
    if (!id || !Array.isArray(subs)) continue;
    for (const child of subs) {
      if (typeof child === "string" || typeof child === "number") {
        const childId = String(child).trim();
        if (childId) parentByChild.set(childId, id);
      }
    }
  }
  return parentByChild;
}

function mapAudienceList(
  rows: Record<string, unknown>[],
  primaryKey: "custom_audience_id" | "saved_audience_id",
): TikTokAudienceListItem[] {
  return rows
    .map((row) => {
      const id = firstString(row, primaryKey, "audience_id", "id");
      if (!id) return null;
      return {
        id,
        label: firstString(row, "audience_name", "name") ?? id,
        status: firstString(row, "status"),
      };
    })
    .filter((row): row is TikTokAudienceListItem => Boolean(row))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function mapRecommendItems(
  rows: Record<string, unknown>[],
  kind: TikTokTargetingItemKind,
): TikTokAudienceRecommendItem[] {
  return rows
    .map((row) => {
      const id = firstString(
        row,
        "keyword_id",
        "hashtag_id",
        "interest_keyword_id",
        "id",
      );
      if (!id) return null;
      return {
        id,
        name:
          firstString(row, "keyword", "hashtag", "name", "keyword_name") ?? id,
        kind,
        audienceSize: firstNumber(
          row,
          "audience_size",
          "number_of_users",
          "uv",
        ),
      };
    })
    .filter((row): row is TikTokAudienceRecommendItem => Boolean(row));
}

function firstString(
  row: Record<string, unknown>,
  ...keys: string[]
): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 0) return trimmed;
    }
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function firstNumber(
  row: Record<string, unknown>,
  ...keys: string[]
): number | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}
