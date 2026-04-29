import { tiktokGet } from "./client.ts";

type TikTokGet = typeof tiktokGet;

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

interface CategoryRow {
  id?: string;
  category_id?: string;
  action_category_id?: string;
  interest_category_id?: string;
  name?: string;
  category_name?: string;
  parent_id?: string;
  parent_category_id?: string;
}

interface ListRow {
  custom_audience_id?: string;
  saved_audience_id?: string;
  audience_id?: string;
  name?: string;
  audience_name?: string;
  status?: string;
}

interface ListResponse<T> {
  list?: T[];
}

export async function fetchTikTokInterestCategories(input: {
  advertiserId: string;
  token: string;
  request?: TikTokGet;
}): Promise<TikTokAudienceCategory[]> {
  const request = input.request ?? tiktokGet;
  const res = await request<ListResponse<CategoryRow>>(
    "/tools/category/",
    { advertiser_id: input.advertiserId },
    input.token,
  );
  return mapCategories(res.list ?? []);
}

export async function fetchTikTokBehaviourCategories(input: {
  advertiserId: string;
  token: string;
  request?: TikTokGet;
}): Promise<TikTokAudienceCategory[]> {
  const request = input.request ?? tiktokGet;
  const res = await request<ListResponse<CategoryRow>>(
    "/tools/action_category/",
    { advertiser_id: input.advertiserId },
    input.token,
  );
  return mapCategories(res.list ?? []);
}

export async function fetchTikTokCustomAudiences(input: {
  advertiserId: string;
  token: string;
  request?: TikTokGet;
}): Promise<TikTokAudienceListItem[]> {
  const request = input.request ?? tiktokGet;
  const res = await request<ListResponse<ListRow>>(
    "/dmp/custom_audience/list/",
    { advertiser_id: input.advertiserId },
    input.token,
  );
  return mapAudienceList(res.list ?? [], "custom_audience_id");
}

export async function fetchTikTokSavedAudiences(input: {
  advertiserId: string;
  token: string;
  request?: TikTokGet;
}): Promise<TikTokAudienceListItem[]> {
  const request = input.request ?? tiktokGet;
  const res = await request<ListResponse<ListRow>>(
    "/dmp/saved_audience/list/",
    { advertiser_id: input.advertiserId },
    input.token,
  );
  return mapAudienceList(res.list ?? [], "saved_audience_id");
}

export async function fetchTikTokAudienceSize(input: {
  advertiserId: string;
  token: string;
  selectedIds: string[];
  request?: TikTokGet;
}): Promise<number | null> {
  if (input.selectedIds.length === 0) return null;
  const request = input.request ?? tiktokGet;
  const res = await request<{ audience_size?: number; size?: number }>(
    "/tool/targeting/audience_size/get/",
    {
      advertiser_id: input.advertiserId,
      interest_category_ids: input.selectedIds,
    },
    input.token,
  );
  const size = res.audience_size ?? res.size;
  return typeof size === "number" && Number.isFinite(size) ? size : null;
}

function mapCategories(rows: CategoryRow[]): TikTokAudienceCategory[] {
  return rows
    .map((row) => {
      const id =
        row.category_id ??
        row.action_category_id ??
        row.interest_category_id ??
        row.id;
      if (!id) return null;
      return {
        id,
        label: row.category_name ?? row.name ?? id,
        parent_id: row.parent_category_id ?? row.parent_id ?? null,
      };
    })
    .filter((row): row is TikTokAudienceCategory => Boolean(row))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function mapAudienceList(
  rows: ListRow[],
  primaryKey: "custom_audience_id" | "saved_audience_id",
): TikTokAudienceListItem[] {
  return rows
    .map((row) => {
      const id = row[primaryKey] ?? row.audience_id;
      if (!id) return null;
      return {
        id,
        label: row.audience_name ?? row.name ?? id,
        status: row.status ?? null,
      };
    })
    .filter((row): row is TikTokAudienceListItem => Boolean(row))
    .sort((a, b) => a.label.localeCompare(b.label));
}
