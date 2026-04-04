"use client";

/**
 * Connect Facebook OAuth for an already signed-in user.
 *
 * Uses signInWithOAuth() (not linkIdentity()) so we pass scopes directly and
 * avoid any scope-injection from Supabase's linkIdentity path.
 *
 * ⚠️  signInWithOAuth creates/replaces a Supabase session. If the Facebook
 *     account's email matches the existing magic-link user, Supabase merges
 *     the identities automatically. If the emails differ, a separate user row
 *     is created. Clear the "Additional scopes" field in the Supabase Dashboard
 *     (Auth → Providers → Facebook) so GoTrue does not inject extra scopes
 *     on top of FB_SCOPES below.
 */

import { createClient } from "@/lib/supabase/client";

/**
 * The exact scope string sent to Facebook.
 * Single source of truth — nothing else in the codebase sets Facebook scopes.
 */
const FB_SCOPES = "pages_show_list ads_management";

export type FacebookConnectOptions = {
  /**
   * Relative path to redirect to after the callback completes (default "/").
   * Appended as `?next=` on the callback URL.
   */
  returnPath?: string;
};

/**
 * Initiates Facebook OAuth via signInWithOAuth and redirects the browser.
 * On success the user lands on /auth/facebook-callback, which exchanges the
 * PKCE code server-side and persists the provider_token.
 */
export async function connectFacebookAccount(options: FacebookConnectOptions = {}): Promise<void> {
  if (typeof window === "undefined") {
    throw new Error("connectFacebookAccount must run in the browser");
  }

  const supabase = createClient();

  const origin       = window.location.origin;
  const baseCallback = `${origin}/auth/facebook-callback`;
  const next         = options.returnPath ?? "/";
  const redirectTo   = `${baseCallback}?next=${encodeURIComponent(next)}`;

  console.info("[connectFacebookAccount] requesting scopes:", FB_SCOPES);
  console.info("[connectFacebookAccount] redirectTo:", redirectTo);

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "facebook",
    options: {
      redirectTo,
      scopes: FB_SCOPES,
      // Do not let the client library open a popup; we want a full redirect.
      skipBrowserRedirect: true,
    },
  });

  if (error) {
    console.error("[connectFacebookAccount] signInWithOAuth error:", error);
    throw error;
  }

  if (!data.url) {
    throw new Error("Facebook OAuth did not return a redirect URL.");
  }

  // ── Debug: inspect the exact URL Supabase/GoTrue produced ────────────────
  try {
    const authUrl   = new URL(data.url);
    const rawScope  = authUrl.searchParams.get("scope") ?? "(not present)";
    const scope     = decodeURIComponent(rawScope);

    console.info("[connectFacebookAccount] final OAuth URL scope:", scope);
    console.info("[connectFacebookAccount] FB_SCOPES constant:   ", FB_SCOPES);

    const unexpected = scope
      .split(/[\s,+]+/)
      .filter((s) => s && !FB_SCOPES.split(" ").includes(s));

    if (unexpected.length > 0) {
      console.warn(
        "[connectFacebookAccount] ⚠ Extra scopes injected by GoTrue (not from this code):",
        unexpected.join(", "),
        "— clear them in Supabase Dashboard → Auth → Providers → Facebook → Additional scopes",
      );
    } else {
      console.info("[connectFacebookAccount] ✓ Scopes match FB_SCOPES exactly — no extras injected");
    }
  } catch {
    console.info("[connectFacebookAccount] OAuth URL (raw, first 300 chars):", data.url.slice(0, 300));
  }

  window.location.assign(data.url);
}
