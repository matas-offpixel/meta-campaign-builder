/**
 * GET /api/meta/pages/user
 *
 * Fetches ALL Facebook Pages the logged-in user can manage using their
 * Facebook OAuth provider_token (not the server-side META_ACCESS_TOKEN).
 *
 * The token is passed via the Authorization header from the client, which
 * retrieves it from the Supabase session after Facebook OAuth login.
 *
 * Paginates through /me/accounts until all pages are returned.
 */

import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

const API_VERSION = process.env.META_API_VERSION ?? "v21.0";
const BASE = `https://graph.facebook.com/${API_VERSION}`;

const PAGE_FIELDS = "id,name,fan_count,category,picture{url},instagram_business_account";

interface RawPage {
  id: string;
  name: string;
  fan_count?: number;
  category?: string;
  picture?: { data?: { url?: string } };
  instagram_business_account?: { id: string };
}

interface PageResult {
  id: string;
  name: string;
  fan_count?: number;
  category?: string;
  picture?: { data?: { url?: string } };
  instagram_business_account?: { id: string };
}

export async function GET(req: NextRequest) {
  // Supabase auth check — the user must be logged in
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  // Facebook provider token comes from the client via Authorization header
  const providerToken = req.headers.get("authorization")?.replace("Bearer ", "");

  if (!providerToken) {
    return Response.json(
      {
        error: "No Facebook access token provided. Log in with Facebook to load your pages.",
        code: "NO_PROVIDER_TOKEN",
      },
      { status: 401 },
    );
  }

  try {
    const allPages: PageResult[] = [];
    let url: string | null =
      `${BASE}/me/accounts?fields=${PAGE_FIELDS}&limit=100&access_token=${encodeURIComponent(providerToken)}`;

    while (url) {
      const res = await fetch(url, { cache: "no-store" });

      // Guard against non-JSON responses
      const text = await res.text();
      let json: Record<string, unknown>;
      try {
        json = JSON.parse(text);
      } catch {
        console.error("[/api/meta/pages/user] Non-JSON response from Meta:", text.slice(0, 200));
        return Response.json(
          { error: "Invalid response from Facebook. Token may be expired — try logging in again." },
          { status: 502 },
        );
      }

      if (!res.ok || json.error) {
        const err = (json.error ?? {}) as Record<string, unknown>;
        console.error("[/api/meta/pages/user] Meta API error:", JSON.stringify(err));
        return Response.json(
          {
            error: (err.message as string) ?? "Failed to fetch pages from Facebook",
            code: err.code,
            type: err.type,
          },
          { status: 502 },
        );
      }

      const data = (json.data ?? []) as RawPage[];
      for (const p of data) {
        allPages.push({
          id: p.id,
          name: p.name,
          fan_count: p.fan_count,
          category: p.category ?? undefined,
          picture: p.picture,
          instagram_business_account: p.instagram_business_account,
        });
      }

      // Follow pagination cursor until exhausted
      const paging = json.paging as { next?: string } | undefined;
      url = paging?.next ?? null;
    }

    return Response.json({
      data: allPages,
      count: allPages.length,
    });
  } catch (err) {
    console.error("[/api/meta/pages/user] Unexpected error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to fetch pages" },
      { status: 500 },
    );
  }
}
