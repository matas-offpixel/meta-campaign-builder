"use client";

/**
 * Connect Facebook OAuth for an already signed-in user.
 *
 * Uses signInWithOAuth() with skipBrowserRedirect:true so we receive the full
 * GoTrue-generated OAuth URL before the browser navigates.  We then force the
 * `scope` param to exactly FB_SCOPES, removing anything GoTrue injects (e.g.
 * "email") and ensuring our required scopes are always present even if GoTrue
 * omits them from the URL.
 *
 * PKCE state/code_challenge are not touched; exchangeCodeForSession still works.
 */

import { createClient } from "@/lib/supabase/client";

/**
 * The exact scopes we want Facebook to grant.
 * Single source of truth — nothing else in the codebase sets Facebook scopes.
 */
export const FB_SCOPES = "pages_show_list ads_management";

export type FacebookConnectOptions = {
  returnPath?: string;
  onScopeDebug?: (info: ScopeDebugInfo) => void;
};

export type ScopeDebugInfo = {
  /** Raw `scope` value GoTrue put in the URL (may include injected scopes like "email") */
  goTrueScope: string;
  /** Tokens that were in goTrueScope */
  goTrueTokens: string[];
  /** Tokens after applying our force-set (should equal FB_SCOPES tokens) */
  finalTokens: string[];
  /** Final scope string written back into the URL */
  finalScope: string;
  /** Complete rewritten URL the browser will navigate to */
  finalUrl: string;
};

export async function connectFacebookAccount(options: FacebookConnectOptions = {}): Promise<void> {
  if (typeof window === "undefined") {
    throw new Error("connectFacebookAccount must run in the browser");
  }

  const supabase = createClient();

  const origin       = window.location.origin;
  const baseCallback = `${origin}/auth/facebook-callback`;
  const next         = options.returnPath ?? "/";
  const redirectTo   = `${baseCallback}?next=${encodeURIComponent(next)}`;

  console.info("[connectFacebookAccount] ── START ────────────────────────────");
  console.info("[connectFacebookAccount] FB_SCOPES (desired):", FB_SCOPES);
  console.info("[connectFacebookAccount] redirectTo:", redirectTo);

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "facebook",
    options: {
      redirectTo,
      scopes: FB_SCOPES,
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

  // ── Parse the URL GoTrue produced ────────────────────────────────────────
  const authUrl = new URL(data.url);

  // Log everything present in the URL for diagnosis
  const goTrueRaw    = authUrl.searchParams.get("scope")  ?? "";   // Facebook uses "scope"
  const goTrueRawAlt = authUrl.searchParams.get("scopes") ?? "";   // GoTrue authorize endpoint uses "scopes"
  const goTrueScope  = decodeURIComponent(goTrueRaw  || goTrueRawAlt);
  const goTrueTokens = goTrueScope.split(/[\s,+]+/).filter(Boolean);

  console.info("[connectFacebookAccount] — URL analysis —");
  console.info("  data.url (first 400 chars):", data.url.slice(0, 400));
  console.info("  scope  param (raw):", goTrueRaw   || "(not present)");
  console.info("  scopes param (raw):", goTrueRawAlt || "(not present)");
  console.info("  decoded scope string:      ", goTrueScope || "(empty)");
  console.info("  parsed scope tokens:       ", goTrueTokens);

  // ── Force-set the scope to exactly FB_SCOPES ─────────────────────────────
  //
  // We do NOT rely on GoTrue to include our requested scopes.  We explicitly
  // write the exact scope we want, regardless of what GoTrue put in the URL.
  // This is the only robust approach: filtering is fragile when GoTrue omits
  // our scopes; force-setting guarantees the outcome in all cases.
  //
  const finalTokens = FB_SCOPES.split(" ");
  const finalScope  = finalTokens.join(" ");

  console.info("  finalTokens (force-set):   ", finalTokens);
  console.info("  finalScope  (force-set):   ", finalScope);

  // ── Safety guard ─────────────────────────────────────────────────────────
  if (!finalScope.trim()) {
    throw new Error(
      `[connectFacebookAccount] BUG: final scope is empty. FB_SCOPES constant is "${FB_SCOPES}". ` +
      `This should never happen — check FB_SCOPES definition.`
    );
  }

  // ── Rewrite the scope param ───────────────────────────────────────────────
  authUrl.searchParams.set("scope", finalScope);
  // Remove the 'scopes' param if GoTrue added it (prevent duplicate/confusion)
  authUrl.searchParams.delete("scopes");

  const finalUrl = authUrl.toString();

  console.info("[connectFacebookAccount] — rewrite result —");
  console.info("  scope param set to:", finalScope);
  console.info("  final URL (first 400 chars):", finalUrl.slice(0, 400));

  if (finalScope === FB_SCOPES) {
    console.info("[connectFacebookAccount] ✓ scope is exactly FB_SCOPES");
  } else {
    console.warn("[connectFacebookAccount] ⚠ finalScope !== FB_SCOPES — check FB_SCOPES constant");
  }

  // ── Notify UI debug panel ─────────────────────────────────────────────────
  const debugInfo: ScopeDebugInfo = {
    goTrueScope,
    goTrueTokens,
    finalTokens,
    finalScope,
    finalUrl,
  };
  options.onScopeDebug?.(debugInfo);

  console.info("[connectFacebookAccount] ── REDIRECT ────────────────────────");
  window.location.assign(finalUrl);
}
