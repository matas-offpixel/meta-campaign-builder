"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CheckCircle2, KeyRound, Loader2, Mail } from "lucide-react";

type Status = "idle" | "sending" | "signing-in" | "sent" | "error";

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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const isBusy = status === "sending" || status === "signing-in";

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

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-heading text-4xl tracking-wide">Offpixel</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Campaign Builder — Internal Tool
          </p>
        </div>

        <div className="rounded-md border border-border bg-card p-6">
          {status === "sent" ? (
            <div className="text-center py-4">
              <CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-success" />
              <h2 className="font-heading text-lg tracking-wide">
                Check your email
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                We sent a magic link to{" "}
                <span className="font-medium text-foreground">{email}</span>.
                <br />
                Click the link to sign in.
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
                <label
                  htmlFor="password"
                  className="text-sm font-medium text-foreground"
                >
                  Password
                </label>
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
