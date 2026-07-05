"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { CheckCircle2, Loader2, Mail } from "lucide-react";

type Status = "idle" | "sending" | "sent" | "error";

/**
 * Client admin sign-in (OP909 self-service dashboard). Magic link ONLY —
 * clients never hold passwords for this surface. Mirrors /login's
 * invite-only posture: shouldCreateUser: false means unknown emails can't
 * self-register, and access additionally requires a client_users row
 * (migration 137) — a provisioned Supabase user without one bounces back
 * here with ?error=no-client.
 *
 * No Turnstile here — Supabase's own OTP rate limits cover the login
 * surface; Turnstile is a fan-facing /l concern only.
 */
export default function AdminLoginPage() {
  return (
    <Suspense fallback={null}>
      <AdminLoginForm />
    </Suspense>
  );
}

function AdminLoginForm() {
  const searchParams = useSearchParams();
  const errorParam = searchParams.get("error");

  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  // Strip ?error=... after showing it once so a refresh doesn't replay it.
  useEffect(() => {
    if (!errorParam) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("error");
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  }, [errorParam]);

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setStatus("sending");
    setErrorMsg("");

    // Land on /admin/auth/callback; on success it redirects to /admin and
    // the proxy routes to the member's own /admin/{slug}.
    const emailRedirectTo = `${window.location.origin}/admin/auth/callback?next=/admin`;

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo,
        // Invite-only: unknown emails must not self-provision.
        shouldCreateUser: false,
      },
    });

    if (error) {
      setStatus("error");
      setErrorMsg(
        /signups not allowed|user not found/i.test(error.message)
          ? "This email isn't registered. Contact Off/Pixel to get access."
          : error.message,
      );
    } else {
      setStatus("sent");
    }
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
                  setErrorMsg("");
                }}
                className="mt-4 text-xs text-muted-foreground hover:text-foreground underline"
              >
                Try a different email
              </button>
            </div>
          ) : (
            <form onSubmit={handleMagicLink} className="space-y-4">
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
                    Email me a sign-in link
                  </>
                )}
              </button>
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
