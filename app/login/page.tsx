"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { CheckCircle2, KeyRound, Loader2, Mail } from "lucide-react";

type Status =
  | "idle"
  | "sending"
  | "signing-in"
  | "sent"
  | "reset-sent"
  | "error";

/**
 * Sign-in page. Two flows on a single form:
 *   - Password (signInWithPassword)        — fires when the user types a
 *                                            password and presses "Sign in"
 *   - Magic link (signInWithOtp)           — fires when the user presses
 *                                            "Email me a magic link"
 *
 * Access control lives on the Supabase side: only provisioned users can
 * authenticate. The magic-link path passes shouldCreateUser: false so an
 * unknown email can't self-register by typing it into the form — without
 * that flag signInWithOtp would silently create a new Supabase user for
 * any address entered, which would defeat invite-only access.
 *
 * Facebook OAuth is handled separately (Account Setup → Connect
 * Facebook); not part of this page.
 */
export default function LoginPage() {
  // useSearchParams reads from the Next.js router, which can suspend on
  // first render — wrap the form in a Suspense boundary so static
  // optimisation doesn't bail out of the route.
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const searchParams = useSearchParams();
  // /reset-password sends the user back here with ?reset=ok after a
  // successful password change. Read it directly from the router (no
  // setState-in-effect anti-pattern), then strip the param via
  // replaceState in an effect so a refresh doesn't replay the banner.
  const resetSuccess = searchParams.get("reset") === "ok";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const isBusy = status === "sending" || status === "signing-in";

  useEffect(() => {
    if (!resetSuccess) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("reset");
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  }, [resetSuccess]);

  /**
   * Password sign-in. Form-level submit handler so Enter inside either
   * the email or password input fires this path (which matches user
   * expectation when they've typed a password — magic link has its own
   * dedicated button).
   */
  const handlePasswordSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;

    setStatus("signing-in");
    setErrorMsg("");

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      setStatus("error");
      // Map Supabase's generic "Invalid login credentials" to the
      // friendlier "Invalid email or password" wording. Other errors
      // (rate limit, network) pass through verbatim so we don't lose
      // diagnostic signal.
      setErrorMsg(
        /invalid login credentials/i.test(error.message)
          ? "Invalid email or password."
          : error.message,
      );
      return;
    }

    // Success: proxy will see the new session cookie and redirect away
    // from /login on the next navigation. Hard-reload to / so the
    // server components mount with the fresh session.
    window.location.assign("/");
  };

  /** Magic-link button — independent flow, no password required. */
  const handleMagicLink = async () => {
    if (!email.trim()) return;

    setStatus("sending");
    setErrorMsg("");

    // Derive the callback URL from the actual origin so magic links work
    // on both production (app.offpixel.co.uk) and Vercel preview deploys.
    const emailRedirectTo = `${window.location.origin}/auth/callback`;

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo,
        // Critical: do NOT auto-provision new users via magic link.
        // Otherwise anyone who knows the URL could create themselves
        // an account by typing any email here. Existing users get a
        // link; unknown emails return an error from Supabase.
        shouldCreateUser: false,
      },
    });

    if (error) {
      setStatus("error");
      setErrorMsg(error.message);
    } else {
      setStatus("sent");
    }
  };

  /**
   * Forgot password? — sends a Supabase recovery email. The link in the
   * email goes through /auth/callback (so the PKCE code can be exchanged
   * server-side into session cookies) and lands on /reset-password where
   * the user picks a new password.
   *
   * Supabase still requires the email to belong to a provisioned user;
   * unknown addresses get a "Email not confirmed"/"User not found"
   * response which we surface verbatim.
   */
  const handleForgotPassword = async () => {
    if (!email.trim()) {
      setStatus("error");
      setErrorMsg("Enter your email first, then press Forgot password?");
      return;
    }

    setStatus("sending");
    setErrorMsg("");

    const redirectTo = `${window.location.origin}/auth/callback?next=/reset-password`;

    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo,
    });

    if (error) {
      setStatus("error");
      setErrorMsg(error.message);
    } else {
      setStatus("reset-sent");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-heading text-4xl tracking-wide">Offpixel</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Campaign Builder — Internal Tool
          </p>
        </div>

        {resetSuccess && (
          <div className="mb-4 flex items-center gap-2 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-xs text-success">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Password updated. Sign in with your new password.
          </div>
        )}

        <div className="rounded-md border border-border bg-card p-6">
          {status === "sent" || status === "reset-sent" ? (
            <div className="text-center py-4">
              <CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-success" />
              <h2 className="font-heading text-lg tracking-wide">
                Check your email
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {status === "reset-sent" ? (
                  <>
                    We sent a password reset link to{" "}
                    <span className="font-medium text-foreground">{email}</span>
                    .<br />
                    Click the link to set a new password.
                  </>
                ) : (
                  <>
                    We sent a magic link to{" "}
                    <span className="font-medium text-foreground">{email}</span>
                    .<br />
                    Click the link to sign in.
                  </>
                )}
              </p>
              <button
                type="button"
                onClick={() => {
                  setStatus("idle");
                  setEmail("");
                  setPassword("");
                  setErrorMsg("");
                }}
                className="mt-4 text-xs text-muted-foreground hover:text-foreground underline"
              >
                Try a different email
              </button>
            </div>
          ) : (
            <form onSubmit={handlePasswordSignIn} className="space-y-4">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="email"
                  className="text-sm font-medium text-foreground"
                >
                  Email address
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@offpixel.co.uk"
                  required
                  autoFocus
                  autoComplete="email"
                  className="h-10 w-full rounded-md border border-border-strong bg-background px-3 text-sm text-foreground
                    placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <label
                    htmlFor="password"
                    className="text-sm font-medium text-foreground"
                  >
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    disabled={isBusy}
                    className="text-xs text-muted-foreground hover:text-foreground underline disabled:opacity-40 disabled:pointer-events-none"
                  >
                    Forgot password?
                  </button>
                </div>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Or use a magic link below"
                  autoComplete="current-password"
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
                disabled={isBusy || !email.trim() || !password}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-foreground text-background text-sm font-medium
                  transition-colors hover:bg-foreground/90 disabled:opacity-40 disabled:pointer-events-none"
              >
                {status === "signing-in" ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  <>
                    <KeyRound className="h-4 w-4" />
                    Sign in
                  </>
                )}
              </button>

              <div className="relative py-1 text-center text-[11px] uppercase tracking-wider text-muted-foreground">
                <span className="relative bg-card px-2">or</span>
                <span className="absolute inset-x-0 top-1/2 -z-10 border-t border-border" />
              </div>

              <button
                type="button"
                onClick={handleMagicLink}
                disabled={isBusy || !email.trim()}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-border-strong bg-background text-foreground text-sm font-medium
                  transition-colors hover:bg-muted disabled:opacity-40 disabled:pointer-events-none"
              >
                {status === "sending" ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Sending link...
                  </>
                ) : (
                  <>
                    <Mail className="h-4 w-4" />
                    Email me a magic link
                  </>
                )}
              </button>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-[11px] text-muted-foreground">
          Invite-only. After you sign in, connect Facebook in Account
          Setup to use Meta features that need your pages.
        </p>
      </div>
    </div>
  );
}
