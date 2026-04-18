"use client";

/**
 * /auth/facebook-error
 *
 * Lightweight display page for Facebook OAuth callback failures.
 * The server callback route redirects here with `?reason=` and `?detail=`.
 */

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AlertCircle } from "lucide-react";

const REASON_LABELS: Record<string, string> = {
  oauth_denied:           "Facebook cancelled or denied",
  no_code:                "Callback incomplete",
  exchange_failed:        "Token exchange failed",
  extension_failed:       "Facebook connection failed",
  csrf_mismatch:          "Security check failed",
  config_error:           "Server configuration error",
  missing_redirect_uri_cookie: "OAuth session expired",
  no_user:                "No authenticated user",
  no_provider_token:      "Provider token missing",
  db_write_failed:        "Could not save connection",
};

const REASON_HINTS: Record<string, string> = {
  oauth_denied:
    "You cancelled the Facebook login, or Facebook returned an error. Try connecting again.",
  no_code:
    "The callback URL didn't include an authorisation code. Make sure " +
    "https://<your-domain>/auth/facebook-callback is listed under " +
    "Meta app → Facebook Login → Valid OAuth Redirect URIs.",
  exchange_failed:
    "Facebook rejected the token exchange. Most likely cause: " +
    "FACEBOOK_APP_ID or FACEBOOK_APP_SECRET in your server environment " +
    "does not match the Meta app dashboard (Settings → Basic). " +
    "Check both values and redeploy.",
  extension_failed:
    "Facebook connection failed. Could not obtain a long-lived access token. " +
    "This is almost always caused by FACEBOOK_APP_SECRET not matching the " +
    "value in Meta app → Settings → Basic. " +
    "Check FACEBOOK_APP_SECRET in your Vercel environment variables, " +
    "make sure it exactly matches the App Secret shown in the Meta dashboard, " +
    "then reconnect again.",
  csrf_mismatch:
    "The OAuth state parameter did not match. This can happen if the " +
    "connection attempt was interrupted. Please try again.",
  config_error:
    "FACEBOOK_APP_ID is not set on the server. Add it to your Vercel " +
    "environment variables (from Meta app → Settings → Basic) and redeploy.",
  missing_redirect_uri_cookie:
    "The OAuth session cookie expired before the callback completed. " +
    "Please try connecting again.",
  no_user:
    "No active login session was found. Sign in to the app and then " +
    "try connecting Facebook again.",
  no_provider_token:
    "Facebook connected successfully, but no access token was returned. " +
    "Make sure the Facebook app has the required permissions approved " +
    "(pages_show_list, ads_management, instagram_basic).",
  db_write_failed:
    "The Facebook token could not be saved. Make sure the " +
    "user_facebook_tokens table exists in Supabase " +
    "(run migration 002_user_facebook_tokens.sql).",
};

function FacebookErrorInner() {
  const searchParams = useSearchParams();
  const reason = searchParams.get("reason") ?? "unknown";
  const detail = searchParams.get("detail") ?? "";

  const title  = REASON_LABELS[reason]  ?? "Facebook connection failed";
  const hint   = REASON_HINTS[reason]   ?? "An unexpected error occurred.";

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md space-y-4 text-center">
        <AlertCircle className="mx-auto h-10 w-10 text-destructive" />
        <h1 className="font-heading text-xl tracking-wide">{title}</h1>
        <p className="text-sm text-muted-foreground">{hint}</p>

        {detail && (
          <details className="rounded border border-border bg-muted/40 p-3 text-left">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
              Technical detail
            </summary>
            <p className="mt-2 break-all text-[11px] text-muted-foreground">{detail}</p>
          </details>
        )}

        <a
          href="/"
          className="inline-block rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background
            hover:bg-foreground/90 transition-colors"
        >
          Back to app
        </a>
      </div>
    </div>
  );
}

export default function FacebookErrorPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      }
    >
      <FacebookErrorInner />
    </Suspense>
  );
}
