"use client";

/**
 * /auth/facebook-callback
 *
 * Client-side OAuth code exchange for Facebook login.
 *
 * Why this page exists instead of reusing /auth/callback (route.ts):
 *   The server-side route handler calls exchangeCodeForSession on the server
 *   and immediately redirects. Supabase does NOT include provider_token in
 *   the session cookie — so after the redirect the browser can never read it.
 *
 *   By handling the exchange HERE with the browser Supabase client:
 *     1. The code is exchanged in-browser
 *     2. session.provider_token is available immediately in the response
 *     3. We save it to localStorage before redirecting away
 *
 * This page is also the `redirectTo` target in signInWithOAuth({ provider: "facebook" }).
 */

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Loader2, AlertCircle } from "lucide-react";

export const FB_TOKEN_STORAGE_KEY = "facebook_provider_token";

function FacebookCallbackInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<"exchanging" | "saving" | "done" | "error">("exchanging");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function handleCallback() {
      const code = searchParams.get("code");
      const errorParam = searchParams.get("error_description") ?? searchParams.get("error");

      // Handle OAuth denial / error from Facebook
      if (!code && errorParam) {
        console.error("[fb-callback] OAuth error:", errorParam);
        if (!cancelled) {
          setStatus("error");
          setErrorMsg(errorParam);
        }
        return;
      }

      if (!code) {
        console.error("[fb-callback] No code in URL — unexpected callback state");
        console.log("[fb-callback] Current URL:", window.location.href);
        if (!cancelled) {
          setStatus("error");
          setErrorMsg("No authorisation code returned from Facebook.");
        }
        return;
      }

      try {
        const supabase = createClient();

        console.log("[fb-callback] Current URL:", window.location.href);
        console.log("[fb-callback] Code present:", !!code);
        console.debug("[fb-callback] Exchanging code for session…");

        const { data, error } = await supabase.auth.exchangeCodeForSession(code);

        console.log("[fb-callback] exchange error:", error);
        console.log("[fb-callback] full data:", data);
        console.log("[fb-callback] session exists:", !!data?.session);
        console.log("[fb-callback] provider:", data?.session?.user?.app_metadata?.provider);
        console.log("[fb-callback] providers:", data?.session?.user?.app_metadata?.providers);
        console.log("[fb-callback] provider_token:", data?.session?.provider_token);
        console.log("[fb-callback] provider_refresh_token:", data?.session?.provider_refresh_token);
        console.log("[fb-callback] user identities:", data?.session?.user?.identities);
        console.log("[fb-callback] user metadata:", data?.session?.user?.user_metadata);

        if (error) {
          console.error("[fb-callback] Code exchange failed:", error.message);
          if (!cancelled) {
            setStatus("error");
            setErrorMsg(`Session exchange failed: ${error.message}`);
          }
          return;
        }

        if (!cancelled) setStatus("saving");

        // ── Persist the provider_token ─────────────────────────────────────
        const providerToken = data?.session?.provider_token ?? null;

        if (providerToken) {
          localStorage.setItem(FB_TOKEN_STORAGE_KEY, providerToken);
          const saved = localStorage.getItem(FB_TOKEN_STORAGE_KEY);

          console.debug("[fb-callback] provider_token saved to localStorage ✓");
          console.log("[fb-callback] saved token exists:", !!saved);
          console.log("[fb-callback] saved token length:", saved?.length ?? 0);
        } else {
          console.warn("[fb-callback] provider_token is null after exchange", {
            provider: data?.session?.user?.app_metadata?.provider,
            providers: data?.session?.user?.app_metadata?.providers,
            identities: data?.session?.user?.identities,
            user_metadata: data?.session?.user?.user_metadata,
          });
        }

        // ── Subscribe to future auth state changes (token refresh) ─────────
        const {
          data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, session) => {
          console.log("[fb-callback] onAuthStateChange event:", _event);
          console.log("[fb-callback] onAuthStateChange provider:", session?.user?.app_metadata?.provider);
          console.log("[fb-callback] onAuthStateChange provider_token:", session?.provider_token);

          const freshToken = session?.provider_token;
          if (freshToken) {
            localStorage.setItem(FB_TOKEN_STORAGE_KEY, freshToken);
            console.debug("[fb-callback] onAuthStateChange — provider_token refreshed in localStorage");
            console.log(
              "[fb-callback] refreshed token length:",
              localStorage.getItem(FB_TOKEN_STORAGE_KEY)?.length ?? 0,
            );
          }
        });

        subscription.unsubscribe();

        if (!cancelled) setStatus("done");

        // ── Redirect to destination ─────────────────────────────────────────
        const next = searchParams.get("next") ?? "/";
        const delay = process.env.NODE_ENV === "development" ? 400 : 0;

        console.log("[fb-callback] Next redirect:", next);

        setTimeout(() => {
          if (!cancelled) router.replace(next);
        }, delay);
      } catch (err) {
        console.error("[fb-callback] Unexpected error:", err);
        if (!cancelled) {
          setStatus("error");
          setErrorMsg(err instanceof Error ? err.message : "Unexpected error during login.");
        }
      }
    }

    handleCallback();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-xs text-center">
        {status === "error" ? (
          <div className="space-y-3">
            <AlertCircle className="mx-auto h-8 w-8 text-destructive" />
            <p className="font-medium text-foreground">Facebook login failed</p>
            <p className="text-sm text-muted-foreground">{errorMsg}</p>
            <a
              href="/login"
              className="inline-block mt-2 text-sm text-primary underline hover:text-primary/80"
            >
              Back to login
            </a>
          </div>
        ) : (
          <div className="space-y-3">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              {status === "exchanging" && "Completing Facebook login…"}
              {status === "saving" && "Saving session…"}
              {status === "done" && "Redirecting…"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function FacebookCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      }
    >
      <FacebookCallbackInner />
    </Suspense>
  );
}