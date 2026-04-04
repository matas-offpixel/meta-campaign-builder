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
  oauth_denied:       "Facebook cancelled or denied",
  no_code:            "Callback incomplete",
  exchange_failed:    "Session exchange failed",
  no_user:            "No user returned",
  no_provider_token:  "Provider token missing",
  db_write_failed:    "Could not save connection",
};

const REASON_HINTS: Record<string, string> = {
  oauth_denied:
    "You cancelled the Facebook login, or Facebook returned an error. Close this and try connecting again.",
  no_code:
    "The callback URL didn't include an authorisation code. Make sure the redirect URI in your Facebook app settings matches exactly.",
  exchange_failed:
    "Supabase could not exchange the authorisation code for a session. The code may have expired — please try again.",
  no_user:
    "A session was created but no user was returned. This is unexpected — please try again.",
  no_provider_token:
    "Facebook connected successfully, but no provider_token was included. Make sure the Facebook app has pages_show_list and ads_management permissions enabled and approved.",
  db_write_failed:
    "The Facebook token could not be saved. Make sure the user_facebook_tokens table exists in Supabase (run migration 002_user_facebook_tokens.sql).",
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
