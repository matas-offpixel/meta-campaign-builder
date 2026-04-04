"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Loader2, Mail, CheckCircle2 } from "lucide-react";

type Status = "idle" | "sending" | "sent" | "error";

/**
 * Invite-only magic link login. Facebook is connected inside the app after
 * sign-in (Account Setup → Connect Facebook), not here.
 */
export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");

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
          )}
        </div>

        <p className="mt-6 text-center text-[11px] text-muted-foreground">
          Invite-only. After you sign in, connect Facebook in Account Setup to use Meta features that need your pages.
        </p>
      </div>
    </div>
  );
}
