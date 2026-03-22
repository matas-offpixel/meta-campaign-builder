/**
 * lib/meta/client.ts
 *
 * Server-only Meta Graph API helper.
 * Import only from Route Handlers or Server Components — never from client
 * components (the access token is a server-side env var).
 */

import type {
  MetaAdAccount,
  MetaApiPage,
  MetaApiPixel,
  MetaInstagramAccount,
  CampaignObjective,
} from "@/lib/types";
import { mapObjectiveToMeta } from "./campaign";
import type { MetaAdSetPayload, CreateAdSetsResult } from "./adset";
import type {
  MetaCreativePayload,
  MetaAdPayload,
} from "./creative";
import type { UploadAssetResult } from "./upload";

// ─── Config ──────────────────────────────────────────────────────────────────

const API_VERSION = process.env.META_API_VERSION ?? "v21.0";
const BASE = `https://graph.facebook.com/${API_VERSION}`;

// ─── Error class ─────────────────────────────────────────────────────────────

export class MetaApiError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
    public readonly type?: string,
    public readonly fbtraceId?: string,
  ) {
    super(message);
    this.name = "MetaApiError";
  }

  /** Serialisable shape for JSON error responses */
  toJSON() {
    return {
      error: this.message,
      code: this.code,
      type: this.type,
      fbtrace_id: this.fbtraceId,
    };
  }
}

// ─── Core fetch helper ───────────────────────────────────────────────────────

interface GraphPagedResponse<T> {
  data: T[];
  paging?: {
    cursors?: { before: string; after: string };
    next?: string;
  };
}

/**
 * Low-level GET request against the Graph API.
 * Throws `MetaApiError` on API-level errors and on missing token.
 * Throws generic `Error` on network failure.
 */
async function graphGet<T>(
  path: string,
  params: Record<string, string> = {},
): Promise<T> {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    throw new MetaApiError(
      "META_ACCESS_TOKEN is not configured. Add it to .env.local.",
    );
  }

  const url = new URL(`${BASE}${path}`);
  url.searchParams.set("access_token", token);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  let response: Response;
  try {
    // cache: "no-store" ensures Route Handlers always fetch fresh data
    response = await fetch(url.toString(), { cache: "no-store" });
  } catch (err) {
    throw new Error(`Network error calling Meta API: ${String(err)}`);
  }

  const json = (await response.json()) as Record<string, unknown>;

  if (!response.ok || json.error) {
    const e = (json.error ?? {}) as Record<string, unknown>;
    throw new MetaApiError(
      (e.message as string) ?? `HTTP ${response.status}`,
      e.code as number | undefined,
      e.type as string | undefined,
      e.fbtrace_id as string | undefined,
    );
  }

  return json as T;
}

// ─── POST helper ─────────────────────────────────────────────────────────────

/**
 * POST request against the Graph API with a JSON body.
 * The access token is appended as a URL query param (safe for server-side use).
 */
async function graphPost<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    throw new MetaApiError(
      "META_ACCESS_TOKEN is not configured. Add it to .env.local.",
    );
  }

  const url = new URL(`${BASE}${path}`);
  url.searchParams.set("access_token", token);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch (err) {
    throw new Error(`Network error calling Meta API: ${String(err)}`);
  }

  const json = (await response.json()) as Record<string, unknown>;

  if (!response.ok || json.error) {
    const e = (json.error ?? {}) as Record<string, unknown>;
    throw new MetaApiError(
      (e.message as string) ?? `HTTP ${response.status}`,
      e.code as number | undefined,
      e.type as string | undefined,
      e.fbtrace_id as string | undefined,
    );
  }

  return json as T;
}

// ─── Public helpers ──────────────────────────────────────────────────────────

/**
 * Fetch all ad accounts accessible to the token owner.
 * Requires: ads_read or ads_management permission.
 *
 * GET /me/adaccounts
 */
export async function fetchAdAccounts(): Promise<MetaAdAccount[]> {
  const res = await graphGet<GraphPagedResponse<MetaAdAccount>>(
    "/me/adaccounts",
    {
      fields: "id,name,account_id,currency,account_status,timezone_name,business",
      limit: "100",
    },
  );
  return res.data;
}

/**
 * Fetch all Facebook Pages managed by the token owner.
 * Requires: pages_show_list permission.
 *
 * GET /me/accounts
 */
export async function fetchPages(): Promise<MetaApiPage[]> {
  const res = await graphGet<GraphPagedResponse<MetaApiPage>>("/me/accounts", {
    fields: "id,name,picture{url},instagram_business_account",
    limit: "100",
  });
  return res.data;
}

/**
 * Fetch all Meta Pixels attached to a given ad account.
 * Requires: ads_read permission.
 *
 * GET /{adAccountId}/adspixels
 *
 * @param adAccountId - e.g. "act_1234567890"
 */
export async function fetchPixels(adAccountId: string): Promise<MetaApiPixel[]> {
  const res = await graphGet<GraphPagedResponse<MetaApiPixel>>(
    `/${adAccountId}/adspixels`,
    {
      fields: "id,name",
      limit: "100",
    },
  );
  return res.data;
}

/**
 * Fetch Instagram Business Accounts linked to all pages the token owner
 * manages. Returns one entry per page that has a linked IG account.
 * Requires: pages_show_list + instagram_basic permissions.
 */
export async function fetchInstagramAccounts(): Promise<
  Array<MetaInstagramAccount & { linkedPageId: string }>
> {
  const pages = await graphGet<GraphPagedResponse<MetaApiPage>>(
    "/me/accounts",
    {
      fields:
        "id,instagram_business_account{id,username,name,profile_picture_url}",
      limit: "100",
    },
  );

  const results: Array<MetaInstagramAccount & { linkedPageId: string }> = [];

  for (const page of pages.data) {
    const igRaw = page.instagram_business_account as
      | (MetaInstagramAccount & { linkedPageId?: string })
      | undefined;

    if (igRaw?.id) {
      results.push({ ...igRaw, linkedPageId: page.id });
    }
  }

  return results;
}

/**
 * Create multiple ad sets under a given ad account, one request per ad set.
 * Failures are isolated — a bad ad set does not abort the rest of the batch.
 * Requires: ads_management permission.
 *
 * POST /{adAccountId}/adsets  (once per ad set, campaign_id in payload)
 */
export async function createMetaAdSets(
  adAccountId: string,
  payloads: MetaAdSetPayload[],
): Promise<CreateAdSetsResult> {
  const created: CreateAdSetsResult["created"] = [];
  const failed: CreateAdSetsResult["failed"] = [];

  for (const payload of payloads) {
    try {
      const { id } = await graphPost<{ id: string }>(
        `/${adAccountId}/adsets`,
        payload as unknown as Record<string, unknown>,
      );
      created.push({ name: payload.name, metaAdSetId: id });
    } catch (err) {
      const message =
        err instanceof MetaApiError
          ? err.message
          : `Unexpected error: ${String(err)}`;
      failed.push({ name: payload.name, error: message });
    }
  }

  return { created, failed };
}

/**
 * Create a single ad creative under the given ad account.
 * Requires: ads_management permission.
 *
 * POST /{adAccountId}/adcreatives
 */
export async function createMetaCreative(
  adAccountId: string,
  payload: MetaCreativePayload,
): Promise<{ id: string }> {
  return graphPost<{ id: string }>(
    `/${adAccountId}/adcreatives`,
    payload as unknown as Record<string, unknown>,
  );
}

/**
 * Create a single ad under the given ad account.
 * Requires: ads_management permission.
 *
 * POST /{adAccountId}/ads
 */
export async function createMetaAd(
  adAccountId: string,
  payload: MetaAdPayload,
): Promise<{ id: string }> {
  return graphPost<{ id: string }>(
    `/${adAccountId}/ads`,
    payload as unknown as Record<string, unknown>,
  );
}

// ─── Asset upload helpers ─────────────────────────────────────────────────────

/**
 * Upload an image file to a Meta ad account's image library.
 * Uses multipart/form-data with field name `images[{filename}]`.
 * Requires: ads_management permission.
 *
 * POST /{adAccountId}/adimages
 */
export async function uploadImageAsset(
  adAccountId: string,
  file: Blob,
  filename: string,
): Promise<Pick<UploadAssetResult, "url" | "hash">> {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    throw new MetaApiError(
      "META_ACCESS_TOKEN is not configured. Add it to .env.local.",
    );
  }

  const formData = new FormData();
  // Meta requires the field name to include the filename: images[filename]
  formData.append(`images[${filename}]`, file, filename);

  const url = new URL(`${BASE}/${adAccountId}/adimages`);
  url.searchParams.set("access_token", token);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: "POST",
      body: formData,
      cache: "no-store",
    });
  } catch (err) {
    throw new Error(`Network error uploading image to Meta: ${String(err)}`);
  }

  const json = (await response.json()) as Record<string, unknown>;

  if (!response.ok || json.error) {
    const e = (json.error ?? {}) as Record<string, unknown>;
    throw new MetaApiError(
      (e.message as string) ?? `HTTP ${response.status}`,
      e.code as number | undefined,
      e.type as string | undefined,
      e.fbtrace_id as string | undefined,
    );
  }

  // Response: { images: { [filename]: { hash, url, width, height } } }
  const images = json.images as Record<string, { hash: string; url: string }>;
  const imageData = Object.values(images)[0];
  if (!imageData) {
    throw new MetaApiError("Meta returned an empty images response");
  }
  return { hash: imageData.hash, url: imageData.url };
}

/**
 * Upload a video file to a Meta ad account's video library.
 * Uses multipart/form-data with field name `video_data`.
 * Requires: ads_management permission.
 *
 * POST /{adAccountId}/advideos
 */
export async function uploadVideoAsset(
  adAccountId: string,
  file: Blob,
  filename: string,
): Promise<Pick<UploadAssetResult, "videoId" | "previewUrl">> {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    throw new MetaApiError(
      "META_ACCESS_TOKEN is not configured. Add it to .env.local.",
    );
  }

  const formData = new FormData();
  formData.append("video_data", file, filename);
  formData.append("title", filename.replace(/\.[^.]+$/, ""));

  const url = new URL(`${BASE}/${adAccountId}/advideos`);
  url.searchParams.set("access_token", token);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: "POST",
      body: formData,
      cache: "no-store",
    });
  } catch (err) {
    throw new Error(`Network error uploading video to Meta: ${String(err)}`);
  }

  const json = (await response.json()) as Record<string, unknown>;

  if (!response.ok || json.error) {
    const e = (json.error ?? {}) as Record<string, unknown>;
    throw new MetaApiError(
      (e.message as string) ?? `HTTP ${response.status}`,
      e.code as number | undefined,
      e.type as string | undefined,
      e.fbtrace_id as string | undefined,
    );
  }

  return {
    videoId: json.video_id as string,
    previewUrl: (json.preview_image_url as string) ?? "",
  };
}

/**
 * Create a new campaign under the given ad account.
 * Always created as PAUSED — never goes live automatically.
 * Requires: ads_management permission.
 *
 * POST /{adAccountId}/campaigns
 */
export async function createMetaCampaign(params: {
  adAccountId: string;
  name: string;
  objective: CampaignObjective;
  status?: "ACTIVE" | "PAUSED";
}): Promise<{ id: string }> {
  const { adAccountId, name, objective, status = "PAUSED" } = params;

  return graphPost<{ id: string }>(`/${adAccountId}/campaigns`, {
    name,
    objective: mapObjectiveToMeta(objective),
    status,
    // Required by Meta's API — empty array for standard event promotion
    special_ad_categories: [],
  });
}
