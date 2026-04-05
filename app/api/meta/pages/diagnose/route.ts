/**
 * POST /api/meta/pages/diagnose
 *
 * Deep per-page Instagram-connection diagnostic.
 * For each requested page ID, fetches BOTH IG link fields and returns the raw
 * Graph API response alongside a human-readable diagnosis.
 *
 * This endpoint is intended for debugging why a page shows "No linked Instagram"
 * even though the Facebook Page is visibly connected to Instagram in Meta UI.
 *
 * Fields checked per page:
 *   - instagram_business_account  (standard BM / "Switch to professional" link)
 *   - connected_instagram_account (personal/creator link via Page Settings)
 *
 * Two token strategies are attempted for each page:
 *   1. User token  — the Facebook OAuth provider_token (passed via Authorization header)
 *   2. Page token  — if provided in the request body (optional)
 *
 * Response: { diagnostics: PageDiagnosticResult[] }
 */

import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

const API_VERSION = process.env.META_API_VERSION ?? "v21.0";
const BASE = `https://graph.facebook.com/${API_VERSION}`;

const IG_FIELDS =
  "id,name,category," +
  "instagram_business_account{id,username,name,followers_count,profile_picture_url}," +
  "connected_instagram_account{id,username,name,followers_count,profile_picture_url}";

interface RawIgField {
  id?: string;
  username?: string;
  name?: string;
  followers_count?: number;
  profile_picture_url?: string;
}

interface RawPageDiagResponse {
  id?: string;
  name?: string;
  category?: string;
  instagram_business_account?: RawIgField;
  connected_instagram_account?: RawIgField;
  error?: { message?: string; code?: number; type?: string };
}

export interface IgAccountInfo {
  id: string;
  username?: string | null;
  name?: string | null;
  followers_count?: number | null;
}

export type IgLinkStatus =
  | "linked_business_account"      // instagram_business_account present
  | "linked_connected_account"     // only connected_instagram_account present
  | "linked_both"                  // both fields present (unusual)
  | "not_linked"                   // neither field returned data
  | "api_error";                   // Graph API returned an error for this page

export interface PageDiagnosticResult {
  pageId: string;
  pageName: string | null;
  pageCategory: string | null;
  tokenType: "user_token" | "page_token";
  /** Raw JSON returned by the Graph API for this page */
  rawResponse: Record<string, unknown>;
  /** Parsed value of instagram_business_account field */
  instagramBusinessAccount: IgAccountInfo | null;
  /** Parsed value of connected_instagram_account field */
  connectedInstagramAccount: IgAccountInfo | null;
  /** The IG account ID our system will use (business first, then connected) */
  resolvedIgId: string | null;
  resolvedIgSource: "instagram_business_account" | "connected_instagram_account" | null;
  status: IgLinkStatus;
  /** Human-readable explanation */
  diagnosis: string;
  /** If we also tried the page token, its result is nested here */
  pageTokenResult?: Omit<PageDiagnosticResult, "pageId" | "pageName" | "pageTokenResult">;
  /** Graph API error if the call failed */
  apiError?: string;
}

function buildDiagnosis(
  igBusiness: IgAccountInfo | null,
  igConnected: IgAccountInfo | null,
  apiError?: string,
): { status: IgLinkStatus; diagnosis: string } {
  if (apiError) {
    return {
      status: "api_error",
      diagnosis: `Graph API error: ${apiError}. This may indicate a token scope issue or invalid page ID.`,
    };
  }
  if (igBusiness && igConnected) {
    return {
      status: "linked_both",
      diagnosis:
        `Both instagram_business_account (id=${igBusiness.id}) and` +
        ` connected_instagram_account (id=${igConnected.id}) are present.` +
        ` Using instagram_business_account as primary.`,
    };
  }
  if (igBusiness) {
    return {
      status: "linked_business_account",
      diagnosis:
        `instagram_business_account is present (id=${igBusiness.id}).` +
        ` This page's IG is visible to the current token and will be used for IG source audiences.`,
    };
  }
  if (igConnected) {
    return {
      status: "linked_connected_account",
      diagnosis:
        `instagram_business_account is null, but connected_instagram_account is present` +
        ` (id=${igConnected.id}).` +
        ` Instagram is connected via "Page Settings → Connected account" rather than via` +
        ` Business Manager. Our system now uses this field as a fallback.`,
    };
  }
  return {
    status: "not_linked",
    diagnosis:
      `Both instagram_business_account and connected_instagram_account are null.` +
      ` Possible causes:` +
      ` (1) The page has no Instagram connected at all.` +
      ` (2) The current access token lacks the instagram_basic or ads_management scope` +
      ` needed to read IG connection fields.` +
      ` (3) The page is a personal profile rather than a Facebook Page.` +
      ` (4) The token belongs to a user who is not an admin of this page.` +
      ` Check the rawResponse for additional clues.`,
  };
}

async function fetchPageDiagnostic(
  pageId: string,
  token: string,
  tokenType: "user_token" | "page_token",
): Promise<PageDiagnosticResult> {
  const url = new URL(`${BASE}/${pageId}`);
  url.searchParams.set("fields", IG_FIELDS);
  url.searchParams.set("access_token", token);

  let raw: RawPageDiagResponse = {};
  let apiError: string | undefined;

  try {
    const res = await fetch(url.toString(), { cache: "no-store" });
    const text = await res.text();
    try {
      raw = JSON.parse(text) as RawPageDiagResponse;
    } catch {
      apiError = `Non-JSON response: ${text.slice(0, 200)}`;
    }
    if (raw.error) {
      apiError = `(#${raw.error.code ?? "?"}) ${raw.error.message ?? "Unknown error"} [${raw.error.type ?? ""}]`;
    }
  } catch (e) {
    apiError = `Network error: ${String(e)}`;
  }

  const igBusiness: IgAccountInfo | null =
    raw.instagram_business_account?.id
      ? {
          id: raw.instagram_business_account.id,
          username: raw.instagram_business_account.username ?? null,
          name: raw.instagram_business_account.name ?? null,
          followers_count: raw.instagram_business_account.followers_count ?? null,
        }
      : null;

  const igConnected: IgAccountInfo | null =
    raw.connected_instagram_account?.id
      ? {
          id: raw.connected_instagram_account.id,
          username: raw.connected_instagram_account.username ?? null,
          name: raw.connected_instagram_account.name ?? null,
          followers_count: raw.connected_instagram_account.followers_count ?? null,
        }
      : null;

  const resolvedIg = igBusiness ?? igConnected ?? null;
  const resolvedIgSource: PageDiagnosticResult["resolvedIgSource"] =
    igBusiness ? "instagram_business_account" :
    igConnected ? "connected_instagram_account" :
    null;

  const { status, diagnosis } = buildDiagnosis(igBusiness, igConnected, apiError);

  // Log server-side for debugging
  console.info(
    `[pages/diagnose] page ${pageId} | token=${tokenType} |` +
    ` ig_business=${igBusiness?.id ?? "null"} |` +
    ` ig_connected=${igConnected?.id ?? "null"} |` +
    ` status=${status}`,
  );
  if (status === "not_linked" || status === "api_error") {
    console.warn(`[pages/diagnose] page ${pageId} raw response:`, JSON.stringify(raw, null, 2));
  }

  return {
    pageId,
    pageName: raw.name ?? null,
    pageCategory: raw.category ?? null,
    tokenType,
    rawResponse: raw as Record<string, unknown>,
    instagramBusinessAccount: igBusiness,
    connectedInstagramAccount: igConnected,
    resolvedIgId: resolvedIg?.id ?? null,
    resolvedIgSource,
    status,
    diagnosis,
    ...(apiError ? { apiError } : {}),
  };
}

export async function POST(req: NextRequest): Promise<Response> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorised" }, { status: 401 });

  const userToken = req.headers.get("authorization")?.replace("Bearer ", "").trim();
  if (!userToken) {
    return Response.json({ error: "No Facebook access token provided." }, { status: 401 });
  }

  let body: { pageIds?: unknown; pageTokens?: Record<string, string> };
  try {
    body = (await req.json()) as { pageIds?: unknown; pageTokens?: Record<string, string> };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body.pageIds) || body.pageIds.length === 0) {
    return Response.json({ error: "pageIds must be a non-empty array" }, { status: 400 });
  }

  const pageIds = (body.pageIds as unknown[]).slice(0, 20).map(String);
  const pageTokens: Record<string, string> = body.pageTokens ?? {};

  console.info(
    `[pages/diagnose] running diagnostic for ${pageIds.length} pages` +
    ` | page tokens provided: ${Object.keys(pageTokens).length}`,
  );

  const diagnostics = await Promise.all(
    pageIds.map(async (pageId) => {
      // Primary: user token diagnostic
      const primary = await fetchPageDiagnostic(pageId, userToken, "user_token");

      // Secondary (optional): page-level token if provided — shows whether
      // the page token resolves a different IG account.
      let pageTokenResult: PageDiagnosticResult["pageTokenResult"];
      const pageToken = pageTokens[pageId];
      if (pageToken && pageToken !== userToken) {
        const ptDiag = await fetchPageDiagnostic(pageId, pageToken, "page_token");
        // Only include if the page token gave a different result
        if (ptDiag.status !== primary.status || ptDiag.resolvedIgId !== primary.resolvedIgId) {
          const { pageId: _pid, pageName: _pn, pageTokenResult: _ptr, ...rest } = ptDiag;
          pageTokenResult = rest;
        }
      }

      return { ...primary, ...(pageTokenResult ? { pageTokenResult } : {}) };
    }),
  );

  return Response.json({ diagnostics });
}
