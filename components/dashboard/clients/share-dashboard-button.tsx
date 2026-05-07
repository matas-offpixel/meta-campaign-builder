"use client";

import { useState } from "react";
import { Check, Copy, Loader2, Share2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

const SHARE_BASE_URL = "https://app.offpixel.co.uk/share/client";

interface ShareState {
  token: string;
  url: string;
  enabled: boolean;
  can_edit: boolean;
  view_count: number;
}

interface Props {
  clientId: string;
  /** Server-resolved existing share, or null when none has been minted yet. */
  initialShare: ShareState | null;
}

/**
 * Header button that mints/manages the client dashboard share link.
 *
 * First click (no existing share): POSTs to /api/share/client to mint,
 * then opens the link modal.
 *
 * Subsequent clicks: opens the modal immediately with controls to copy
 * the URL, toggle enabled/disabled, and toggle can_edit.
 *
 * The URL is always rendered as https://app.offpixel.co.uk/share/client/{token}
 * regardless of the current environment.
 */
export function ShareDashboardButton({ clientId, initialShare }: Props) {
  const [share, setShare] = useState<ShareState | null>(initialShare);
  const [open, setOpen] = useState(false);
  const [minting, setMinting] = useState(false);
  const [mintError, setMintError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [togglingEnabled, setTogglingEnabled] = useState(false);
  const [togglingCanEdit, setTogglingCanEdit] = useState(false);

  const shareUrl = share ? `${SHARE_BASE_URL}/${share.token}` : null;
  const tokenShort = share ? share.token.slice(0, 12) + "…" : null;

  const handleClick = async () => {
    if (share) {
      setOpen(true);
      return;
    }
    setMinting(true);
    setMintError(null);
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
        can_edit?: boolean;
        view_count?: number;
        enabled?: boolean;
        error?: string;
      } | null;
      if (!res.ok || !json?.ok || !json.token) {
        throw new Error(json?.error ?? `HTTP ${res.status}`);
      }
      setShare({
        token: json.token,
        url: `${SHARE_BASE_URL}/${json.token}`,
        enabled: json.enabled ?? true,
        can_edit: json.can_edit ?? true,
        view_count: json.view_count ?? 0,
      });
      setOpen(true);
    } catch (err) {
      setMintError(err instanceof Error ? err.message : "Failed to generate link");
    } finally {
      setMinting(false);
    }
  };

  const handleCopy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select the input text
    }
  };

  const patchShare = async (patch: { enabled?: boolean; can_edit?: boolean }) => {
    if (!share) return;
    const res = await fetch("/api/share/client", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: share.token, ...patch }),
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(json?.error ?? `HTTP ${res.status}`);
    }
  };

  const handleToggleEnabled = async () => {
    if (!share || togglingEnabled) return;
    const next = !share.enabled;
    setTogglingEnabled(true);
    try {
      await patchShare({ enabled: next });
      setShare((s) => s ? { ...s, enabled: next } : s);
    } catch (err) {
      console.error("[share-dashboard-button] toggle enabled failed", err);
    } finally {
      setTogglingEnabled(false);
    }
  };

  const handleToggleCanEdit = async () => {
    if (!share || togglingCanEdit) return;
    const next = !share.can_edit;
    setTogglingCanEdit(true);
    try {
      await patchShare({ can_edit: next });
      setShare((s) => s ? { ...s, can_edit: next } : s);
    } catch (err) {
      console.error("[share-dashboard-button] toggle can_edit failed", err);
    } finally {
      setTogglingCanEdit(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleClick}
        disabled={minting}
        className="gap-1.5"
      >
        {minting ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Share2 className="h-3.5 w-3.5" />
        )}
        {minting ? "Generating…" : "Share dashboard"}
        {share && (
          <span
            className={`ml-0.5 h-1.5 w-1.5 rounded-full ${share.enabled ? "bg-green-500" : "bg-muted-foreground/40"}`}
            aria-label={share.enabled ? "Link active" : "Link disabled"}
          />
        )}
      </Button>

      {mintError && (
        <span className="text-xs text-destructive">{mintError}</span>
      )}

      <Dialog open={open} onClose={() => setOpen(false)}>
        <DialogContent>
          <DialogHeader onClose={() => setOpen(false)}>
            <DialogTitle>Share dashboard link</DialogTitle>
            <DialogDescription>
              Anyone with this link can view the client dashboard.
              {share?.view_count != null && share.view_count > 0 && (
                <> Viewed {share.view_count} time{share.view_count === 1 ? "" : "s"}.</>
              )}
            </DialogDescription>
          </DialogHeader>

          {shareUrl && (
            <div className="space-y-4">
              {/* URL copy row */}
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={shareUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="font-mono text-xs"
                  aria-label="Client dashboard share URL"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCopy}
                  className="shrink-0"
                >
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      Copy
                    </>
                  )}
                </Button>
              </div>

              {/* Token display */}
              <p className="text-xs text-muted-foreground font-mono">
                Token: {tokenShort}
              </p>

              {/* Toggles */}
              <div className="space-y-2 pt-1">
                <ToggleRow
                  label="Share link enabled"
                  description="Disable to stop public access without deleting the link."
                  checked={share?.enabled ?? false}
                  loading={togglingEnabled}
                  onChange={handleToggleEnabled}
                />
                <ToggleRow
                  label="Allow editing"
                  description="Lets the client self-report ticket sales via the share URL."
                  checked={share?.can_edit ?? false}
                  loading={togglingCanEdit}
                  onChange={handleToggleCanEdit}
                />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  loading,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  loading: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer group">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={onChange}
        disabled={loading}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${
          checked ? "bg-primary" : "bg-muted"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-background shadow transition-transform ${
            checked ? "translate-x-4" : "translate-x-0"
          }`}
        />
        {loading && (
          <Loader2 className="absolute inset-0 m-auto h-3 w-3 animate-spin text-muted-foreground" />
        )}
      </button>
      <div className="min-w-0">
        <p className="text-sm font-medium leading-none">{label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
    </label>
  );
}
