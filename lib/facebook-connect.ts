"use client";

/**
 * Connect Facebook OAuth for an already signed-in user.
 *
 * Uses signInWithOAuth() with skipBrowserRedirect:true so we receive the
 * Supabase/GoTrue-generated OAuth URL before the browser navigates away.
 * We then strip any scopes GoTrue injects (e.g. "email") that we did not
 * request and that Facebook Login for Business rejects, then redirect to
 * the cleaned URL.
 *
 * The PKCE state/code_challenge params are not touched, so exchangeCodeForSession
 * in the server callback still works normally.
 */

import { createClient } from "@/lib/supabase/client";

/**
 * The exact scopes we want Facebook to grant.
 * Single source of truth — nothing else in the codebase sets Facebook scopes.
 */
export const FB_SCOPES = "pages_show_list ads_management";

/**
 * Scopes GoTrue injects that we must strip before redirecting to Facebook.
 * "email" is hardcoded as a GoTrue default for all OAuth providers.
 * "pages_manage_metadata" was a previous dashboard misconfiguration.
 */
const GOTRUE_INJECTED_SCOPES = new Set(["email", "pages_manage_metadata"]);

export type FacebookConnectOptions = {
  /**
   * Relative path to redirect to after the callback completes (default "/").
   * Appended as `?next=` on the callback URL.
   */
  returnPath?: string;
  /**
   * Called with scope debug info immediately before the browser redirect.
   * Use this to show a temporary UI indicator.
   */
  onScopeDebug?: (info: ScopeDebugInfo) => void;
};

export type ScopeDebugInfo = {
  /** Scopes present in the GoTrue-generated URL (before our strip) */
  goTrueScope: string;
  /** Scopes in the URL we actually send to Facebook (after stripping) */
  finalScope: string;
  /** Scopes that were present in GoTrue URL but removed by us */
  stripped: string[];
  /** The final URL that the browser will navigate to */
  finalUrl: string;
};

/**
 * Initiates Facebook OAuth via signInWithOAuth, strips GoTrue-injected scopes
 * from the URL, then redirects the browser. On success the user lands on
 * /auth/facebook-callback, which exchanges the PKCE code server-side and
 * persists the provider_token.
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

  const requestedScopes = FB_SCOPES;

  console.info("[connectFacebookAccount] ── START ────────────────────────────");
  console.info("[connectFacebookAccount] FB_SCOPES (what we request):", requestedScopes);
  console.info("[connectFacebookAccount] redirectTo:", redirectTo);
  console.info("[connectFacebookAccount] options passed to signInWithOAuth:", {
    provider: "facebook",
    redirectTo,
    scopes: requestedScopes,
    skipBrowserRedirect: true,
  });

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "facebook",
    options: {
      redirectTo,
      scopes: requestedScopes,
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

  // ── Inspect GoTrue-generated URL and strip injected scopes ───────────────
  const authUrl       = new URL(data.url);
  const rawScope      = authUrl.searchParams.get("scope") ?? "";
  const goTrueScope   = decodeURIComponent(rawScope);
  const goTrueTokens  = goTrueScope.split(/[\s,+]+/).filter(Boolean);
  const wantedTokens  = requestedScopes.split(" ");

  const stripped     = goTrueTokens.filter((s) => GOTRUE_INJECTED_SCOPES.has(s));
  const finalTokens  = goTrueTokens.filter((s) => !GOTRUE_INJECTED_SCOPES.has(s));
  const finalScope   = finalTokens.join(" ");

  // Rewrite the scope param in-place (PKCE params are untouched)
  authUrl.searchParams.set("scope", finalScope);
  const finalUrl = authUrl.toString();

  const debugInfo: ScopeDebugInfo = { goTrueScope, finalScope, stripped, finalUrl };

  console.info("[connectFacebookAccount] GoTrue URL scope (raw):", goTrueScope);
  console.info("[connectFacebookAccount] Scopes stripped by us:  ", stripped.length ? stripped.join(", ") : "(none)");
  console.info("[connectFacebookAccount] Final scope → Facebook: ", finalScope);

  const missing = wantedTokens.filter((s) => !finalTokens.includes(s));
  if (missing.length) {
    console.warn("[connectFacebookAccount] ⚠ Some requested scopes are missing from GoTrue URL:", missing.join(", "));
  }
  if (finalScope === requestedScopes) {
    console.info("[connectFacebookAccount] ✓ Final scope matches FB_SCOPES exactly");
  }

  options.onScopeDebug?.(debugInfo);

  console.info("[connectFacebookAccount] Redirecting to cleaned URL…");
  window.location.assign(finalUrl);
}
