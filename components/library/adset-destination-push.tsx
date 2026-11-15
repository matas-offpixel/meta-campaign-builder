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
import { ADSET_DESTINATION_WRITES_DISABLED_MESSAGE } from "@/lib/meta/adset-destination-copy";
import type { CampaignListItem, MetaAdSetSummary } from "@/lib/types";

interface DestinationResult {
  adSetId: string;
  adSetName: string | null;
  outcome: "ready" | "written" | "noop" | "refused" | "failed";
  reason: string | null;
  diff: string | null;
  before: string | null;
  after: string | null;
}

/**
 * "Set website destination" on a published row. Reads each selected ad set's
 * current destination, shows what would change, and writes
 * `destination_type: "WEBSITE"` and nothing else.
 *
 * Gated by the same switch as the audience push
 * (`OFFPIXEL_META_ADSET_TARGETING_WRITES_ENABLED`). The button stays visible
 * and disabled when it is off, so an operator can see the action exists.
 */
export function AdSetDestinationPush({
  campaign,
  writesEnabled,
  open: openControlled,
  onOpenChange,
}: {
  campaign: CampaignListItem;
  writesEnabled: boolean | null;
  /** When set, the parent owns the dialog and this component renders no trigger. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const canWrite = writesEnabled === true;
  const controlled = openControlled !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const dialogOpen = controlled ? Boolean(openControlled) : uncontrolledOpen;

  function setDialogOpen(next: boolean) {
    if (controlled) onOpenChange?.(next);
    else setUncontrolledOpen(next);
  }
  const [metaCampaignId, setMetaCampaignId] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [selected, setSelected] = useState<MetaAdSetSummary[]>([]);
  const [planned, setPlanned] = useState<DestinationResult[] | null>(null);
  const [applied, setApplied] = useState<DestinationResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!dialogOpen) return;
    let cancelled = false;
    loadDraftById(campaign.id).then((draft) => {
      if (cancelled) return;
      const metaId = draft?.metaCampaignId?.trim() || null;
      setMetaCampaignId(metaId);
      setDraftError(metaId ? null : "This campaign has no Meta campaign id.");
    });
    return () => {
      cancelled = true;
    };
  }, [dialogOpen, campaign.id]);

  function clearResults() {
    setPlanned(null);
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

  async function send(commit: boolean) {
    if (!canWrite || selected.length === 0) return;
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/meta/adset-destination", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: campaign.id,
          adSetIds: selected.map((adSet) => adSet.id),
          commit,
        }),
      });
      const json = (await res.json()) as { error?: string; results?: DestinationResult[] };
      if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
      if (commit) {
        setApplied(json.results ?? []);
      } else {
        setPlanned(json.results ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const results = applied ?? planned;
  const wouldChange = (planned ?? []).filter((row) => row.outcome === "ready").length;

  return (
    <>
      {!controlled && (
        <Button
          size="sm"
          variant="outline"
          disabled={!canWrite}
          title={
            writesEnabled === true
              ? "Set the ad sets' destination to Website"
              : writesEnabled === false
                ? ADSET_DESTINATION_WRITES_DISABLED_MESSAGE
                : "Checking the ad-set write gate"
          }
          onClick={() => {
            if (!canWrite) return;
            setDialogOpen(true);
          }}
        >
          Set website destination
        </Button>
      )}
      {dialogOpen && (
        <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} panelClassName="max-w-2xl">
          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <DialogHeader onClose={() => setDialogOpen(false)}>
              <DialogTitle>Set website destination</DialogTitle>
              <DialogDescription>
                {campaign.name || "Published campaign"}. Writes{" "}
                <code>destination_type: WEBSITE</code> onto the selected ad sets and changes
                nothing else. An ad set launched without a destination reads back as
                {" "}<code>UNDEFINED</code>, and Ads Manager then shows a destination the
                launcher never chose.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {writesEnabled !== true && (
                <p className="text-sm text-muted-foreground">
                  {writesEnabled === false
                    ? ADSET_DESTINATION_WRITES_DISABLED_MESSAGE
                    : "Checking the ad-set write gate"}
                </p>
              )}
              {draftError && <p className="text-sm text-destructive">{draftError}</p>}

              {metaCampaignId && (
                <CrossCampaignAdSetPicker
                  campaigns={[{ id: metaCampaignId, name: campaign.name || metaCampaignId }]}
                  selectedIds={selected.map((adSet) => adSet.id)}
                  onToggle={onToggle}
                />
              )}

              {error && <p className="text-sm text-destructive">{error}</p>}

              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="outline"
                  disabled={!canWrite || selected.length === 0 || busy || Boolean(draftError)}
                  onClick={() => void send(false)}
                >
                  {busy && !applied ? "Checking…" : "Check current destination"}
                </Button>
                <Button
                  disabled={
                    !canWrite ||
                    selected.length === 0 ||
                    busy ||
                    Boolean(draftError) ||
                    planned === null ||
                    wouldChange === 0
                  }
                  title={
                    planned === null
                      ? "Check the current destination first"
                      : wouldChange === 0
                        ? "Every selected ad set is already set to Website"
                        : `Write WEBSITE onto ${wouldChange} ad set(s)`
                  }
                  onClick={() => void send(true)}
                >
                  {busy && planned ? "Writing…" : "Set to Website"}
                </Button>
              </div>

              {results && (
                <ul className="space-y-2 text-sm">
                  {results.map((row) => (
                    <li key={row.adSetId}>
                      {row.adSetName || row.adSetId}: {row.outcome}
                      {row.diff ? ` — ${row.diff}` : ""}
                      {row.reason ? ` — ${row.reason}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
