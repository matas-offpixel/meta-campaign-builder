import { tiktokGet } from "./client.ts";

export type TikTokIdentityType = "PERSONAL_HUB" | "CUSTOMIZED_USER" | "TT_USER";

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
}

interface TikTokIdentityGetResponse {
  list?: TikTokIdentityGetRow[];
}

type TikTokGet = typeof tiktokGet;

const IDENTITY_TYPES: TikTokIdentityType[] = [
  "PERSONAL_HUB",
  "CUSTOMIZED_USER",
  "TT_USER",
];

export async function fetchTikTokIdentities(input: {
  advertiserId: string;
  token: string;
  request?: TikTokGet;
}): Promise<TikTokIdentity[]> {
  const request = input.request ?? tiktokGet;
  const byId = new Map<string, TikTokIdentity>();

  for (const identityType of IDENTITY_TYPES) {
    const res = await request<TikTokIdentityGetResponse>(
      "/identity/get/",
      {
        advertiser_id: input.advertiserId,
        identity_type: identityType,
      },
      input.token,
    );

    for (const row of res.list ?? []) {
      if (!row.identity_id) continue;
      byId.set(row.identity_id, {
        identity_id: row.identity_id,
        display_name:
          row.display_name ??
          row.identity_name ??
          row.nickname ??
          row.identity_id,
        identity_type: identityType,
        avatar_url: row.avatar_url ?? null,
      });
    }
  }

  return [...byId.values()].sort((a, b) =>
    a.display_name.localeCompare(b.display_name),
  );
}
