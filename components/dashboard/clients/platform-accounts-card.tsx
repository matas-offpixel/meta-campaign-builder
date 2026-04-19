"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ExternalLink, Search, Music2 } from "lucide-react";

import { Select } from "@/components/ui/select";
import type { TikTokAccount } from "@/lib/types/tiktok";
import type { GoogleAdsAccount } from "@/lib/types/google-ads";

interface Props {
  /**
   * Initial selected accounts as resolved on the client row. Both are
   * read via an unknown-cast at the parent boundary because the
   * underlying columns (clients.tiktok_account_id,
   * clients.google_ads_account_id) only exist after migration 018 has
   * been applied.
   */
  initialTikTokAccountId: string | null;
  initialGoogleAdsAccountId: string | null;
  /** Existing flat-text channel IDs already present on the client row. */
  metaBusinessId: string | null;
  metaAdAccountId: string | null;
  metaPixelId: string | null;
}

/**
 * Read-only summary of the platform accounts wired into a client.
 *
 * Linker UI is deferred to the per-platform settings pages once the
 * tiktok_accounts / google_ads_accounts tables hold real rows — there
 * is nothing to pick from yet, so a dropdown here would always be
 * empty. Once accounts exist, swap the placeholder copy for a Select
 * + PATCH /api/clients/[id] flow.
 */
export function PlatformAccountsCard({
  initialTikTokAccountId,
  initialGoogleAdsAccountId,
  metaBusinessId,
  metaAdAccountId,
  metaPixelId,
}: Props) {
  const [tiktokAccounts, setTiktokAccounts] = useState<TikTokAccount[]>([]);
  const [googleAdsAccounts, setGoogleAdsAccounts] = useState<
    GoogleAdsAccount[]
  >([]);
  const [tiktokId, setTiktokId] = useState<string | null>(
    initialTikTokAccountId,
  );
  const [googleAdsId, setGoogleAdsId] = useState<string | null>(
    initialGoogleAdsAccountId,
  );

  useEffect(() => {
    fetch("/api/tiktok/accounts")
      .then((r) => r.json())
      .then((j) => {
        if (j?.ok) setTiktokAccounts(j.accounts as TikTokAccount[]);
      })
      .catch(() => undefined);
    fetch("/api/google-ads/accounts")
      .then((r) => r.json())
      .then((j) => {
        if (j?.ok) setGoogleAdsAccounts(j.accounts as GoogleAdsAccount[]);
      })
      .catch(() => undefined);
  }, []);

  const metaConnected = Boolean(
    metaBusinessId && metaAdAccountId && metaPixelId,
  );

  return (
    <section className="rounded-md border border-border bg-card p-5 space-y-4">
      <div>
        <h2 className="font-heading text-base tracking-wide">
          Platform accounts
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Default platform accounts for every event under this client.
          Events can override on a case-by-case basis from the event
          detail page.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <PlatformRow
          icon={
            <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-[#1877F2] text-[10px] font-bold text-white">
              f
            </span>
          }
          label="Meta"
          status={metaConnected ? "connected" : "missing"}
          details={
            metaConnected
              ? `Ad account ${metaAdAccountId}`
              : "Add BM, ad account & pixel in the edit form."
          }
        />
        <PlatformRow
          icon={<Music2 className="h-4 w-4" style={{ color: "#FF0050" }} />}
          label="TikTok"
          status={tiktokId ? "connected" : "missing"}
          details={
            tiktokId
              ? tiktokAccounts.find((a) => a.id === tiktokId)?.account_name ??
                "Linked"
              : tiktokAccounts.length === 0
                ? "No TikTok accounts seeded yet."
                : "Pick an account below."
          }
          picker={
            tiktokAccounts.length > 0 ? (
              <Select
                id="client-tiktok-account-id"
                value={tiktokId ?? ""}
                onChange={(e) => setTiktokId(e.target.value || null)}
                placeholder="Not linked"
                options={tiktokAccounts.map((a) => ({
                  value: a.id,
                  label: a.account_name,
                }))}
              />
            ) : null
          }
        />
        <PlatformRow
          icon={<Search className="h-4 w-4" style={{ color: "#4285F4" }} />}
          label="Google Ads"
          status={googleAdsId ? "connected" : "missing"}
          details={
            googleAdsId
              ? googleAdsAccounts.find((a) => a.id === googleAdsId)
                  ?.account_name ?? "Linked"
              : googleAdsAccounts.length === 0
                ? "No Google Ads accounts seeded yet."
                : "Pick an account below."
          }
          picker={
            googleAdsAccounts.length > 0 ? (
              <Select
                id="client-google-ads-account-id"
                value={googleAdsId ?? ""}
                onChange={(e) => setGoogleAdsId(e.target.value || null)}
                placeholder="Not linked"
                options={googleAdsAccounts.map((a) => ({
                  value: a.id,
                  label: a.account_name,
                }))}
              />
            ) : null
          }
        />
      </div>

      <p className="text-[11px] text-muted-foreground">
        Persistence wires up once migration 018 is applied + a PATCH
        endpoint lands on <code>/api/clients/[id]</code>. Selections
        here are local-only for now.{" "}
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
        >
          Settings <ExternalLink className="h-3 w-3" />
        </Link>
      </p>
    </section>
  );
}

function PlatformRow({
  icon,
  label,
  status,
  details,
  picker,
}: {
  icon: React.ReactNode;
  label: string;
  status: "connected" | "missing";
  details: string;
  picker?: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border bg-background p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {icon}
          <p className="text-sm font-medium">{label}</p>
        </div>
        <StatusBadge status={status} />
      </div>
      <p className="text-xs text-muted-foreground">{details}</p>
      {picker}
    </div>
  );
}

function StatusBadge({ status }: { status: "connected" | "missing" }) {
  if (status === "connected") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
        <CheckCircle2 className="h-3 w-3" />
        Connected
      </span>
    );
  }
  return (
    <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
      Not configured
    </span>
  );
}
