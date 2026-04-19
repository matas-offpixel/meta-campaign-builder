"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Loader2, Mail, CheckCircle2, KeyRound } from "lucide-react";

type Mode = "magic" | "password";
type Status = "idle" | "sending" | "sent" | "signing-in" | "error";

/**
 * Invite-only login page.
 *
 * Two methods supported:
 *   1. Magic link  (signInWithOtp)        — default, primary admin flow
 *   2. Password    (signInWithPassword)   — for accounts provisioned in
 *                                            Supabase that need a synchronous
 *                                            session (e.g. reviewer access)
 *
 * Both methods share the same email allowlist gate so the surface stays
 * invite-only. Facebook OAuth is connected separately inside the app
 * (Account Setup → Connect Facebook), not from this page.
 */

const ALLOWED_EMAILS: ReadonlySet<string> = new Set([
  "matas@offpixel.co.uk",
  "hello@offpixel.co.uk",
]);

function isAllowed(email: string): boolean {
  return ALLOWED_EMAILS.has(email.trim().toLowerCase());
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("magic");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const switchMode = (next: Mode) => {
    if (next === mode) return;
    setMode(next);
    setStatus("idle");
    setErrorMsg("");
    setPassword("");
  };

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    if (!isAllowed(email)) {
      setStatus("error");
      setErrorMsg("Access restricted. Contact your admin to request access.");
      return;
    }

    setStatus("sending");
    setErrorMsg("");

    // Derive the callback URL from the actual origin so magic links work on
    // both production (app.offpixel.co.uk) and Vercel preview deployments.
    const emailRedirectTo = `${window.location.origin}/auth/callback`;

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo },
    });

    if (error) {
      setStatus("error");
      setErrorMsg(error.message);
    } else {
      setStatus("sent");
    }
  };

  const handlePasswordSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;

    if (!isAllowed(email)) {
      setStatus("error");
      setErrorMsg("Access restricted. Contact your admin to request access.");
      return;
    }

    setStatus("signing-in");
    setErrorMsg("");

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      setStatus("error");
      // Don't leak whether the email exists or not — surface a single
      // generic message for any auth-side failure.
      setErrorMsg(
        error.message.toLowerCase().includes("invalid")
          ? "Invalid email or password."
          : error.message,
      );
      return;
    }

    // Session cookies are set by @supabase/ssr; refresh the route tree so the
    // proxy/middleware sees the new session and the home route renders.
    router.replace("/");
    router.refresh();
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
              <h2 className="font-heading text-lg tracking-wide">Check your email</h2>
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
                }}
                className="mt-4 text-xs text-muted-foreground hover:text-foreground underline"
              >
                Try a different email
              </button>
            </div>
          ) : (
            <>
              {/* Mode toggle */}
              <div
                className="mb-5 flex items-center gap-1 rounded-md border border-border bg-muted/40 p-1 text-xs font-medium"
                role="tablist"
                aria-label="Sign-in method"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "magic"}
                  onClick={() => switchMode("magic")}
                  className={`flex h-8 flex-1 items-center justify-center gap-1.5 rounded transition-colors ${
                    mode === "magic"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Mail className="h-3.5 w-3.5" />
                  Magic link
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "password"}
                  onClick={() => switchMode("password")}
                  className={`flex h-8 flex-1 items-center justify-center gap-1.5 rounded transition-colors ${
                    mode === "password"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <KeyRound className="h-3.5 w-3.5" />
                  Password
                </button>
              </div>

              {mode === "magic" ? (
                <form onSubmit={handleMagicLink} className="space-y-4">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="email" className="text-sm font-medium text-foreground">
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

                  {status === "error" && (
                    <p className="text-xs text-destructive">
                      {errorMsg || "Something went wrong. Please try again."}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={status === "sending" || !email.trim()}
                    className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-foreground text-background text-sm font-medium
                      transition-colors hover:bg-foreground/90 disabled:opacity-40 disabled:pointer-events-none"
                  >
                    {status === "sending" ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Sending link...
                      </>
                    ) : (
                      <>
                        <Mail className="h-4 w-4" />
                        Send Magic Link
                      </>
                    )}
                  </button>
                </form>
              ) : (
                <form onSubmit={handlePasswordSignIn} className="space-y-4">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="email-pw" className="text-sm font-medium text-foreground">
                      Email address
                    </label>
                    <input
                      id="email-pw"
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
                    <label htmlFor="password" className="text-sm font-medium text-foreground">
                      Password
                    </label>
                    <input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
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
                    disabled={status === "signing-in" || !email.trim() || !password}
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
                        Sign In
                      </>
                    )}
                  </button>
                </form>
              )}
            </>
          )}
        </div>

        <p className="mt-6 text-center text-[11px] text-muted-foreground">
          Invite-only. After you sign in, connect Facebook in Account Setup to use Meta features that need your pages.
        </p>
      </div>
    </div>
  );
}
