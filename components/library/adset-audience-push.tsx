"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CrossCampaignAdSetPicker } from "@/components/steps/cross-campaign-adset-picker";
import { loadDraftById } from "@/lib/db/drafts";
import { useFetchCustomAudiences } from "@/lib/hooks/useMeta";
import {
  ADSET_TARGETING_WRITES_DISABLED_MESSAGE,
  LEARNING_PHASE_WARNING,
  type AudienceListAction,
  type AudienceListDirection,
} from "@/lib/meta/adset-targeting-copy";
import type { CampaignListItem, MetaAdSetSummary } from "@/lib/types";

interface AudiencePushResult {
  adSetId: string;
  adSetName: string | null;
  outcome: "ready" | "written" | "noop" | "refused" | "failed";
  reason: string | null;
  diff: string | null;
}

export function AdSetAudiencePush({
  campaign,
  writesEnabled,
}: {
  campaign: CampaignListItem;
  writesEnabled: boolean | null;
}) {
  const open = writesEnabled === true;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [metaCampaignId, setMetaCampaignId] = useState<string | null>(null);
  const [adAccountId, setAdAccountId] = useState<string | undefined>(
    campaign.adAccountId ?? undefined,
  );
  const [draftError, setDraftError] = useState<string | null>(null);
  const [selected, setSelected] = useState<MetaAdSetSummary[]>([]);
  const [audienceId, setAudienceId] = useState("");
  const [direction, setDirection] = useState<AudienceListDirection>("include");
  const [action, setAction] = useState<AudienceListAction>("add");
  const [preview, setPreview] = useState<AudiencePushResult[] | null>(null);
  const [applied, setApplied] = useState<AudiencePushResult[] | null>(null);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audiences = useFetchCustomAudiences(dialogOpen ? adAccountId : undefined);
  const fetchedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!dialogOpen) return;
    let cancelled = false;
    loadDraftById(campaign.id).then((draft) => {
      if (cancelled) return;
      const metaId = draft?.metaCampaignId?.trim() || null;
      setMetaCampaignId(metaId);
      setAdAccountId(draft?.settings.adAccountId || campaign.adAccountId || undefined);
      setDraftError(metaId ? null : "This campaign has no Meta campaign id.");
    });
    return () => {
      cancelled = true;
    };
  }, [dialogOpen, campaign.id, campaign.adAccountId]);

  useEffect(() => {
    if (!dialogOpen) {
      fetchedFor.current = null;
      return;
    }
    if (!adAccountId) return;
    const key = `${campaign.id}:${adAccountId}`;
    if (fetchedFor.current === key) return;
    fetchedFor.current = key;
    audiences.fetch();
  }, [dialogOpen, adAccountId, campaign.id, audiences.fetch]);

  function resetPreview() {
    setPreview(null);
    setApplied(null);
    setError(null);
  }

  function onToggle(adSet: MetaAdSetSummary) {
    setSelected((current) => {
      const exists = current.some((item) => item.id === adSet.id);
      return exists ? current.filter((item) => item.id !== adSet.id) : [...current, adSet];
    });
    resetPreview();
  }

  const audience = audiences.data.find((item) => item.id === audienceId) ?? null;
  const readyCount = preview?.filter((row) => row.outcome === "ready").length ?? 0;

  async function post(commit: boolean) {
    if (!open || !audience) return;
    setBusy(commit ? "apply" : "preview");
    setError(null);
    try {
      const res = await fetch("/api/meta/adset-audience", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: campaign.id,
          audienceId: audience.id,
          audienceName: audience.name,
          direction,
          action,
          adSetIds: selected.map((adSet) => adSet.id),
          commit,
        }),
      });
      const json = (await res.json()) as { error?: string; results?: AudiencePushResult[] };
      if (!res.ok || json.error) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      if (commit) setApplied(json.results ?? []);
      else setPreview(json.results ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="outline"
        disabled={!open}
        title={
          writesEnabled === true
            ? "Add audience to ad sets"
            : writesEnabled === false
              ? ADSET_TARGETING_WRITES_DISABLED_MESSAGE
              : "Checking the targeting write gate"
        }
        onClick={() => {
          if (!open) return;
          setDialogOpen(true);
        }}
      >
        Add audience to ad sets
      </Button>
      {writesEnabled === false && (
        <p className="max-w-[18rem] text-right text-[10px] leading-snug text-muted-foreground">
          {ADSET_TARGETING_WRITES_DISABLED_MESSAGE}
        </p>
      )}
      {dialogOpen && open && (
        <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} panelClassName="max-w-2xl">
          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <DialogHeader onClose={() => setDialogOpen(false)}>
              <DialogTitle>Add audience to ad sets</DialogTitle>
              <DialogDescription>
                {campaign.name || "Published campaign"}. Remove uses the same read and writes the
                list without this audience.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="flex gap-2">
                <ModeButton current={action} value="add" onPick={(value) => { setAction(value); resetPreview(); }}>
                  Add
                </ModeButton>
                <ModeButton current={action} value="remove" onPick={(value) => { setAction(value); resetPreview(); }}>
                  Remove
                </ModeButton>
                <ModeButton current={direction} value="include" onPick={(value) => { setDirection(value); resetPreview(); }}>
                  Include
                </ModeButton>
                <ModeButton current={direction} value="exclude" onPick={(value) => { setDirection(value); resetPreview(); }}>
                  Exclude
                </ModeButton>
              </div>

              {draftError && <p className="text-sm text-destructive">{draftError}</p>}

              <label className="block text-xs font-medium">
                Audience
                <select
                  className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  value={audienceId}
                  onChange={(event) => {
                    setAudienceId(event.target.value);
                    resetPreview();
                  }}
                >
                  <option value="">
                    {audiences.loading ? "Loading audiences…" : "Select an audience"}
                  </option>
                  {audiences.data.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              {audiences.error && <p className="text-xs text-destructive">{audiences.error}</p>}

              {metaCampaignId && (
                <CrossCampaignAdSetPicker
                  campaigns={[{ id: metaCampaignId, name: campaign.name || metaCampaignId }]}
                  selectedIds={selected.map((adSet) => adSet.id)}
                  onToggle={onToggle}
                />
              )}

              {error && <p className="text-sm text-destructive">{error}</p>}

              {preview && (
                <div className="space-y-2">
                  <p className="text-sm text-amber-800 dark:text-amber-300">{LEARNING_PHASE_WARNING}</p>
                  <ul className="space-y-1 text-sm">
                    {preview.map((row) => (
                      <li key={row.adSetId}>
                        {row.diff ?? `${row.adSetName || row.adSetId}: ${row.reason}`}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {applied && (
                <ul className="space-y-1 text-sm">
                  {applied.map((row) => (
                    <li key={row.adSetId}>
                      {row.adSetName || row.adSetId}: {row.outcome}
                      {row.reason ? ` — ${row.reason}` : ""}
                      {row.diff ? ` — ${row.diff}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                disabled={!audience || selected.length === 0 || busy !== null || Boolean(draftError)}
                onClick={() => {
                  if (!open) return;
                  void post(false);
                }}
              >
                {busy === "preview" ? "Reading…" : "Show diff"}
              </Button>
              <Button
                disabled={!open || readyCount === 0 || busy !== null}
                onClick={() => {
                  if (!open) return;
                  void post(true);
                }}
              >
                {busy === "apply" ? "Writing…" : action === "remove" ? "Remove" : "Confirm"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function ModeButton<T extends string>({
  current,
  value,
  onPick,
  children,
}: {
  current: T;
  value: T;
  onPick: (value: T) => void;
  children: string;
}) {
  const selected = current === value;
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onPick(value)}
      className={`rounded-md border px-2.5 py-1 text-xs ${
        selected ? "border-foreground bg-foreground text-background" : "border-border text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
