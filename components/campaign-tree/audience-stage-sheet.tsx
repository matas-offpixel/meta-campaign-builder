"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { StageSheetPanel } from "@/components/campaign-tree/stage-sheet";
import { Dialog } from "@/components/ui/dialog";
import {
  audienceSheetTitle,
  defaultSelection,
  runErrorLine,
  stageAccount,
  type NotAdded,
  type TreeCampaign,
  type TreeSelection,
  type TreeStage,
} from "@/lib/campaign-tree/tree";
import { TREE_WORDS } from "@/lib/campaign-tree/words";
import { useFetchCustomAudiences } from "@/lib/hooks/useMeta";

/**
 * "Add audience to…" on a stage (RC6, RC12; frame RC-G). Pick an audience,
 * keep or change the ticks, and the button writes it onto every ticked ad
 * set through the existing targeting write (POST /api/meta/adset-audience,
 * include + add, commit), one call per campaign and batch of 12 ad sets.
 * Behind its existing switch (OFFPIXEL_META_ADSET_TARGETING_WRITES_ENABLED):
 * off, the sheet ticks as usual and the button is off with "Adding audiences
 * from here is switched off." Same ledger (`adset_targeting_update`); the
 * route logs each run once per campaign in campaign_additions.
 *
 * Every string is a word-list row. A run's outcome is mapped to rows: ad sets
 * that already had it count as added; the rest are listed under "Not added to
 * …"; a run that stopped says how far it got. No server message, outcome code
 * or HTTP status reaches the screen.
 */

const BATCH = 12;

export interface AudienceOption {
  id: string;
  name: string;
}

export function AudienceSheetPanel({
  stage,
  campaigns,
  audiences,
  audiencesLoading = false,
  audienceId,
  onAudience,
  selection,
  onSelection,
  writesEnabled,
  busy = false,
  error = null,
  notAdded = [],
  onCancel,
  onConfirm,
}: {
  stage: TreeStage;
  campaigns: TreeCampaign[];
  audiences: AudienceOption[];
  audiencesLoading?: boolean;
  audienceId: string;
  onAudience: (id: string) => void;
  selection: TreeSelection;
  onSelection: (next: TreeSelection) => void;
  writesEnabled: boolean;
  busy?: boolean;
  error?: string | null;
  notAdded?: NotAdded[];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const audience = audiences.find((a) => a.id === audienceId) ?? null;
  return (
    <StageSheetPanel
      title={audienceSheetTitle(audience?.name ?? null, stage)}
      campaigns={campaigns}
      selection={selection}
      onSelection={onSelection}
      onCancel={onCancel}
      onConfirm={onConfirm}
      busy={busy}
      confirmReady={Boolean(audience)}
      off={writesEnabled ? null : TREE_WORDS["tree.sheet.off.audience"]}
      error={error}
      notAdded={notAdded}
      before={
        <label className="mb-4 block text-xs font-medium">
          {TREE_WORDS["tree.sheet.audience.label"]}
          <select
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            value={audienceId}
            onChange={(event) => onAudience(event.target.value)}
          >
            <option value="">{audiencesLoading ? TREE_WORDS["tree.sheet.audience.loading"] : TREE_WORDS["tree.sheet.audience.placeholder"]}</option>
            {audiences.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      }
      after={<p className="mt-4 text-xs text-amber-800 dark:text-amber-300">{TREE_WORDS["tree.sheet.audience.learning"]}</p>}
    />
  );
}

interface AudienceResult {
  adSetId: string;
  adSetName: string | null;
  outcome: string;
}

/** Route outcomes → RC12: written and noop (already had it) are added; refused and the rest are listed. */
export function audienceNotAdded(results: AudienceResult[], names: Map<string, string>): { added: number; notAdded: NotAdded[] } {
  let added = 0;
  const notAdded: NotAdded[] = [];
  for (const r of results) {
    if (r.outcome === "written" || r.outcome === "noop") added += 1;
    else notAdded.push({ name: names.get(r.adSetId) ?? r.adSetName ?? r.adSetId, kind: r.outcome === "refused" ? "refused" : "failed" });
  }
  return { added, notAdded };
}

export function AudienceStageSheet({
  eventId,
  stage,
  campaigns,
  writesEnabled,
  onClose,
  onDone,
}: {
  eventId: string;
  stage: TreeStage;
  campaigns: TreeCampaign[];
  writesEnabled: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const account = stageAccount(campaigns) ?? undefined;
  const audiences = useFetchCustomAudiences(account);
  const fetched = useRef(false);
  const [audienceId, setAudienceId] = useState("");
  const [selection, setSelection] = useState<TreeSelection>(() => defaultSelection(campaigns));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notAdded, setNotAdded] = useState<NotAdded[]>([]);
  const runId = useMemo(() => crypto.randomUUID(), []);
  const names = useMemo(() => new Map(campaigns.flatMap((c) => c.adSets.map((a) => [a.id, a.name] as const))), [campaigns]);

  useEffect(() => {
    if (fetched.current || !account) return;
    fetched.current = true;
    audiences.fetch();
  }, [account, audiences]);

  const audience = audiences.data.find((a) => a.id === audienceId) ?? null;

  async function confirm() {
    if (!audience || !writesEnabled) return;
    setBusy(true);
    setError(null);
    setNotAdded([]);
    let added = 0;
    const missed: NotAdded[] = [];
    try {
      for (const c of campaigns) {
        const ids = selection[c.metaCampaignId] ?? [];
        if (!c.draftId || ids.length === 0) continue;
        for (let i = 0; i < ids.length; i += BATCH) {
          const res = await fetch("/api/meta/adset-audience", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              draftId: c.draftId,
              audienceId: audience.id,
              audienceName: audience.name,
              direction: "include",
              action: "add",
              adSetIds: ids.slice(i, i + BATCH),
              commit: true,
              addition: { eventId, stage, runId },
            }),
          });
          const json = (await res.json().catch(() => ({}))) as { code?: string; results?: AudienceResult[] };
          if (!res.ok || !json.results) {
            setNotAdded(missed);
            setError(runErrorLine({ added, logUnavailable: json.code === "log_unavailable" }));
            return;
          }
          const outcome = audienceNotAdded(json.results, names);
          added += outcome.added;
          missed.push(...outcome.notAdded);
        }
      }
      if (missed.length === 0) {
        onDone();
        onClose();
        return;
      }
      setNotAdded(missed);
      onDone();
    } catch {
      setNotAdded(missed);
      setError(runErrorLine({ added }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose} panelClassName="max-w-xl">
      <div className="max-h-[88vh] overflow-y-auto">
        <AudienceSheetPanel
          stage={stage}
          campaigns={campaigns}
          audiences={audiences.data}
          audiencesLoading={audiences.loading}
          audienceId={audienceId}
          onAudience={setAudienceId}
          selection={selection}
          onSelection={setSelection}
          writesEnabled={writesEnabled}
          busy={busy}
          error={error}
          notAdded={notAdded}
          onCancel={onClose}
          onConfirm={() => void confirm()}
        />
      </div>
    </Dialog>
  );
}
