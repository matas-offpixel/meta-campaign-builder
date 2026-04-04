"use client";

/**
 * /auth/facebook-callback
 *
 * OAuth return URL for **linking** Facebook to an existing Supabase user
 * (`linkIdentity`) or legacy `signInWithOAuth` flows.
 *
 * Handles PKCE code exchange in the **browser** so `provider_token` is present,
 * then persists to localStorage (user-scoped JSON) and POST /api/auth/facebook-token.
 */

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Loader2, AlertCircle } from "lucide-react";
import {
  serializeStoredFacebookToken,
  FB_TOKEN_STORAGE_KEY,
} from "@/lib/facebook-token-storage";

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

      if (!code && errorParam) {
        console.error("[fb-callback] OAuth error:", errorParam);
        if (!cancelled) {
          setStatus("error");
          setErrorMsg(errorParam);
        }
        return;
      }

      if (!code) {
        console.error("[fb-callback] No code in URL");
        if (!cancelled) {
          setStatus("error");
          setErrorMsg("No authorisation code returned from Facebook.");
        }
        return;
      }

      try {
        const supabase = createClient();
        console.debug("[fb-callback] Exchanging code for session…");

        const { data, error } = await supabase.auth.exchangeCodeForSession(code);

        console.log("[fb-callback] session exists:", !!data?.session);
        console.log("[fb-callback] provider_token exists:", !!data?.session?.provider_token);
        console.log("[fb-callback] user id:", data?.session?.user?.id);

        if (error) {
          console.error("[fb-callback] exchangeCodeForSession:", error.message);
          if (!cancelled) {
            setStatus("error");
            setErrorMsg(`Session exchange failed: ${error.message}`);
          }
          return;
        }

        const session = data.session;
        const userId = session?.user?.id;
        const providerToken = session?.provider_token ?? null;

        if (!cancelled) setStatus("saving");

        if (userId && providerToken) {
          localStorage.setItem(
            FB_TOKEN_STORAGE_KEY,
            serializeStoredFacebookToken({ userId, token: providerToken }),
          );
          console.log("[fb-callback] provider_token saved to localStorage (user-scoped) ✓");

          try {
            const res = await fetch("/api/auth/facebook-token", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ providerToken }),
            });
            if (!res.ok) {
              const j = (await res.json()) as { error?: string };
              console.warn("[fb-callback] Could not persist token to Supabase:", j.error ?? res.status);
            } else {
              console.log("[fb-callback] provider_token persisted to Supabase ✓");
            }
          } catch (e) {
            console.warn("[fb-callback] POST /api/auth/facebook-token failed:", e);
          }
        } else {
          console.warn("[fb-callback] Missing userId or provider_token after exchange", {
            userId: !!userId,
            providerToken: !!providerToken,
          });
        }

        const {
          data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, sess) => {
          const t = sess?.provider_token;
          const uid = sess?.user?.id;
          if (t && uid) {
            localStorage.setItem(
              FB_TOKEN_STORAGE_KEY,
              serializeStoredFacebookToken({ userId: uid, token: t }),
            );
            fetch("/api/auth/facebook-token", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ providerToken: t }),
            }).catch(() => {});
          }
        });
        subscription.unsubscribe();

        if (!cancelled) setStatus("done");

        const next = searchParams.get("next") ?? "/";
        const delay = process.env.NODE_ENV === "development" ? 400 : 0;
        setTimeout(() => {
          if (!cancelled) router.replace(next);
        }, delay);
      } catch (err) {
        console.error("[fb-callback] Unexpected error:", err);
        if (!cancelled) {
          setStatus("error");
          setErrorMsg(err instanceof Error ? err.message : "Unexpected error.");
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
            <p className="font-medium text-foreground">Facebook connection failed</p>
            <p className="text-sm text-muted-foreground">{errorMsg}</p>
            <a
              href="/"
              className="inline-block mt-2 text-sm text-primary underline hover:text-primary/80"
            >
              Back to app
            </a>
          </div>
        ) : (
          <div className="space-y-3">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              {status === "exchanging" && "Connecting Facebook…"}
              {status === "saving" && "Saving connection…"}
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
