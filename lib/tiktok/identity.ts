import type { TikTokCampaignDraft } from "../types/tiktok-draft.ts";
import { tiktokGet } from "./client.ts";

export type TikTokIdentityType =
  | "AUTH_CODE"
  | "BC_AUTH_TT"
  | "CUSTOMIZED_USER"
  | "TT_USER";

export const TIKTOK_IDENTITY_TYPES: TikTokIdentityType[] = [
  "AUTH_CODE",
  "BC_AUTH_TT",
  "CUSTOMIZED_USER",
  "TT_USER",
];

export interface TikTokIdentity {
  identity_id: string;
  display_name: string;
  identity_type: TikTokIdentityType | null;
  avatar_url: string | null;
  identity_bc_id: string | null;
}

export interface TikTokIdentityGetRow {
  identity_id?: string;
  display_name?: string;
  identity_name?: string;
  nickname?: string;
  avatar_url?: string;
  identity_type?: string;
  identity_authorized_bc_id?: string;
  identity_bc_id?: string;
  bc_id?: string;
  business_center_id?: string;
}

export const IDENTITY_BC_ID_CANDIDATE_KEYS = [
  "identity_authorized_bc_id",
  "identity_bc_id",
  "bc_id",
  "business_center_id",
] as const;

type TikTokGet = typeof tiktokGet;

const IDENTITY_TYPES: TikTokIdentityType[] = [
  "BC_AUTH_TT",
  "AUTH_CODE",
  "CUSTOMIZED_USER",
  "TT_USER",
];

const IDENTITY_ARRAY_KEYS = ["list", "identity_list", "identities"] as const;

export function isTikTokIdentityType(
  value: string | null | undefined,
): value is TikTokIdentityType {
  return (
    value === "AUTH_CODE" ||
    value === "BC_AUTH_TT" ||
    value === "CUSTOMIZED_USER" ||
    value === "TT_USER"
  );
}

export function extractIdentityBcId(row: TikTokIdentityGetRow): {
  value: string | null;
  key: string | null;
} {
  const record = row as Record<string, unknown>;
  for (const key of IDENTITY_BC_ID_CANDIDATE_KEYS) {
    const raw = record[key];
    if (typeof raw === "string" && raw.trim()) {
      return { value: raw.trim(), key };
    }
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return { value: String(raw), key };
    }
  }
  return { value: null, key: null };
}

export async function fetchTikTokIdentities(input: {
  advertiserId: string;
  token: string;
  request?: TikTokGet;
}): Promise<TikTokIdentity[]> {
  const request = input.request ?? tiktokGet;
  const byId = new Map<string, TikTokIdentity>();
  let unfilteredFailed = false;

  try {
    const unfiltered = await request<Record<string, unknown>>(
      "/identity/get/",
      { advertiser_id: input.advertiserId },
      input.token,
    );
    logIdentityEnvelope(input.advertiserId, unfiltered);
    ingestIdentityRows(byId, extractIdentityRows(unfiltered), null);
  } catch (err) {
    unfilteredFailed = true;
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[tiktok/identity] /identity/get/ unfiltered advertiser=${input.advertiserId} failed: ${message}`,
    );
  }

  const needsLadder =
    unfilteredFailed ||
    byId.size === 0 ||
    [...byId.values()].some((identity) => identity.identity_type == null);

  if (needsLadder) {
    for (const identityType of IDENTITY_TYPES) {
      try {
        const res = await request<Record<string, unknown>>(
          "/identity/get/",
          {
            advertiser_id: input.advertiserId,
            identity_type: identityType,
          },
          input.token,
        );
        logIdentityEnvelope(input.advertiserId, res);
        ingestIdentityRows(byId, extractIdentityRows(res), identityType);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `[tiktok/identity] /identity/get/ identity_type=${identityType} advertiser=${input.advertiserId} failed: ${message}`,
        );
      }
    }
  }

  const missingBc = [...byId.values()].filter(
    (identity) => identity.identity_type === "BC_AUTH_TT" && !identity.identity_bc_id,
  );
  if (missingBc.length > 0) {
    const fallback = await fetchAdvertiserBusinessCenterId({
      advertiserId: input.advertiserId,
      token: input.token,
      request,
    });
    if (fallback) {
      for (const identity of missingBc) {
        identity.identity_bc_id = fallback.bcId;
        console.error(
          `[tiktok/identity] identity=${identity.identity_id} name=${identity.display_name} bc_id=${fallback.bcId} source=${fallback.path}`,
        );
      }
    } else {
      for (const identity of missingBc) {
        console.error(
          `[tiktok/identity] identity=${identity.identity_id} name=${identity.display_name} bc_id=unresolved source=none`,
        );
      }
    }
  }

  return [...byId.values()].sort((a, b) =>
    a.display_name.localeCompare(b.display_name),
  );
}

export async function hydrateDraftIdentityBcId(input: {
  draft: TikTokCampaignDraft;
  token: string;
  request?: TikTokGet;
}): Promise<void> {
  if (input.draft.accountSetup.identityType !== "BC_AUTH_TT") return;
  if (input.draft.accountSetup.identityBcId) return;
  const advertiserId = input.draft.accountSetup.advertiserId;
  if (!advertiserId || !input.draft.accountSetup.identityId) return;
  try {
    const identities = await fetchTikTokIdentities({
      advertiserId,
      token: input.token,
      request: input.request,
    });
    const match = identities.find(
      (identity) => identity.identity_id === input.draft.accountSetup.identityId,
    );
    if (match?.identity_bc_id) {
      input.draft.accountSetup.identityBcId = match.identity_bc_id;
      console.error(
        `[tiktok/identity] hydrate draft=${input.draft.id} identity=${match.identity_id} bc_id=${match.identity_bc_id}`,
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[tiktok/identity] hydrate draft=${input.draft.id} failed: ${message}`,
    );
  }
}

export function extractIdentityRows(res: unknown): TikTokIdentityGetRow[] {
  if (!res || typeof res !== "object") return [];
  const record = res as Record<string, unknown>;
  for (const key of IDENTITY_ARRAY_KEYS) {
    const value = record[key];
    if (Array.isArray(value)) return value as TikTokIdentityGetRow[];
  }
  return [];
}

export async function fetchAdvertiserBusinessCenterId(input: {
  advertiserId: string;
  token: string;
  request?: TikTokGet;
}): Promise<{ bcId: string; path: string } | null> {
  const request = input.request ?? tiktokGet;
  let res: Record<string, unknown>;
  try {
    res = await request<Record<string, unknown>>("/bc/get/", {}, input.token);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[tiktok/identity] /bc/get/ advertiser=${input.advertiserId} failed: ${message}`,
    );
    return null;
  }
  logBcEnvelope("/bc/get/", input.advertiserId, res);
  const bcIds = extractBcIdsFromList(res);
  if (bcIds.length === 1) {
    console.error(
      `[tiktok/identity] /bc/get/ advertiser=${input.advertiserId} source=bc/get bc_id=${bcIds[0]}`,
    );
    return { bcId: bcIds[0]!, path: "bc/get" };
  }
  for (const bcId of bcIds) {
    let advertisers: Record<string, unknown>;
    try {
      advertisers = await request<Record<string, unknown>>(
        "/bc/advertiser/get/",
        { bc_id: bcId },
        input.token,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[tiktok/identity] /bc/advertiser/get/ bc_id=${bcId} advertiser=${input.advertiserId} failed: ${message}`,
      );
      continue;
    }
    logBcEnvelope("/bc/advertiser/get/", input.advertiserId, advertisers);
    if (listContainsAdvertiser(advertisers, input.advertiserId)) {
      console.error(
        `[tiktok/identity] /bc/advertiser/get/ advertiser=${input.advertiserId} source=bc/advertiser/get bc_id=${bcId}`,
      );
      return { bcId, path: "bc/advertiser/get" };
    }
  }
  return null;
}

function ingestIdentityRows(
  byId: Map<string, TikTokIdentity>,
  rows: TikTokIdentityGetRow[],
  fallbackType: TikTokIdentityType | null,
): void {
  for (const row of rows) {
    if (!row.identity_id) continue;
    const rowType = isTikTokIdentityType(row.identity_type)
      ? row.identity_type
      : fallbackType;
    const extracted = extractIdentityBcId(row);
    if (extracted.value) {
      console.error(
        `[tiktok/identity] identity=${row.identity_id} bc_id=${extracted.value} source=row.${extracted.key}`,
      );
    }
    const existing = byId.get(row.identity_id);
    if (existing) {
      if (existing.identity_type == null && rowType != null) {
        existing.identity_type = rowType;
      }
      if (!existing.identity_bc_id && extracted.value) {
        existing.identity_bc_id = extracted.value;
      }
      continue;
    }
    byId.set(row.identity_id, {
      identity_id: row.identity_id,
      display_name:
        row.display_name ??
        row.identity_name ??
        row.nickname ??
        row.identity_id,
      identity_type: rowType,
      avatar_url: row.avatar_url ?? null,
      identity_bc_id: extracted.value,
    });
  }
}

function logIdentityEnvelope(advertiserId: string, res: unknown): void {
  const keys =
    res && typeof res === "object" ? Object.keys(res as object) : [];
  const record =
    res && typeof res === "object" ? (res as Record<string, unknown>) : {};
  const counts = {
    list: Array.isArray(record.list) ? record.list.length : 0,
    identity_list: Array.isArray(record.identity_list)
      ? record.identity_list.length
      : 0,
    identities: Array.isArray(record.identities) ? record.identities.length : 0,
  };
  const rows = extractIdentityRows(res);
  console.error(
    `[tiktok/identity] /identity/get/ advertiser=${advertiserId} keys=[${keys.join(",")}] counts={list:${counts.list},identity_list:${counts.identity_list},identities:${counts.identities}}`,
  );
  rows.forEach((row, index) => {
    const rowKeys =
      row && typeof row === "object" && !Array.isArray(row)
        ? Object.keys(row)
        : [];
    console.error(
      `[tiktok/identity] /identity/get/ advertiser=${advertiserId} row=${index} keys=[${rowKeys.join(",")}]`,
    );
  });
}

function logBcEnvelope(path: string, advertiserId: string, res: unknown): void {
  const keys =
    res && typeof res === "object" ? Object.keys(res as object) : [];
  const rows = extractListRows(res);
  const first = rows[0];
  const rowKeys =
    first && typeof first === "object" && !Array.isArray(first)
      ? Object.keys(first)
      : [];
  console.error(
    `[tiktok/identity] ${path} advertiser=${advertiserId} keys=[${keys.join(",")}] rowCount=${rows.length} rowKeys=[${rowKeys.join(",")}]`,
  );
}

function extractListRows(res: unknown): Record<string, unknown>[] {
  if (!res || typeof res !== "object") return [];
  const record = res as Record<string, unknown>;
  for (const key of ["list", "advertiser_list", "bc_list"] as const) {
    const value = record[key];
    if (Array.isArray(value)) return value as Record<string, unknown>[];
  }
  return [];
}

export function extractBcIdsFromList(res: unknown): string[] {
  const ids: string[] = [];
  for (const row of extractListRows(res)) {
    const fromRow = extractIdentityBcId(row);
    if (fromRow.value) {
      ids.push(fromRow.value);
      continue;
    }
    const info = row.bc_info;
    if (info && typeof info === "object" && !Array.isArray(info)) {
      const fromInfo = extractIdentityBcId(info as TikTokIdentityGetRow);
      if (fromInfo.value) ids.push(fromInfo.value);
    }
  }
  return ids;
}

function sameTikTokId(raw: unknown, expected: string): boolean {
  if (typeof raw === "string") return raw === expected;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return String(raw) === expected;
  }
  return false;
}

function listContainsAdvertiser(
  res: unknown,
  advertiserId: string,
): boolean {
  return extractListRows(res).some((row) =>
    sameTikTokId(row.advertiser_id, advertiserId),
  );
}
