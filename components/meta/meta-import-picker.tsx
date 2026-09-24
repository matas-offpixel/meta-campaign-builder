"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { MetaImportEventSelect } from "@/components/meta/meta-import-event-select";
import {
  metaImportDraftHref,
  metaImportErrorText,
  metaImportNotCarriedLine,
  metaImportReadBody,
  metaImportSaveBlocked,
  metaImportSaveBody,
} from "@/components/meta/meta-import-flow";
import { MetaImportReport } from "@/components/meta/meta-import-report";
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
import type { MetaImportEventOption } from "@/lib/meta/import/event";
import type { MetaImportPickerPayload } from "@/lib/meta/import/picker";
import {
  META_IMPORT_ACCOUNT_NOT_LINKED,
  type MetaImportMeta,
} from "@/lib/meta/import/types";
import type { MetaAdAccount, MetaCampaignSummary, MetaCampaignsResponse } from "@/lib/types";

type PickerResponse = {
  ok?: boolean;
  saved?: boolean;
  error?: string;
  picker?: MetaImportPickerPayload;
  clientId?: string | null;
  draftId?: string;
  importMeta?: MetaImportMeta;
};

export function MetaImportPicker({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [accounts, setAccounts] = useState<MetaAdAccount[]>([]);
  const [adAccountId, setAdAccountId] = useState("");
  const [campaigns, setCampaigns] = useState<MetaCampaignSummary[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [readingId, setReadingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<MetaImportPickerPayload | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [events, setEvents] = useState<MetaImportEventOption[]>([]);
  const [eventId, setEventId] = useState("");
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<{ draftId: string; importMeta: MetaImportMeta } | null>(null);

  useEffect(() => {
    if (!open) {
      setPicker(null);
      setClientId(null);
      setEvents([]);
      setEventId("");
      setTicked(new Set());
      setSaved(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoadingAccounts(true);
    setError(null);
    fetch("/api/meta/ad-accounts", { cache: "no-store" })
      .then((res) => res.json())
      .then((json: { data?: MetaAdAccount[]; error?: string }) => {
        if (cancelled) return;
        if (json.error) {
          setError(json.error);
          setAccounts([]);
          return;
        }
        const next = json.data ?? [];
        setAccounts(next);
        if (next.length === 1) setAdAccountId(next[0]!.id);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load ad accounts.");
      })
      .finally(() => {
        if (!cancelled) setLoadingAccounts(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !adAccountId) {
      setCampaigns([]);
      return;
    }
    let cancelled = false;
    setLoadingCampaigns(true);
    setError(null);
    setPicker(null);
    const params = new URLSearchParams({ adAccountId, filter: "all", limit: "50" });
    fetch(`/api/meta/campaigns?${params}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((json: MetaCampaignsResponse & { error?: string }) => {
        if (cancelled) return;
        if (json.error) {
          setCampaigns([]);
          setError(json.error);
          return;
        }
        setCampaigns(json.data ?? []);
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
  }, [open, adAccountId]);

  useEffect(() => {
    if (!clientId) {
      setEvents([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/events?clientId=${encodeURIComponent(clientId)}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((json: { ok?: boolean; events?: MetaImportEventOption[]; error?: string }) => {
        if (cancelled) return;
        if (!json.ok) {
          setError(json.error || "Could not load events.");
          setEvents([]);
          return;
        }
        setEvents(json.events ?? []);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load events.");
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  async function readCampaign(campaignId: string) {
    setReadingId(campaignId);
    setError(null);
    try {
      const res = await fetch("/api/meta/campaigns/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(metaImportReadBody(adAccountId, campaignId)),
      });
      const json = (await res.json()) as PickerResponse;
      if (!json.ok || json.saved || !json.picker) {
        setError(metaImportErrorText(json));
        return;
      }
      setPicker(json.picker);
      setClientId(json.clientId ?? null);
      setEventId("");
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
    if (!picker || metaImportSaveBlocked(eventId, ticked.size)) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/meta/campaigns/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          metaImportSaveBody({
            adAccountId,
            campaignId: picker.campaign.id,
            carry: [...ticked],
            eventId,
          }),
        ),
      });
      const json = (await res.json()) as PickerResponse;
      if (!json.ok || !json.saved || !json.draftId || !json.importMeta) {
        setError(metaImportErrorText(json));
        return;
      }
      setSaved({ draftId: json.draftId, importMeta: json.importMeta });
    } catch {
      setError("Could not reach the import route.");
    } finally {
      setSaving(false);
    }
  }

  function openDraft() {
    if (!saved) return;
    const href = metaImportDraftHref(saved.draftId);
    onClose();
    router.push(href);
  }

  const accountUnlinked = picker != null && !clientId;
  const blocked = metaImportSaveBlocked(eventId, ticked.size);
  const uncarriedRows = picker?.rows.filter((row) => row.disabled) ?? [];

  return (
    <Dialog open={open} onClose={onClose} panelClassName="max-w-3xl">
      <DialogContent>
        <DialogHeader onClose={onClose}>
          <DialogTitle>Import from Meta</DialogTitle>
          <DialogDescription>
            {saved
              ? "Saved as a draft. The source campaign was not changed."
              : picker
                ? "Tick what to carry. A creative with no asset stays listed, unticked."
                : "Read a live campaign into a new draft. Nothing is written to the source campaign."}
          </DialogDescription>
        </DialogHeader>

        {!picker && !saved && (
          <>
            <Select
              id="meta-import-account"
              label="Ad account"
              value={adAccountId}
              onChange={(event) => setAdAccountId(event.target.value)}
              disabled={loadingAccounts}
              placeholder={loadingAccounts ? "Loading ad accounts…" : "Select ad account"}
              options={accounts.map((account) => ({
                value: account.id,
                label: `${account.name} (${account.id})`,
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
                  {adAccountId ? "No campaigns on this ad account." : "Pick an ad account to list campaigns."}
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Name</th>
                      <th className="px-3 py-2 font-medium">Objective</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {campaigns.map((campaign) => (
                      <tr key={campaign.id} className="border-b border-border last:border-0">
                        <td className="px-3 py-2 font-medium">{campaign.name}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {campaign.objective || "—"}
                          {!campaign.compatible && campaign.incompatibleReason ? (
                            <span className="mt-0.5 block text-destructive">{campaign.incompatibleReason}</span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{campaign.status || "—"}</td>
                        <td className="px-3 py-2 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={readingId !== null || !campaign.compatible}
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

        {picker && !saved && (
          <>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm">
                <span className="font-medium">{picker.campaign.name}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {picker.adSets.length} ad sets · {ticked.size} ticked
                  {picker.campaign.objective ? ` · ${picker.campaign.objective}` : ""}
                </span>
              </p>
              <Button variant="ghost" size="sm" onClick={() => setPicker(null)}>
                Back
              </Button>
            </div>

            {accountUnlinked ? (
              <p className="mt-3 text-sm text-destructive">{META_IMPORT_ACCOUNT_NOT_LINKED}</p>
            ) : (
              <div className="mt-3">
                <MetaImportEventSelect
                  id="meta-import-event"
                  events={events}
                  value={eventId}
                  onChange={setEventId}
                  disabled={saving || events.length === 0}
                  error={!eventId ? "Pick an event before saving. Nothing is saved until you do." : undefined}
                />
              </div>
            )}

            {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

            {uncarriedRows.length > 0 && (
              <ul className="mt-3 space-y-1 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                {uncarriedRows.map((row) => (
                  <li key={row.key}>
                    {metaImportNotCarriedLine({
                      id: row.key,
                      name: row.name,
                      reason: row.unsupportedReason ?? "no_asset_reported",
                    })}
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-3 max-h-[28rem] space-y-2 overflow-auto pr-1">
              {picker.rows.map((row) => (
                <label
                  key={row.key}
                  className={`flex gap-3 rounded-md border border-border p-3 ${row.disabled ? "opacity-60" : ""}`}
                >
                  <Checkbox
                    id={`meta-import-${row.key}`}
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
                    // Meta thumbnails are remote and may expire.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={row.thumbnailUrl} alt="" className="h-14 w-14 shrink-0 rounded object-cover bg-muted" />
                  ) : (
                    <div className="h-14 w-14 shrink-0 rounded bg-muted" />
                  )}
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="font-medium">{row.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {[
                        row.mediaType,
                        row.copies > 1 ? `${row.copies} copies` : null,
                        row.disabled ? row.unsupportedReason : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                </label>
              ))}
            </div>

            <div className="mt-4 flex justify-end">
              <Button
                disabled={saving || accountUnlinked || blocked}
                onClick={() => void confirmImport()}
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : accountUnlinked ? (
                  META_IMPORT_ACCOUNT_NOT_LINKED
                ) : ticked.size === 0 ? (
                  "Tick at least one creative — nothing will be saved"
                ) : !eventId ? (
                  "Pick an event — nothing will be saved"
                ) : (
                  `Save ${ticked.size} ${ticked.size === 1 ? "creative" : "creatives"}`
                )}
              </Button>
            </div>
          </>
        )}

        {saved && (
          <>
            <MetaImportReport meta={saved.importMeta} adSetCount={picker?.adSets.length ?? 0} />
            <div className="mt-4 flex justify-end">
              <Button onClick={openDraft}>Open draft</Button>
            </div>
          </>
        )}

      </DialogContent>
    </Dialog>
  );
}
