"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import type { TikTokImportPickerPayload } from "@/lib/tiktok/import/picker";
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
  const [readingId, setReadingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<TikTokImportPickerPayload | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) {
      setPicker(null);
      setTicked(new Set());
      setError(null);
      return;
    }
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
    setPicker(null);
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

  async function readCampaign(campaignId: string) {
    setReadingId(campaignId);
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
        saved?: boolean;
        picker?: TikTokImportPickerPayload;
      };
      if (!json.ok || json.saved || !json.picker) {
        setError(json.error || "Could not read the campaign.");
        return;
      }
      setPicker(json.picker);
      setTicked(
        new Set(
          json.picker.rows
            .filter((row) => row.defaultTicked && !row.disabled)
            .map((row) => row.key),
        ),
      );
    } catch {
      setError("Could not read the campaign.");
    } finally {
      setReadingId(null);
    }
  }

  async function confirmImport() {
    if (!picker || ticked.size === 0) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/tiktok/campaigns/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          advertiserId,
          campaignId: picker.campaign.id,
          carry: [...ticked],
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        saved?: boolean;
        draft?: { id?: string };
      };
      if (!json.ok || !json.saved || !json.draft?.id) {
        setError(json.error || "Nothing was saved. Tick at least one creative.");
        return;
      }
      onClose();
      router.push(`/tiktok-campaign/${json.draft.id}`);
    } catch {
      setError("Import failed.");
    } finally {
      setSaving(false);
    }
  }

  const enabledCount = useMemo(
    () => picker?.rows.filter((row) => !row.disabled).length ?? 0,
    [picker],
  );

  return (
    <Dialog open={open} onClose={onClose} panelClassName="max-w-3xl">
      <DialogContent>
        <DialogHeader onClose={onClose}>
          <DialogTitle>Import from TikTok</DialogTitle>
          <DialogDescription>
            {picker
              ? "Tick what to carry. The pattern default is a suggestion — a row is never removed."
              : "Read a live campaign into the creator. The source campaign is not touched. Launch later creates a new paused campaign without enhancements."}
          </DialogDescription>
        </DialogHeader>

        {!picker && (
          <>
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

            {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

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
                            disabled={readingId !== null}
                            onClick={() => void readCampaign(campaign.id)}
                          >
                            {readingId === campaign.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              "Read"
                            )}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}

        {picker && (
          <>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm">
                <span className="font-medium">{picker.campaign.name}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {TIKTOK_LIVE_CAMPAIGN_KIND_LABEL[picker.campaign.kind]} ·{" "}
                  {ticked.size} of {enabledCount} ticked
                </span>
              </p>
              <Button variant="ghost" size="sm" onClick={() => setPicker(null)}>
                Back
              </Button>
            </div>

            {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

            <div className="mt-3 max-h-[28rem] space-y-2 overflow-auto pr-1">
              {picker.rows.map((row) => (
                <label
                  key={row.key}
                  className={`flex gap-3 rounded-md border border-border p-3 ${
                    row.disabled ? "opacity-60" : ""
                  }`}
                >
                  <Checkbox
                    id={`tiktok-import-${row.key}`}
                    checked={ticked.has(row.key)}
                    disabled={row.disabled || saving}
                    onChange={() => {
                      if (row.disabled) return;
                      setTicked((current) => {
                        const next = new Set(current);
                        if (next.has(row.key)) next.delete(row.key);
                        else next.add(row.key);
                        return next;
                      });
                    }}
                  />
                  {row.thumbnailUrl ? (
                    // Signed TikTok cover URLs expire; a missing thumb is fine.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={row.thumbnailUrl}
                      alt=""
                      className="h-14 w-10 shrink-0 rounded object-cover bg-muted"
                    />
                  ) : (
                    <div className="h-14 w-10 shrink-0 rounded bg-muted" />
                  )}
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="font-medium">{row.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {[
                        row.durationSeconds != null
                          ? `${Math.round(row.durationSeconds)}s`
                          : null,
                        row.width && row.height
                          ? `${row.width}×${row.height}`
                          : null,
                        row.assetGroups.length > 0
                          ? row.assetGroups.join(", ")
                          : null,
                        row.inLibrary ? "in library" : "not in library",
                        row.copies > 1 ? `${row.copies} copies on TikTok` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {row.suggestionLabel && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {row.suggestionLabel}
                      </p>
                    )}
                  </div>
                </label>
              ))}
            </div>

            <div className="mt-4 flex justify-end">
              <Button
                disabled={saving}
                onClick={() => void confirmImport()}
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : ticked.size === 0 ? (
                  "Tick at least one creative — nothing will be saved"
                ) : (
                  `Save ${ticked.size} ${ticked.size === 1 ? "creative" : "creatives"}`
                )}
              </Button>
            </div>
          </>
        )}
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
