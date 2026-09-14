"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import {
  TIKTOK_LIVE_CAMPAIGN_KIND_LABEL,
  type TikTokLiveCampaignKind,
  type TikTokLiveCampaignRow,
} from "@/lib/tiktok/import/types";
import type { TikTokAccount } from "@/lib/types/tiktok";

export function TikTokImportPicker({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [accounts, setAccounts] = useState<TikTokAccount[]>([]);
  const [advertiserId, setAdvertiserId] = useState("");
  const [campaigns, setCampaigns] = useState<TikTokLiveCampaignRow[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingAccounts(true);
    setError(null);
    fetch("/api/tiktok/accounts", { cache: "no-store" })
      .then((res) => res.json())
      .then((json: { ok?: boolean; accounts?: TikTokAccount[] }) => {
        if (cancelled) return;
        const next = (json.ok ? json.accounts ?? [] : []).filter(
          (account) => account.tiktok_advertiser_id,
        );
        setAccounts(next);
        if (next.length === 1 && next[0]?.tiktok_advertiser_id) {
          setAdvertiserId(next[0].tiktok_advertiser_id);
        }
      })
      .catch(() => {
        if (!cancelled) setError("Could not load TikTok accounts.");
      })
      .finally(() => {
        if (!cancelled) setLoadingAccounts(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !advertiserId) {
      setCampaigns([]);
      return;
    }
    let cancelled = false;
    setLoadingCampaigns(true);
    setError(null);
    fetch(
      `/api/tiktok/campaigns?advertiserId=${encodeURIComponent(advertiserId)}`,
      { cache: "no-store" },
    )
      .then((res) => res.json())
      .then((json: { ok?: boolean; campaigns?: TikTokLiveCampaignRow[]; error?: string }) => {
        if (cancelled) return;
        if (!json.ok) {
          setCampaigns([]);
          setError(json.error || "Could not list campaigns.");
          return;
        }
        setCampaigns(json.campaigns ?? []);
      })
      .catch(() => {
        if (!cancelled) setError("Could not list campaigns.");
      })
      .finally(() => {
        if (!cancelled) setLoadingCampaigns(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, advertiserId]);

  async function importCampaign(campaignId: string) {
    setImportingId(campaignId);
    setError(null);
    try {
      const res = await fetch("/api/tiktok/campaigns/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ advertiserId, campaignId }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        draft?: { id?: string };
      };
      if (!json.ok || !json.draft?.id) {
        setError(json.error || "Import failed.");
        return;
      }
      onClose();
      router.push(`/tiktok-campaign/${json.draft.id}`);
    } catch {
      setError("Import failed.");
    } finally {
      setImportingId(null);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} panelClassName="max-w-2xl">
      <DialogContent>
        <DialogHeader onClose={onClose}>
          <DialogTitle>Import from TikTok</DialogTitle>
          <DialogDescription>
            Read a live campaign into the creator. The source campaign is not
            touched. Launch later creates a new paused campaign without
            enhancements.
          </DialogDescription>
        </DialogHeader>

        <Select
          id="tiktok-import-advertiser"
          label="Advertiser"
          value={advertiserId}
          onChange={(event) => setAdvertiserId(event.target.value)}
          disabled={loadingAccounts}
          placeholder={loadingAccounts ? "Loading advertisers…" : "Select advertiser"}
          options={accounts.map((account) => ({
            value: account.tiktok_advertiser_id ?? "",
            label: `${account.account_name} (${account.tiktok_advertiser_id})`,
          }))}
        />

        {error && (
          <p className="mt-3 text-sm text-destructive">{error}</p>
        )}

        <div className="mt-4 max-h-[28rem] overflow-auto rounded-md border border-border">
          {loadingCampaigns ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : campaigns.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              {advertiserId
                ? "No campaigns on this advertiser."
                : "Pick an advertiser to list campaigns."}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Objective</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {campaigns.map((campaign) => (
                  <tr key={campaign.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-medium">{campaign.name}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {campaign.objective ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      <KindBadge kind={campaign.kind} />
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {campaign.status ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={importingId !== null}
                        onClick={() => void importCampaign(campaign.id)}
                      >
                        {importingId === campaign.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          "Import"
                        )}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function KindBadge({ kind }: { kind: TikTokLiveCampaignKind }) {
  const tone =
    kind === "manual"
      ? "bg-emerald-500/10 text-emerald-700"
      : kind === "smart_plus"
        ? "bg-amber-500/10 text-amber-800"
        : "bg-orange-500/10 text-orange-800";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${tone}`}>
      {TIKTOK_LIVE_CAMPAIGN_KIND_LABEL[kind]}
    </span>
  );
}
