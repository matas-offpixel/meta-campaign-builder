"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CheckCircle2, KeyRound, Loader2 } from "lucide-react";

type Status =
  | "checking"
  | "ready"
  | "no-session"
  | "saving"
  | "saved"
  | "error";

/**
 * Password recovery completion page.
 *
 * Handles two arrival paths:
 *
 * A. Token-hash / SSR (preferred — set this in the Supabase email template):
 *      Email link → /auth/callback?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password
 *      → server calls verifyOtp({ token_hash, type: "recovery" })
 *      → session cookies set on redirect response
 *      → browser lands here with cookies → getSession() → "ready"
 *
 * B. Implicit hash-fragment (default Supabase template / {{ .ConfirmationURL }}):
 *      Email link → Supabase /auth/v1/verify → redirects to
 *      …/reset-password#access_token=…&refresh_token=…&type=recovery
 *      → this page parses the fragment and calls setSession() explicitly.
 *
 *      IMPORTANT: we cannot use onAuthStateChange alone for path B. The
 *      @supabase/ssr createBrowserClient fires PASSWORD_RECOVERY during SDK
 *      initialisation — before useEffect runs — so the event is missed. We
 *      must parse the hash ourselves.
 */
export default function ResetPasswordPage() {
  const [status, setStatus] = useState<Status>("checking");
  const [errorMsg, setErrorMsg] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  useEffect(() => {
    const supabase = createClient();

    // One-time resolve guard — whichever path wins first, later paths
    // are ignored. Prevents double state-sets from parallel async calls.
    let settled = false;
    const resolve = () => {
      if (settled) return;
      settled = true;
      setStatus((prev) => (prev === "checking" ? "ready" : prev));
    };

    // Path 1: token-hash flow — /auth/callback ran verifyOtp() server-side,
    // set session cookies, then redirected here. createBrowserClient reads
    // from those cookies, so getSession() returns the live session.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) resolve();
    });

    // Path 2: implicit hash-fragment flow — the default Supabase
    // {{ .ConfirmationURL }} template redirects to the app with the
    // recovery session in the URL hash:
    //   …/reset-password#access_token=…&refresh_token=…&type=recovery
    //
    // @supabase/ssr's createBrowserClient fires PASSWORD_RECOVERY during
    // SDK initialisation — before this useEffect runs — so we cannot rely
    // on onAuthStateChange to catch it. Instead we parse the hash
    // ourselves and call setSession() explicitly. This is the only reliable
    // approach for the implicit flow.
    const rawHash = window.location.hash.slice(1);
    if (rawHash) {
      const hp = new URLSearchParams(rawHash);
      const accessToken = hp.get("access_token");
      const refreshToken = hp.get("refresh_token");
      const hashType = hp.get("type");

      if (accessToken && hashType === "recovery") {
        supabase.auth
          .setSession({ access_token: accessToken, refresh_token: refreshToken ?? "" })
          .then(({ data, error }) => {
            if (!error && data.session) {
              resolve();
              // Strip the fragment so a hard-refresh doesn't replay the token.
              window.history.replaceState(
                {},
                "",
                window.location.pathname + window.location.search,
              );
            }
          });
      }
    }

    // Path 3: belt-and-suspenders — listen for SDK-emitted events in case
    // the SDK does process the fragment on its own (behaviour varies across
    // @supabase/ssr versions and browser environments).
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && session)) {
        resolve();
      }
    });

    // 8s timeout — generous enough for slow connections, short enough to
    // give quick feedback on a genuinely expired/invalid link. Was 2s which
    // is too tight for the async setSession() round-trip above.
    const timer = window.setTimeout(() => {
      setStatus((prev) => (prev === "checking" ? "no-session" : prev));
    }, 8000);

    return () => {
      subscription.unsubscribe();
      window.clearTimeout(timer);
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status !== "ready" && status !== "error") return;

    if (password.length < 8) {
      setStatus("error");
      setErrorMsg("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setStatus("error");
      setErrorMsg("Passwords don't match.");
      return;
    }

    setStatus("saving");
    setErrorMsg("");

    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setStatus("error");
      setErrorMsg(error.message);
      return;
    }

    setStatus("saved");
    // Sign out the recovery session so the user has to re-enter the new
    // password — this both proves it works and avoids leaving a
    // recovery-flagged session active. Hard navigation to /login picks
    // up the ?reset=ok banner; if the proxy still sees a stale session
    // it would bounce to / and we'd lose the banner, hence the explicit
    // signOut first.
    await supabase.auth.signOut();
    window.setTimeout(() => {
      window.location.assign("/login?reset=ok");
    }, 600);
  };

  const isBusy = status === "saving";

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-heading text-4xl tracking-wide">Offpixel</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Set a new password
          </p>
        </div>

        <div className="rounded-md border border-border bg-card p-6">
          {status === "checking" ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Verifying recovery link…
            </div>
          ) : status === "no-session" ? (
            <div className="text-center py-4">
              <h2 className="font-heading text-lg tracking-wide">
                Link expired
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                This password reset link is no longer valid. Request a new
                one from the sign-in page.
              </p>
              <a
                href="/login"
                className="mt-4 inline-block text-xs text-muted-foreground hover:text-foreground underline"
              >
                Back to sign in
              </a>
            </div>
          ) : status === "saved" ? (
            <div className="text-center py-4">
              <CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-success" />
              <h2 className="font-heading text-lg tracking-wide">
                Password updated
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Redirecting…
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="password"
                  className="text-sm font-medium text-foreground"
                >
                  New password
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  required
                  autoFocus
                  autoComplete="new-password"
                  className="h-10 w-full rounded-md border border-border-strong bg-background px-3 text-sm text-foreground
                    placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="confirm"
                  className="text-sm font-medium text-foreground"
                >
                  Confirm password
                </label>
                <input
                  id="confirm"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  autoComplete="new-password"
                  className="h-10 w-full rounded-md border border-border-strong bg-background px-3 text-sm text-foreground
                    placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>

              {status === "error" && (
                <p className="text-xs text-destructive">
                  {errorMsg || "Something went wrong. Please try again."}
                </p>
              )}

              <button
                type="submit"
                disabled={isBusy || !password || !confirm}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-foreground text-background text-sm font-medium
                  transition-colors hover:bg-foreground/90 disabled:opacity-40 disabled:pointer-events-none"
              >
                {isBusy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Updating…
                  </>
                ) : (
                  <>
                    <KeyRound className="h-4 w-4" />
                    Update password
                  </>
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
