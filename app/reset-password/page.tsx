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
 * Recovery emails (sent via supabase.auth.resetPasswordForEmail or by an
 * admin from the Supabase dashboard) must redirect the user here so they
 * can set a new password.
 *
 * Two arrival flows are supported:
 *
 * 1. PKCE (preferred — used by resetPasswordForEmail with cookie storage):
 *    Email link → /auth/callback?code=…&next=/reset-password →
 *    server exchanges code into session cookies → redirect here. We see
 *    a session immediately on getSession().
 *
 * 2. Implicit (fallback — Supabase dashboard's "Send password recovery"
 *    sometimes uses this when the email template's redirect_to points
 *    straight at the site rather than at /auth/callback):
 *    Email link → /reset-password#access_token=…&refresh_token=…&type=recovery
 *    The browser SDK auto-consumes the fragment (detectSessionInUrl
 *    defaults to true) and fires onAuthStateChange with event =
 *    "PASSWORD_RECOVERY". We listen for it and unblock the form.
 *
 * If neither path produces a session within ~2s we surface a "link
 * expired" message and link back to /login so the user can request a new
 * one. We never call signOut on failure — the user may have a stale
 * regular session unrelated to recovery and we don't want to log them
 * out of their day.
 */
export default function ResetPasswordPage() {
  const [status, setStatus] = useState<Status>("checking");
  const [errorMsg, setErrorMsg] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  useEffect(() => {
    const supabase = createClient();

    // Path 1: PKCE callback already swapped code → cookies before we
    // mounted. getSession() returns the live session synchronously from
    // localStorage / cookies and we can show the form right away.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setStatus((prev) => (prev === "checking" ? "ready" : prev));
      }
    });

    // Path 2: implicit hash fragment. The SDK consumes #access_token
    // automatically on mount and emits PASSWORD_RECOVERY. SIGNED_IN can
    // also fire on the same load if the SDK happens to classify the
    // session that way — accept either as proof we have an actionable
    // recovery session.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && session)) {
        setStatus((prev) => (prev === "checking" ? "ready" : prev));
      }
    });

    // No session within 2s → assume the link is expired or malformed.
    // Functional update means we don't trample a "ready" state if the
    // SDK is just slow to fire.
    const timer = window.setTimeout(() => {
      setStatus((prev) => (prev === "checking" ? "no-session" : prev));
    }, 2000);

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
