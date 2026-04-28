"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Loader2, Share2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * components/dashboard/clients/venue-share-controls.tsx
 *
 * Compact share controls for the venue full-report page
 * (`/clients/[id]/venues/[event_code]`). Mirrors the semantics of
 * `client-share-link-card` (PR #108) but:
 *
 *   - Pivots on (client_id, event_code) instead of client_id.
 *   - Hits `POST/PATCH /api/share/venue` (new in this PR).
 *   - Renders in the page-header actions slot, so the layout is
 *     horizontal + minimal rather than the full card used on the
 *     client detail page.
 *
 * UX is identical in shape:
 *   - No share yet   → "Share venue" button.
 *   - Share enabled  → URL input + Copy + Disable.
 *   - Share disabled → "Share venue" button re-enables the same
 *                      token server-side (idempotent on the server).
 */

interface Props {
  clientId: string;
  eventCode: string;
  /** Token of an existing venue share, null when none minted yet. */
  initialShareToken: string | null;
  /** Edit flag of the existing share, null when no share exists. */
  initialCanEdit: boolean | null;
  /** Enabled flag of the existing share, null when no share exists. */
  initialEnabled: boolean | null;
}

export function VenueShareControls({
  clientId,
  eventCode,
  initialShareToken,
  initialCanEdit: _initialCanEdit,
  initialEnabled,
}: Props) {
  const [token, setToken] = useState<string | null>(
    initialEnabled === false ? null : initialShareToken,
  );
  const [working, setWorking] = useState<null | "mint" | "disable">(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState<string>("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      setOrigin(window.location.origin);
    }
  }, []);

  const url = token ? `${origin || ""}/share/venue/${token}` : null;

  const handleMint = async () => {
    setWorking("mint");
    setError(null);
    try {
      const res = await fetch("/api/share/venue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, event_code: eventCode }),
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        token?: string;
        error?: string;
      } | null;
      if (!res.ok || !json?.ok || !json.token) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      setToken(json.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setWorking(null);
    }
  };

  const handleDisable = async () => {
    if (!token) return;
    setWorking("disable");
    setError(null);
    try {
      const res = await fetch("/api/share/venue", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, enabled: false }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      // Drop local token so the CTA reverts to "Share venue" — the
      // row stays on the server (disabled), and a subsequent mint
      // flips it back on rather than rotating the token.
      setToken(null);
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

  if (token) {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-2">
          <Input
            readOnly
            value={url ?? ""}
            onFocus={(e) => e.currentTarget.select()}
            className="w-64 font-mono text-[11px]"
            aria-label="Public venue report URL"
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
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                Copy
              </>
            )}
          </Button>
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
            Disable
          </button>
        </div>
        {error && (
          <p className="text-[11px] text-destructive">{error}</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
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
            Share venue
          </>
        )}
      </Button>
      {error && (
        <p className="text-[11px] text-destructive">{error}</p>
      )}
    </div>
  );
}
