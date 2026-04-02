"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Loader2, Mail, CheckCircle2 } from "lucide-react";

type Status = "idle" | "sending" | "sent" | "error";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [fbLoading, setFbLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    const allowedEmails = ["matas@offpixel.co.uk"];

    if (!allowedEmails.includes(email.trim().toLowerCase())) {
      setStatus("error");
      setErrorMsg("Access restricted. Contact your admin to request access.");
      return;
    }

    setStatus("sending");
    setErrorMsg("");

    const emailRedirectTo =
      process.env.NODE_ENV === "development"
        ? "http://localhost:3000/auth/callback"
        : "https://app.offpixel.co.uk/auth/callback";

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo,
      },
    });

    if (error) {
      setStatus("error");
      setErrorMsg(error.message);
    } else {
      setStatus("sent");
    }
  };

  const handleFacebookLogin = async () => {
    setFbLoading(true);
    setErrorMsg("");

    // Facebook OAuth must land on the CLIENT-SIDE callback page, not the
    // server route handler. The browser Supabase client captures provider_token
    // from exchangeCodeForSession and we save it to localStorage there.
    const redirectTo = `${window.location.origin}/auth/facebook-callback`;

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "facebook",
      options: {
        scopes: "pages_show_list pages_manage_metadata ads_management",
        redirectTo,
      },
    });

    if (error) {
      setFbLoading(false);
      setStatus("error");
      setErrorMsg(error.message);
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
              <h2 className="font-heading text-lg tracking-wide">Check your email</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                We sent a magic link to{" "}
                <span className="font-medium text-foreground">{email}</span>.
                <br />
                Click the link to sign in.
              </p>
              <button
                type="button"
                onClick={() => { setStatus("idle"); setEmail(""); }}
                className="mt-4 text-xs text-muted-foreground hover:text-foreground underline"
              >
                Try a different email
              </button>
            </div>
          ) : (
            <>
              {/* ── Facebook OAuth ──────────────────────────────── */}
              <button
                type="button"
                onClick={handleFacebookLogin}
                disabled={fbLoading}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-[#1877F2] text-white text-sm font-medium
                  transition-colors hover:bg-[#166FE5] disabled:opacity-40 disabled:pointer-events-none"
              >
                {fbLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073c0 6.025 4.388 11.018 10.125 11.927v-8.437H7.078v-3.49h3.047V9.41c0-3.026 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.971h-1.513c-1.491 0-1.956.93-1.956 1.886v2.267h3.328l-.532 3.49h-2.796v8.437C19.612 23.09 24 18.098 24 12.073" />
                  </svg>
                )}
                Login with Facebook
              </button>

              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-card px-2 text-muted-foreground">or</span>
                </div>
              </div>

              {/* ── Magic link ──────────────────────────────────── */}
              <form onSubmit={handleSubmit} className="space-y-4">
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
                  <p className="text-xs text-destructive">{errorMsg || "Something went wrong. Please try again."}</p>
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
            </>
          )}
        </div>

        <p className="mt-6 text-center text-[11px] text-muted-foreground">
          Invite-only. Contact your admin if you need access.
        </p>
      </div>
    </div>
  );
}
