"use client";

/**
 * Start Facebook OAuth as a *linked identity* for an already signed-in user.
 * Must not be used on the public login page — only after magic-link auth.
 */

import { createClient } from "@/lib/supabase/client";

const FB_SCOPES = "pages_show_list pages_manage_metadata ads_management";

export type FacebookConnectOptions = {
  /**
   * Where to send the user after OAuth completes (default `/auth/facebook-callback`).
   * Query `next` can be appended for post-connect redirect, e.g. `/campaign/abc?step=0`
   */
  returnPath?: string;
};

/**
 * Opens Facebook OAuth to link the Facebook account to the current Supabase user.
 * Redirects the browser away; on success the user lands on `/auth/facebook-callback`.
 */
export async function connectFacebookAccount(options: FacebookConnectOptions = {}): Promise<void> {
  if (typeof window === "undefined") {
    throw new Error("connectFacebookAccount must run in the browser");
  }

  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("You must be signed in before connecting Facebook.");
  }

  const origin = window.location.origin;
  const baseCallback = `${origin}/auth/facebook-callback`;
  const next = options.returnPath ?? "/";
  const redirectTo = `${baseCallback}?next=${encodeURIComponent(next)}`;

  const { data, error } = await supabase.auth.linkIdentity({
    provider: "facebook",
    options: {
      redirectTo,
      scopes: FB_SCOPES,
    },
  });

  if (error) {
    console.error("[connectFacebookAccount] linkIdentity error:", error);
    throw error;
  }

  if (data.url) {
    window.location.assign(data.url);
    return;
  }

  throw new Error("Facebook connection did not return a redirect URL.");
}
