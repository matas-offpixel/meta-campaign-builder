"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Loader2, Share2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface InitialShare {
  token: string;
  enabled: boolean;
}

interface Props {
  clientId: string;
  /** Existing client-scoped share (or null when none has been minted). */
  initialShare: InitialShare | null;
}

/**
 * Dashboard control for the client-scoped ticket-input share link.
 *
 * One token per client; the public portal at /share/client/[token] lets
 * the promoter self-report tickets sold per event without an account.
 *
 * UX:
 *   - No share yet     → "Generate link" button.
 *   - Share active     → read-only URL input + copy button + disable.
 *   - Share disabled   → "Generate link" re-enables the existing token
 *                        (server flips enabled back to true) so the
 *                        URL the client already has stays valid.
 */
export function ClientShareLinkCard({ clientId, initialShare }: Props) {
  const [share, setShare] = useState<InitialShare | null>(initialShare);
  const [working, setWorking] = useState<null | "mint" | "disable">(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState<string>("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      setOrigin(window.location.origin);
    }
  }, []);

  const url = share ? `${origin || ""}/share/client/${share.token}` : null;
  const enabled = share?.enabled ?? false;

  const handleMint = async () => {
    setWorking("mint");
    setError(null);
    try {
      const res = await fetch("/api/share/client", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId }),
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        token?: string;
        error?: string;
      } | null;
      if (!res.ok || !json?.ok || !json.token) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      setShare({ token: json.token, enabled: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setWorking(null);
    }
  };

  const handleDisable = async () => {
    if (!share) return;
    setWorking("disable");
    setError(null);
    try {
      const res = await fetch("/api/share/client", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: share.token, enabled: false }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      // Drop local row to revert to "Generate link" CTA. Pressing it
      // again surfaces (and re-enables) the same token server-side.
      setShare(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setWorking(null);
    }
  };

  const handleCopy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy to clipboard");
    }
  };

  return (
    <section className="rounded-md border border-border bg-card p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Share2 className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-heading text-base tracking-wide">
          Share ticket input link
        </h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Generate a public link the client can use to self-report
        tickets-sold for every event under this client. No login
        required — the link is the only credential.
      </p>

      {error && (
        <div className="rounded-md border border-destructive bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {share && enabled ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Input
              readOnly
              value={url ?? ""}
              onFocus={(e) => e.currentTarget.select()}
              className="font-mono text-xs"
              aria-label="Public client portal URL"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopy}
              disabled={!url}
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  Copy link
                </>
              )}
            </Button>
          </div>
          <button
            type="button"
            onClick={handleDisable}
            disabled={working !== null}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive transition-colors disabled:opacity-60"
          >
            {working === "disable" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <X className="h-3 w-3" />
            )}
            Disable link
          </button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleMint}
          disabled={working !== null}
        >
          {working === "mint" ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Generating…
            </>
          ) : (
            <>
              <Share2 className="h-3.5 w-3.5" />
              Generate link
            </>
          )}
        </Button>
      )}
    </section>
  );
}
