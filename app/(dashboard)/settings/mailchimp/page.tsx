"use client";

import { useState, type FormEvent } from "react";
import { CheckCircle2, Loader2, Mail } from "lucide-react";
import { useRouter } from "next/navigation";

import { PageHeader } from "@/components/dashboard/page-header";

interface ConnectState {
  kind: "idle" | "loading" | "success" | "error";
  message?: string;
  accountName?: string;
}

export default function MailchimpConnectPage() {
  const router = useRouter();
  const [apiKey, setApiKey] = useState("");
  const [label, setLabel] = useState("");
  const [state, setState] = useState<ConnectState>({ kind: "idle" });

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim()) return;
    setState({ kind: "loading" });

    try {
      const res = await fetch("/api/integrations/mailchimp/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim(), accountLabel: label.trim() || undefined }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        accountName?: string;
      };
      if (!res.ok || !json.ok) {
        setState({ kind: "error", message: json.error ?? `HTTP ${res.status}` });
        return;
      }
      setState({ kind: "success", accountName: json.accountName });
      setTimeout(() => router.push("/settings?connected=mailchimp"), 1500);
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Connection failed.",
      });
    }
  };

  return (
    <>
      <PageHeader
        title="Connect Mailchimp"
        description="Paste your Mailchimp Marketing API key to enable audience sync."
      />
      <main className="flex-1 px-6 py-10">
        <div className="mx-auto max-w-lg">
          <section className="rounded-lg border border-border bg-card p-6 shadow-sm space-y-6">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#FFE01B]">
                <Mail className="h-4 w-4 text-[#241C15]" />
              </span>
              <div>
                <p className="font-medium text-foreground">Mailchimp</p>
                <p className="text-xs text-muted-foreground">
                  Marketing API v3.0 — API key authentication
                </p>
              </div>
            </div>

            {state.kind === "success" ? (
              <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>
                  Connected as <strong>{state.accountName}</strong>. Redirecting…
                </span>
              </div>
            ) : (
              <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
                <div className="space-y-1">
                  <label
                    htmlFor="mc-api-key"
                    className="block text-xs font-medium text-foreground"
                  >
                    API Key
                  </label>
                  <input
                    id="mc-api-key"
                    type="password"
                    autoComplete="off"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx-us21"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    required
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Find it under{" "}
                    <span className="font-medium">Account → Extras → API keys</span>{" "}
                    in Mailchimp.
                  </p>
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor="mc-label"
                    className="block text-xs font-medium text-foreground"
                  >
                    Account label{" "}
                    <span className="font-normal text-muted-foreground">(optional)</span>
                  </label>
                  <input
                    id="mc-label"
                    type="text"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="e.g. Off Pixel Mailchimp"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>

                {state.kind === "error" ? (
                  <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    {state.message}
                  </p>
                ) : null}

                <button
                  type="submit"
                  disabled={state.kind === "loading" || !apiKey.trim()}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60"
                >
                  {state.kind === "loading" ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Validating…
                    </>
                  ) : (
                    "Connect Mailchimp"
                  )}
                </button>
              </form>
            )}

            <p className="text-[11px] text-muted-foreground">
              The API key is encrypted at rest and never returned in any API
              response. We only read audience stats — no sends or writes to your
              lists.
            </p>
          </section>
        </div>
      </main>
    </>
  );
}
