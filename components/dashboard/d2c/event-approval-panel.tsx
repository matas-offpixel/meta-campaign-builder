"use client";

import { useState } from "react";

import type { D2CScheduledSend } from "@/lib/d2c/types";
import { ScheduledSendRow } from "./scheduled-send-row";

/**
 * components/dashboard/d2c/event-approval-panel.tsx
 *
 * Matas's per-event approval surface: paste the WhatsApp community URL (the one
 * required runtime input), then approve each scheduled send individually or in
 * bulk. Dry-run badges make the safety state obvious.
 */

export interface EventApprovalPanelProps {
  eventId: string;
  eventName: string;
  artworkUrl: string | null;
  initialCommunityUrl: string | null;
  initialSends: D2CScheduledSend[];
  canApprove: boolean;
}

export function EventApprovalPanel({
  eventId,
  eventName,
  artworkUrl,
  initialCommunityUrl,
  initialSends,
  canApprove,
}: EventApprovalPanelProps) {
  const [sends, setSends] = useState<D2CScheduledSend[]>(initialSends);
  const [communityUrl, setCommunityUrl] = useState(initialCommunityUrl ?? "");
  const [savingUrl, setSavingUrl] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const pending = sends.filter((s) => s.approval_status === "pending_approval");

  async function saveCommunityUrl() {
    setSavingUrl(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/d2c/event/${eventId}/community-url`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ community_url: communityUrl.trim() }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setMessage(json.error ?? "Failed to save community URL.");
      } else {
        setMessage("Community URL saved.");
      }
    } catch {
      setMessage("Network error saving community URL.");
    } finally {
      setSavingUrl(false);
    }
  }

  async function approveOne(id: string): Promise<boolean> {
    const res = await fetch(`/api/d2c/scheduled/${id}/approve`, {
      method: "PATCH",
    });
    const json = await res.json();
    if (res.ok && json.ok && json.send) {
      setSends((prev) => prev.map((s) => (s.id === id ? json.send : s)));
      return true;
    }
    setMessage(json.error ?? "Failed to approve send.");
    return false;
  }

  async function handleApprove(id: string) {
    setBusyId(id);
    setMessage(null);
    await approveOne(id);
    setBusyId(null);
  }

  async function handleBulkApprove() {
    setBulkBusy(true);
    setMessage(null);
    let ok = 0;
    for (const s of pending) {
      const done = await approveOne(s.id);
      if (done) ok += 1;
    }
    setMessage(`Approved ${ok} of ${pending.length} pending sends.`);
    setBulkBusy(false);
  }

  return (
    <div className="space-y-6">
      {artworkUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={artworkUrl}
          alt={`${eventName} artwork`}
          className="max-h-48 rounded-lg border border-border object-contain"
        />
      )}

      <section className="rounded-lg border border-border bg-card p-4">
        <label
          htmlFor="community-url"
          className="block text-sm font-medium text-foreground"
        >
          WhatsApp community URL
        </label>
        <p className="mt-1 text-xs text-muted-foreground">
          The only required runtime input. Pasted into the community early-access
          send via the <code>{"{{community_url}}"}</code> token.
        </p>
        <div className="mt-2 flex gap-2">
          <input
            id="community-url"
            type="url"
            value={communityUrl}
            onChange={(e) => setCommunityUrl(e.target.value)}
            placeholder="https://chat.whatsapp.com/…"
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={savingUrl}
            onClick={saveCommunityUrl}
            className="rounded-md border border-border px-3 py-2 text-sm font-medium transition hover:bg-muted disabled:opacity-50"
          >
            {savingUrl ? "Saving…" : "Save"}
          </button>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">
            Scheduled sends ({sends.length})
          </h2>
          {canApprove && pending.length > 0 && (
            <button
              type="button"
              disabled={bulkBusy}
              onClick={handleBulkApprove}
              className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition hover:opacity-90 disabled:opacity-50"
            >
              {bulkBusy ? "Approving…" : `Approve all (${pending.length})`}
            </button>
          )}
        </div>

        {sends.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No scheduled sends yet.
          </p>
        ) : (
          <div className="space-y-2">
            {sends.map((s) => (
              <ScheduledSendRow
                key={s.id}
                send={s}
                canApprove={canApprove}
                busy={busyId === s.id || bulkBusy}
                onApprove={handleApprove}
              />
            ))}
          </div>
        )}

        {!canApprove && (
          <p className="text-xs text-muted-foreground">
            You are not on the D2C approver allowlist — approvals are disabled.
          </p>
        )}
      </section>

      {message && (
        <p className="text-xs text-muted-foreground" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
