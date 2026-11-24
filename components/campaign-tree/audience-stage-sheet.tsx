"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { StageSheetPanel } from "@/components/campaign-tree/stage-sheet";
import { Dialog } from "@/components/ui/dialog";
import {
  audienceSheetTitle,
  defaultSelection,
  stageAccount,
  type TreeCampaign,
  type TreeSelection,
  type TreeStage,
} from "@/lib/campaign-tree/tree";
import { useFetchCustomAudiences } from "@/lib/hooks/useMeta";
import { ADSET_TARGETING_WRITES_DISABLED_MESSAGE, LEARNING_PHASE_WARNING } from "@/lib/meta/adset-targeting-copy";

/**
 * "Add audience to…" on a stage (RC6). Pick an audience, keep or change the
 * ticks, and the button writes it onto every ticked ad set through the
 * existing targeting write (POST /api/meta/adset-audience, include + add,
 * commit), one call per campaign and batch of 12 ad sets. Behind the same
 * switch (OFFPIXEL_META_ADSET_TARGETING_WRITES_ENABLED), on the same ledger
 * (`adset_targeting_update`), each run logged once per campaign in
 * campaign_additions by the route.
 */

const BATCH = 12;

interface AudienceResult {
  adSetId: string;
  adSetName: string | null;
  outcome: "written" | "noop" | "refused" | "failed";
  reason: string | null;
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
  const [results, setResults] = useState<AudienceResult[] | null>(null);
  const runId = useMemo(() => crypto.randomUUID(), []);

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
    const all: AudienceResult[] = [];
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
          const json = (await res.json().catch(() => ({}))) as { error?: string; results?: AudienceResult[] };
          if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
          all.push(...(json.results ?? []));
        }
      }
      setResults(all);
      if (all.every((r) => r.outcome === "written" || r.outcome === "noop")) {
        onDone();
        onClose();
      }
    } catch (err) {
      setResults(all);
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose} panelClassName="max-w-xl">
      <div className="max-h-[88vh] overflow-y-auto">
        <StageSheetPanel
          title={audienceSheetTitle(audience?.name ?? null, stage)}
          campaigns={campaigns}
          selection={selection}
          onSelection={setSelection}
          onCancel={onClose}
          onConfirm={() => void confirm()}
          busy={busy || !audience}
          blocked={writesEnabled ? null : ADSET_TARGETING_WRITES_DISABLED_MESSAGE}
          error={error ?? audiences.error}
          before={
            <label className="mb-4 block text-xs font-medium">
              Audience
              <select
                className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                value={audienceId}
                onChange={(event) => setAudienceId(event.target.value)}
              >
                <option value="">{audiences.loading ? "Loading audiences…" : "Select an audience"}</option>
                {audiences.data.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          }
          after={
            <>
              <p className="mt-4 text-xs text-amber-800 dark:text-amber-300">{LEARNING_PHASE_WARNING}</p>
              {results && results.some((r) => r.outcome !== "written" && r.outcome !== "noop") ? (
                <ul className="mt-3 space-y-1 text-xs">
                  {results.map((r) => (
                    <li key={r.adSetId}>
                      {r.adSetName || r.adSetId}: {r.outcome}
                      {r.reason ? ` — ${r.reason}` : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          }
        />
      </div>
    </Dialog>
  );
}
