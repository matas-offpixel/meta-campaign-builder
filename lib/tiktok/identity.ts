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
  identity_type: TikTokIdentityType;
  avatar_url: string | null;
}

interface TikTokIdentityGetRow {
  identity_id?: string;
  display_name?: string;
  identity_name?: string;
  nickname?: string;
  avatar_url?: string;
  identity_type?: string;
}

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

export async function fetchTikTokIdentities(input: {
  advertiserId: string;
  token: string;
  request?: TikTokGet;
}): Promise<TikTokIdentity[]> {
  const request = input.request ?? tiktokGet;
  const byId = new Map<string, TikTokIdentity>();

  const unfiltered = await request<Record<string, unknown>>(
    "/identity/get/",
    { advertiser_id: input.advertiserId },
    input.token,
  );
  logIdentityEnvelope(input.advertiserId, unfiltered);
  ingestIdentityRows(byId, extractIdentityRows(unfiltered), "TT_USER");

  if (byId.size === 0) {
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
        ingestIdentityRows(byId, extractIdentityRows(res), identityType);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `[tiktok/identity] /identity/get/ identity_type=${identityType} advertiser=${input.advertiserId} failed: ${message}`,
        );
      }
    }
  }

  return [...byId.values()].sort((a, b) =>
    a.display_name.localeCompare(b.display_name),
  );
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

function ingestIdentityRows(
  byId: Map<string, TikTokIdentity>,
  rows: TikTokIdentityGetRow[],
  fallbackType: TikTokIdentityType,
): void {
  for (const row of rows) {
    if (!row.identity_id) continue;
    byId.set(row.identity_id, {
      identity_id: row.identity_id,
      display_name:
        row.display_name ??
        row.identity_name ??
        row.nickname ??
        row.identity_id,
      identity_type: isTikTokIdentityType(row.identity_type)
        ? row.identity_type
        : fallbackType,
      avatar_url: row.avatar_url ?? null,
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
  console.error(
    `[tiktok/identity] /identity/get/ unfiltered advertiser=${advertiserId} keys=[${keys.join(",")}] counts={list:${counts.list},identity_list:${counts.identity_list},identities:${counts.identities}}`,
  );
}
