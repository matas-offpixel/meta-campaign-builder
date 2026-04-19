"use client";

import { useEffect, useState } from "react";
import { Loader2, Music2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import type { TikTokAccount } from "@/lib/types/tiktok";

interface Props {
  eventId: string;
  /**
   * Server-resolved current TikTok account FK on the event row. Null
   * when the event is not yet linked. Once Slice 5 lands, the linker
   * dropdown also accepts the inherited client-level account as a
   * fallback — for now we link directly per-event.
   */
  initialTikTokAccountId: string | null;
}

const TIKTOK_PINK = "#FF0050";

const PLACEHOLDER_STATS: ReadonlyArray<{ label: string }> = [
  { label: "Impressions" },
  { label: "Reach" },
  { label: "Spend" },
  { label: "Video Views" },
  { label: "Clicks" },
  { label: "CPM" },
  { label: "CPC" },
  { label: "CTR" },
];

/**
 * TikTok reporting tab — placeholder. Mirrors the Meta tab layout.
 *
 * Two states:
 *   - No account linked: shows a dropdown populated by GET
 *     /api/tiktok/accounts (returns [] until accounts are seeded).
 *     Linking is a no-op until the API persistence is wired (TODO).
 *   - Linked: shows the placeholder StatCard grid + a banner stating
 *     reporting is coming soon, branded with the TikTok pink.
 */
export function TikTokReportTab({
  eventId,
  initialTikTokAccountId,
}: Props) {
  const [accountId, setAccountId] = useState<string | null>(
    initialTikTokAccountId,
  );
  const [accounts, setAccounts] = useState<TikTokAccount[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [linkingPending, setLinkingPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (accountId !== null) return; // only need the picker when unlinked
    setLoading(true);
    fetch("/api/tiktok/accounts")
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json?.ok) {
          setAccounts(json.accounts as TikTokAccount[]);
        } else {
          setAccounts([]);
        }
      })
      .catch(() => {
        if (!cancelled) setAccounts([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  const handleLink = async (newAccountId: string) => {
    if (!newAccountId) return;
    setLinkingPending(true);
    setError(null);
    // No persistence wired yet — eventually this PATCHes events with
    // tiktok_account_id. For now we mirror the optimistic state so the
    // UI flips to "linked but coming soon" without a round-trip.
    setAccountId(newAccountId);
    setLinkingPending(false);
  };

  const linkedAccount = accountId
    ? accounts?.find((a) => a.id === accountId) ?? null
    : null;

  // ── Unlinked state ─────────────────────────────────────────────────
  if (!accountId) {
    return (
      <section className="rounded-md border border-border bg-card p-5">
        <div className="mb-3 flex items-start gap-3">
          <Music2 className="mt-0.5 h-4 w-4" style={{ color: TIKTOK_PINK }} />
          <div className="min-w-0">
            <h2 className="font-heading text-base tracking-wide">TikTok</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Link this event to a TikTok account to surface paid spend
              and creative performance alongside Meta.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading TikTok accounts…
          </div>
        ) : accounts && accounts.length > 0 ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-56 flex-1">
              <Select
                id={`tiktok-link-${eventId}`}
                label="Link TikTok account"
                placeholder="Select an account…"
                options={accounts.map((a) => ({
                  value: a.id,
                  label: a.account_name,
                }))}
                onChange={(e) => handleLink(e.target.value)}
                disabled={linkingPending}
                defaultValue=""
              />
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No TikTok account linked. Add one in Settings → TikTok once
            the platform OAuth flow is connected.
          </p>
        )}

        {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
      </section>
    );
  }

  // ── Linked state (still placeholder) ───────────────────────────────
  return (
    <div className="space-y-6">
      <section className="rounded-md border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Music2
              className="mt-0.5 h-4 w-4"
              style={{ color: TIKTOK_PINK }}
            />
            <div className="min-w-0">
              <h2 className="font-heading text-base tracking-wide">TikTok</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Linked to{" "}
                <span className="font-medium text-foreground">
                  {linkedAccount?.account_name ?? "a TikTok account"}
                </span>
                . Live reporting coming soon — reach, video views and
                spend will surface here once the OAuth + insights flow
                is wired.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setAccountId(null)}
          >
            Unlink
          </Button>
        </div>
      </section>

      <section
        className="grid grid-cols-2 gap-3 md:grid-cols-4"
        aria-label="TikTok placeholder stats"
      >
        {PLACEHOLDER_STATS.map((stat) => (
          <PlaceholderStatCard key={stat.label} label={stat.label} />
        ))}
      </section>
    </div>
  );
}

function PlaceholderStatCard({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold text-muted-foreground">—</p>
    </div>
  );
}
