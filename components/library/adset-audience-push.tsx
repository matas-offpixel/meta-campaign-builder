"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  outcome: "written" | "noop" | "refused" | "failed";
  reason: string | null;
  diff: string | null;
}

interface AppliedRow extends AudiencePushResult {
  audienceId: string;
  audienceName: string;
  direction: AudienceListDirection;
  appliedAction: AudienceListAction;
}

interface ApplyInput {
  audienceId: string;
  audienceName: string;
  direction: AudienceListDirection;
  action: AudienceListAction;
  adSetIds: string[];
  replace: boolean;
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
  const [applied, setApplied] = useState<AppliedRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audiences = useFetchCustomAudiences(dialogOpen ? adAccountId : undefined);
  const fetchedFor = useRef<string | null>(null);
  const inFlight = useRef(false);

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

  function clearResults() {
    setApplied(null);
    setError(null);
  }

  function onToggle(adSet: MetaAdSetSummary) {
    setSelected((current) => {
      const exists = current.some((item) => item.id === adSet.id);
      return exists ? current.filter((item) => item.id !== adSet.id) : [...current, adSet];
    });
    clearResults();
  }

  const audience = audiences.data.find((item) => item.id === audienceId) ?? null;

  async function apply(input: ApplyInput) {
    if (!open) return;
    if (!input.audienceId || input.adSetIds.length === 0) return;
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setRemovingId(input.replace ? null : (input.adSetIds[0] ?? null));
    setError(null);
    try {
      const res = await fetch("/api/meta/adset-audience", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: campaign.id,
          audienceId: input.audienceId,
          audienceName: input.audienceName,
          direction: input.direction,
          action: input.action,
          adSetIds: input.adSetIds,
          commit: true,
        }),
      });
      const json = (await res.json()) as { error?: string; results?: AudiencePushResult[] };
      if (!res.ok || json.error) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      const stamped: AppliedRow[] = (json.results ?? []).map((row) => ({
        ...row,
        audienceId: input.audienceId,
        audienceName: input.audienceName,
        direction: input.direction,
        appliedAction: input.action,
      }));
      setApplied((current) => {
        if (input.replace || !current) return stamped;
        const byId = new Map(stamped.map((row) => [row.adSetId, row]));
        const merged = current.map((row) => byId.get(row.adSetId) ?? row);
        for (const row of stamped) {
          if (!current.some((item) => item.adSetId === row.adSetId)) merged.push(row);
        }
        return merged;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      inFlight.current = false;
      setBusy(false);
      setRemovingId(null);
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
                {campaign.name || "Published campaign"}. Apply writes this audience onto the
                selected ad sets. Remove on a written row takes it back off that ad set.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="flex gap-2">
                <ModeButton
                  current={action}
                  value="add"
                  onPick={(value) => {
                    setAction(value);
                    clearResults();
                  }}
                >
                  Add
                </ModeButton>
                <ModeButton
                  current={action}
                  value="remove"
                  onPick={(value) => {
                    setAction(value);
                    clearResults();
                  }}
                >
                  Remove
                </ModeButton>
                <ModeButton
                  current={direction}
                  value="include"
                  onPick={(value) => {
                    setDirection(value);
                    clearResults();
                  }}
                >
                  Include
                </ModeButton>
                <ModeButton
                  current={direction}
                  value="exclude"
                  onPick={(value) => {
                    setDirection(value);
                    clearResults();
                  }}
                >
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
                    clearResults();
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

              <div className="flex flex-col items-end gap-1.5">
                <Button
                  disabled={!open || !audience || selected.length === 0 || busy || Boolean(draftError)}
                  onClick={() => {
                    if (!open || !audience) return;
                    void apply({
                      audienceId: audience.id,
                      audienceName: audience.name,
                      direction,
                      action,
                      adSetIds: selected.map((adSet) => adSet.id),
                      replace: true,
                    });
                  }}
                >
                  {busy && !removingId ? "Writing…" : "Apply"}
                </Button>
                <p className="max-w-md text-right text-sm text-amber-800 dark:text-amber-300">
                  {LEARNING_PHASE_WARNING}
                </p>
              </div>

              {applied && (
                <ul className="space-y-2 text-sm">
                  {applied.map((row) => (
                    <li key={row.adSetId} className="flex items-start justify-between gap-3">
                      <p>
                        {row.adSetName || row.adSetId}: {row.outcome}
                        {row.reason ? ` — ${row.reason}` : ""}
                        {row.diff ? ` — ${row.diff}` : ""}
                      </p>
                      {row.outcome === "written" && row.appliedAction === "add" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!open || busy}
                          onClick={() => {
                            if (!open) return;
                            void apply({
                              audienceId: row.audienceId,
                              audienceName: row.audienceName,
                              direction: row.direction,
                              action: "remove",
                              adSetIds: [row.adSetId],
                              replace: false,
                            });
                          }}
                        >
                          {removingId === row.adSetId ? "Removing…" : "Remove"}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
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
