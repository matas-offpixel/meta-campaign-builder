"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  type LoginFormMode,
  mapMagicLinkError,
  signInWithPasswordBoundary,
  toggleLoginFormMode,
} from "@/lib/auth/login-form";
import { CheckCircle2, KeyRound, Loader2, Mail } from "lucide-react";

type Status = "idle" | "sending" | "signing-in" | "sent" | "error";

/**
 * Client admin sign-in (OP909 self-service dashboard).
 *
 * Primary: email + password (signInWithPassword) — reliable across mobile
 * browser contexts where magic-link callbacks can drop session cookies.
 * Fallback: magic link (signInWithOtp) via "Forgot password? Email me a
 * sign-in link" for first-time users or password recovery.
 *
 * Access additionally requires a client_users row (migration 137) — a
 * provisioned Supabase user without one bounces back with ?error=no-client.
 *
 * No Turnstile here — Supabase's own rate limits cover the login surface.
 */
export default function AdminLoginPage() {
  return (
    <Suspense fallback={null}>
      <AdminLoginForm />
    </Suspense>
  );
}

function AdminLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const errorParam = searchParams.get("error");

  const [mode, setMode] = useState<LoginFormMode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const isBusy = status === "sending" || status === "signing-in";

  // Strip ?error=... after showing it once so a refresh doesn't replay it.
  useEffect(() => {
    if (!errorParam) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("error");
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  }, [errorParam]);

  const handlePasswordSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;

    setStatus("signing-in");
    setErrorMsg("");

    const supabase = createClient();
    const result = await signInWithPasswordBoundary(
      (addr, pass) =>
        supabase.auth.signInWithPassword({ email: addr, password: pass }),
      email,
      password,
    );

    if (!result.ok) {
      setStatus("error");
      setErrorMsg(result.message);
      return;
    }

    // Middleware routes /admin → /admin/{member-slug} once session is set.
    router.push("/admin");
  };

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setStatus("sending");
    setErrorMsg("");

    const emailRedirectTo = `${window.location.origin}/admin/auth/callback?next=/admin`;

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo,
        shouldCreateUser: false,
      },
    });

    if (error) {
      setStatus("error");
      setErrorMsg(mapMagicLinkError(error.message, "admin"));
    } else {
      setStatus("sent");
    }
  };

  const switchToMagicLink = () => {
    setMode(toggleLoginFormMode(mode));
    setStatus("idle");
    setErrorMsg("");
    setPassword("");
  };

  const switchToPassword = () => {
    setMode(toggleLoginFormMode(mode));
    setStatus("idle");
    setErrorMsg("");
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-heading text-4xl tracking-wide">Off/Pixel</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Client dashboard — landing pages &amp; fans
          </p>
        </div>

        {errorParam === "no-client" && (
          <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            Your account isn&apos;t linked to a client workspace yet. Contact
            Off/Pixel to get set up.
          </div>
        )}
        {errorParam === "auth" && (
          <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            That sign-in link is invalid or expired. Request a new one below.
          </div>
        )}

        <div className="rounded-md border border-border bg-card p-6">
          {status === "sent" ? (
            <div className="text-center py-4">
              <CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-success" />
              <h2 className="font-heading text-lg tracking-wide">
                Check your email
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                We sent a sign-in link to{" "}
                <span className="font-medium text-foreground">{email}</span>.
                <br />
                Click the link to open your dashboard.
              </p>
              <button
                type="button"
                onClick={() => {
                  setStatus("idle");
                  setEmail("");
                  setPassword("");
                  setErrorMsg("");
                  setMode("password");
                }}
                className="mt-4 text-xs text-muted-foreground hover:text-foreground underline"
              >
                Try a different email
              </button>
            </div>
          ) : mode === "password" ? (
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
                  placeholder="you@yourcompany.com"
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

              <p className="text-center">
                <button
                  type="button"
                  onClick={switchToMagicLink}
                  disabled={isBusy}
                  className="text-xs text-muted-foreground hover:text-foreground underline disabled:opacity-40 disabled:pointer-events-none"
                >
                  Forgot password? Email me a sign-in link
                </button>
              </p>
            </form>
          ) : (
            <form onSubmit={handleMagicLink} className="space-y-4">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="magic-email"
                  className="text-sm font-medium text-foreground"
                >
                  Email address
                </label>
                <input
                  id="magic-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@yourcompany.com"
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
                disabled={isBusy || !email.trim()}
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
                    Email me a sign-in link
                  </>
                )}
              </button>

              <p className="text-center">
                <button
                  type="button"
                  onClick={switchToPassword}
                  disabled={isBusy}
                  className="text-xs text-muted-foreground hover:text-foreground underline disabled:opacity-40 disabled:pointer-events-none"
                >
                  Back to password sign-in
                </button>
              </p>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-[11px] text-muted-foreground">
          Invite-only. Access is provisioned by Off/Pixel for each client
          workspace.
        </p>
      </div>
    </div>
  );
}
