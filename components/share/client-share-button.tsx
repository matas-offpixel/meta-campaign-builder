"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Loader2, Share2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface ClientShareInitial {
  token: string;
  enabled: boolean;
}

interface Props {
  clientId: string;
  /** Existing client-scoped share, including disabled rows (see `getClientScopeShare`). */
  initialShare: ClientShareInitial | null;
}

/**
 * Header control on `/clients/[id]/dashboard` — mint or manage the public
 * `/share/client/[token]` URL without visiting the client overview tab.
 */
export function ClientShareButton({ clientId, initialShare }: Props) {
  const [share, setShare] = useState<ClientShareInitial | null>(initialShare);
  const [modalOpen, setModalOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      setOrigin(window.location.origin);
    }
  }, []);

  const displayUrl = share?.enabled
    ? `${origin}/share/client/${share.token}`
    : "";

  const openModal = useCallback(() => {
    setError(null);
    setCopied(false);
    setModalOpen(true);
  }, []);

  const handleMint = async () => {
    setWorking(true);
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
        url?: string;
        error?: string;
      } | null;
      if (!res.ok || !json?.ok || !json.token) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      setShare({ token: json.token, enabled: true });
      setModalOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setWorking(false);
    }
  };

  const handleReEnable = async () => {
    if (!share) return;
    setWorking(true);
    setError(null);
    try {
      const res = await fetch("/api/share/client", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: share.token, enabled: true }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      setShare({ token: share.token, enabled: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setWorking(false);
    }
  };

  const handleDisableShare = async () => {
    if (!share) return;
    setWorking(true);
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
      setShare({ token: share.token, enabled: false });
      setModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setWorking(false);
    }
  };

  const handleCopy = async () => {
    if (!displayUrl) return;
    try {
      await navigator.clipboard.writeText(displayUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy to clipboard");
    }
  };

  if (share && !share.enabled) {
    return (
      <div className="flex items-center gap-2">
        <span className="rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Share disabled
        </span>
        <button
          type="button"
          onClick={handleReEnable}
          disabled={working}
          className="inline-flex items-center gap-1 rounded border border-border-strong px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
        >
          {working ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          ) : null}
          Re-enable
        </button>
        {error ? (
          <span className="text-[11px] text-destructive">{error}</span>
        ) : null}
      </div>
    );
  }

  const primaryLabel = share ? "Share dashboard" : "Generate share link";

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={share ? openModal : handleMint}
          disabled={working}
          className="inline-flex items-center gap-1.5 rounded border border-border-strong px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
        >
          {working && !modalOpen ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          ) : (
            <Share2 className="h-3 w-3" aria-hidden="true" />
          )}
          {primaryLabel}
        </button>
        {error && !modalOpen ? (
          <span className="text-[11px] text-destructive">{error}</span>
        ) : null}
      </div>

      <Dialog open={modalOpen} onClose={() => setModalOpen(false)}>
        <DialogContent>
          <DialogHeader onClose={() => setModalOpen(false)}>
            <DialogTitle>Client dashboard link</DialogTitle>
            <DialogDescription>
              Anyone with this URL can view this client&apos;s dashboard.
              Copy it for the promoter or agency contact.
            </DialogDescription>
          </DialogHeader>

          {error ? (
            <div className="rounded-md border border-destructive bg-destructive/10 p-2 text-xs text-destructive">
              {error}
            </div>
          ) : null}

          <div className="flex items-center gap-2">
            <Input
              readOnly
              value={displayUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="font-mono text-xs"
              aria-label="Public client dashboard URL"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopy}
              disabled={!displayUrl}
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
          </div>

          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-border p-3">
            <span className="text-sm text-foreground">Public access</span>
            <input
              type="checkbox"
              className="h-4 w-4 accent-foreground"
              checked={share?.enabled ?? true}
              disabled={working}
              onChange={(e) => {
                if (!e.target.checked) {
                  void handleDisableShare();
                }
              }}
            />
          </label>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
