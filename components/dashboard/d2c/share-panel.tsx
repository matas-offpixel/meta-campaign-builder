"use client";

import { useState, useTransition } from "react";

import { createShare, revokeShare } from "@/lib/actions/d2c-share";

/**
 * components/dashboard/d2c/share-panel.tsx
 *
 * Operator share controls (top-right of the dashboard). Generate a public
 * read-only link, copy it, or revoke it (destructive → inline confirm).
 * Rendered only on the operator page — never on the public share view.
 */

export function SharePanel({
  eventId,
  initialShareUrl,
  initialShareId,
}: {
  eventId: string;
  initialShareUrl: string | null;
  initialShareId: string | null;
}) {
  const [url, setUrl] = useState<string | null>(initialShareUrl);
  const [shareId, setShareId] = useState<string | null>(initialShareId);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [copied, setCopied] = useState(false);

  function handleGenerate() {
    setMessage(null);
    startTransition(async () => {
      const res = await createShare(eventId);
      if (res.ok && res.url) {
        setUrl(res.url);
        setMessage("Share link created.");
      } else {
        setMessage(res.error ?? "Could not create link.");
      }
    });
  }

  function handleRevoke() {
    if (!shareId) return;
    setMessage(null);
    startTransition(async () => {
      const res = await revokeShare(shareId, eventId);
      if (res.ok) {
        setUrl(null);
        setShareId(null);
        setConfirmRevoke(false);
        setMessage("Share link revoked.");
      } else {
        setMessage(res.error ?? "Could not revoke link.");
      }
    });
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setMessage("Copy failed — select the URL manually.");
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-semibold text-foreground">Public share</h2>
      {url ? (
        <div className="mt-2 space-y-2">
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs"
            />
            <button
              type="button"
              onClick={copy}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-muted"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          {confirmRevoke ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                Revoke this link? It will stop working immediately.
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={handleRevoke}
                className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-800 transition hover:bg-red-50 disabled:opacity-50"
              >
                Confirm revoke
              </button>
              <button
                type="button"
                onClick={() => setConfirmRevoke(false)}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-muted"
              >
                Keep
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmRevoke(true)}
              className="text-xs font-medium text-red-700 hover:underline"
            >
              Revoke share
            </button>
          )}
        </div>
      ) : (
        <div className="mt-2">
          <p className="mb-2 text-xs text-muted-foreground">
            Generate a read-only link clients can open without signing in.
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={handleGenerate}
            className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Generating…" : "Generate share link"}
          </button>
        </div>
      )}
      {message && (
        <p className="mt-2 text-xs text-muted-foreground" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
