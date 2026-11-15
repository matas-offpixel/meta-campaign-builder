"use client";

import { CardDescription, Datum, StatusLine, StepSurfaceProvider, type StepSurface } from "@/components/steps/step-surface";
import { CheckCircle2, AlertTriangle, Loader2, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { parseBidModifierInput } from "@/lib/google-search/bid-modifier";
import {
  addEmptyGeoRow,
  applyGeoResolution,
  createGeoResolveSession,
  editGeoBid,
  editGeoLocation,
  geoResolutionIsTrusted,
  geoRowsFromTargets,
  removeGeoRow,
  setGeoResolveUi,
  syncGeoRows,
  type GeoResolveMatch,
  type GeoResolveUi,
  type GeoRowModel,
} from "@/lib/google-search/geo-row-state";
import { updateCampaign, updatePlan } from "@/lib/google-search/tree-mutations";
import {
  type GoogleSearchGeoTargetType,
  type GoogleSearchPlanTree,
} from "@/lib/google-search/types";

interface Props {
  surface?: StepSurface;
  tree: GoogleSearchPlanTree;
  onChange: (next: GoogleSearchPlanTree) => void;
}

export function TargetingBudgetStep({ surface = "wizard", tree, onChange }: Props) {
  const total = tree.plan.total_budget ?? 0;
  const allocated = tree.campaigns.reduce((s, c) => s + (c.monthly_budget ?? 0), 0);
  const remaining = total - allocated;

  const [rows, setRows] = useState(() => geoRowsFromTargets(tree.plan.geo_targets));
  const rowsRef = useRef(rows);
  const treeRef = useRef(tree);
  const ownedTreeRef = useRef(tree);

  function emit(updater: (current: GoogleSearchPlanTree) => GoogleSearchPlanTree) {
    const next = updater(treeRef.current);
    treeRef.current = next;
    ownedTreeRef.current = next;
    onChange(next);
  }

  function commitRows(nextRows: GeoRowModel[]) {
    rowsRef.current = nextRows;
    setRows(nextRows);
    emit((current) => updatePlan(current, { geo_targets: nextRows.map((row) => row.geo) }));
  }

  useEffect(() => {
    if (tree === ownedTreeRef.current) {
      treeRef.current = tree;
      return;
    }
    const synced = syncGeoRows(rowsRef.current, tree.plan.geo_targets);
    rowsRef.current = synced;
    treeRef.current = tree;
    ownedTreeRef.current = tree;
    setRows(synced);
  }, [tree]);

  return (
    <StepSurfaceProvider surface={surface}>
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Location targeting</CardTitle>
          <CardDescription>
            How Google matches users to your locations. <strong>Presence</strong> only targets
            people physically in (or regularly in) your locations — recommended for ticketed
            events. <strong>Presence or interest</strong> also includes people who&apos;ve shown
            interest in your locations (Google&apos;s default, wasteful for events).
          </CardDescription>
        </CardHeader>
        <GeoTargetTypeToggle
          value={tree.plan.geo_target_type}
          onChange={(next) => emit((current) => updatePlan(current, { geo_target_type: next }))}
        />
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Geo targets</CardTitle>
          <CardDescription>
            Locations to target, with optional bid modifier (positive = boost, negative = damp).
            Each location is resolved against Google&apos;s geo database as you type.
          </CardDescription>
        </CardHeader>

        {rows.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            No geo targets — campaigns will use account defaults.
            <div className="mt-3">
              <Button variant="outline" size="sm" onClick={() => commitRows(addEmptyGeoRow(rowsRef.current))}>
                <Plus className="h-3.5 w-3.5" />
                Add geo
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <table className="min-w-full text-sm">
              <thead className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-2 py-1">Location</th>
                  <th className="w-40 px-2 py-1">Bid modifier (%)</th>
                  <th className="w-10 px-2 py-1"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <GeoRow
                    key={row.id}
                    row={row}
                    accountId={tree.plan.google_ads_account_id ?? null}
                    onLocationChange={(id, value) => commitRows(editGeoLocation(rowsRef.current, id, value))}
                    onBidChange={(id, bid) => commitRows(editGeoBid(rowsRef.current, id, bid))}
                    onResolveResult={(id, requested, result, warning) => {
                      const next = applyGeoResolution(rowsRef.current, id, requested, result, warning);
                      if (next === rowsRef.current) return;
                      commitRows(next);
                    }}
                    onResolveUi={(id, ui) => {
                      const next = setGeoResolveUi(rowsRef.current, id, ui);
                      if (next === rowsRef.current) return;
                      rowsRef.current = next;
                      setRows(next);
                    }}
                    onRemove={(id) => commitRows(removeGeoRow(rowsRef.current, id))}
                  />
                ))}
              </tbody>
            </table>
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={() => commitRows(addEmptyGeoRow(rowsRef.current))}>
                <Plus className="h-3.5 w-3.5" />
                Add geo
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Budget allocation</CardTitle>
          <CardDescription>
            Total: £{total.toFixed(2)} • Allocated: £{allocated.toFixed(2)} • Remaining: £
            {remaining.toFixed(2)}
            {tree.plan.bidding_strategy === "maximize_clicks" && (
              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-900">
                Maximise Clicks — no conversion tracking, budget pacing is best-effort
              </span>
            )}
          </CardDescription>
        </CardHeader>

        {tree.campaigns.length === 0 ? (
          <Datum className="text-xs text-muted-foreground">No campaigns yet.</Datum>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-2 py-1">Campaign</th>
                <th className="w-40 px-2 py-1">Monthly £</th>
                <th className="w-40 px-2 py-1">Daily £ (optional)</th>
              </tr>
            </thead>
            <tbody>
              {tree.campaigns.map((c) => (
                <tr key={c.id} className="border-t border-border align-middle">
                  <td className="px-2 py-1 text-sm">{c.name || "(unnamed)"}</td>
                  <td className="px-2 py-1">
                    <Input
                      aria-label={`Monthly budget for ${c.name}`}
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min={0}
                      value={c.monthly_budget ?? ""}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const num = raw === "" ? null : Number(raw);
                        emit((current) =>
                          updateCampaign(current, c.id, {
                            monthly_budget: Number.isFinite(num) ? (num as number | null) : null,
                          }),
                        );
                      }}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <Input
                      aria-label={`Daily budget for ${c.name}`}
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min={0}
                      value={c.daily_budget ?? ""}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const num = raw === "" ? null : Number(raw);
                        emit((current) =>
                          updateCampaign(current, c.id, {
                            daily_budget: Number.isFinite(num) ? (num as number | null) : null,
                          }),
                        );
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
      </StepSurfaceProvider>
  );
}

const DEBOUNCE_MS = 450;

function GeoRow({
  row,
  accountId,
  onLocationChange,
  onBidChange,
  onResolveResult,
  onResolveUi,
  onRemove,
}: {
  row: GeoRowModel;
  accountId: string | null;
  onLocationChange: (id: string, value: string) => void;
  onBidChange: (id: string, bid: number | null) => void;
  onResolveResult: (
    id: string,
    requestedLocation: string,
    result: GeoResolveMatch | null,
    warning?: string,
  ) => void;
  onResolveUi: (id: string, ui: GeoResolveUi) => void;
  onRemove: (id: string) => void;
}) {
  const sessionRef = useRef(createGeoResolveSession());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onResolveResultRef = useRef(onResolveResult);
  const onResolveUiRef = useRef(onResolveUi);
  const accountIdRef = useRef(accountId);
  onResolveResultRef.current = onResolveResult;
  onResolveUiRef.current = onResolveUi;
  accountIdRef.current = accountId;
  const rowId = row.id;

  async function resolveLocation(location: string) {
    const account = accountIdRef.current;
    const trimmed = location.trim();
    if (!account) {
      onResolveUiRef.current(rowId, { status: "no_account" });
      return;
    }
    if (!trimmed) {
      onResolveUiRef.current(rowId, { status: "idle" });
      return;
    }

    const controller = sessionRef.current.start();
    onResolveUiRef.current(rowId, { status: "loading" });

    try {
      const res = await fetch("/api/google-search/resolve-geo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ location: trimmed, google_ads_account_id: account }),
        signal: controller.signal,
      });
      const json = (await res.json()) as
        | { ok: true; matches: Array<{ canonicalName: string; resourceName: string }> }
        | { ok: false; reason: string; warning?: string };

      if (controller.signal.aborted) return;

      if (json.ok && json.matches.length > 0) {
        const top = json.matches[0];
        onResolveResultRef.current(rowId, trimmed, {
          resourceName: top.resourceName,
          canonicalName: top.canonicalName,
        });
      } else {
        onResolveResultRef.current(
          rowId,
          trimmed,
          null,
          json.ok ? undefined : json.warning,
        );
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      if (err instanceof Error && err.name === "AbortError") return;
      onResolveResultRef.current(rowId, trimmed, null);
    }
  }

  function handleLocationChange(value: string) {
    sessionRef.current.abort();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    onLocationChange(rowId, value);
    if (!value.trim()) return;
    debounceRef.current = setTimeout(() => {
      void resolveLocation(value);
    }, DEBOUNCE_MS);
  }

  useEffect(() => {
    const session = sessionRef.current;
    if (!geoResolutionIsTrusted(row.geo) && row.geo.location.trim()) {
      const location = row.geo.location;
      debounceRef.current = setTimeout(() => {
        void resolveLocation(location);
      }, DEBOUNCE_MS);
    }
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      session.abort();
    };
    // Resolve once for an unresolved or mismatched row. Later keystrokes
    // schedule their own request and abort this one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <tr className="border-t border-border align-top">
      <td className="px-2 py-1">
        <Input
          aria-label={`Geo ${row.geo.location} location`}
          value={row.geo.location}
          onChange={(e) => handleLocationChange(e.target.value)}
          placeholder="London, England, United Kingdom"
        />
        <GeoResolveHint state={row.resolve} />
      </td>
      <td className="px-2 py-1">
        <Input
          aria-label={`Geo ${row.geo.location} bid modifier`}
          type="text"
          inputMode="numeric"
          value={row.geo.bid_modifier_pct ?? ""}
          onChange={(e) => {
            onBidChange(rowId, parseBidModifierInput(e.target.value));
          }}
          placeholder="+20"
        />
      </td>
      <td className="px-2 py-1 text-right">
        <Button variant="ghost" size="sm" onClick={() => onRemove(rowId)} aria-label="Remove geo">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </td>
    </tr>
  );
}

function GeoResolveHint({ state }: { state: GeoResolveUi }) {
  if (state.status === "idle") return null;

  if (state.status === "loading") {
    return (
      <Datum className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
        Resolving…
      </Datum>
    );
  }

  if (state.status === "matched") {
    return (
      <Datum className="mt-0.5 flex items-center gap-1 text-[10px] text-emerald-700">
        <CheckCircle2 className="h-2.5 w-2.5" />
        {state.canonicalName}
      </Datum>
    );
  }

  if (state.status === "no_match") {
    return (
      <StatusLine className="mt-0.5 flex items-center gap-1 text-[10px] text-amber-700">
        <AlertTriangle className="h-2.5 w-2.5" />
        {state.warning ?? `No match for “${state.attempted}” — check spelling`}
      </StatusLine>
    );
  }

  if (state.status === "no_account") {
    return (
      <Datum className="mt-0.5 text-[10px] text-muted-foreground">
        Link a Google Ads account to preview resolution
      </Datum>
    );
  }

  return null;
}

function GeoTargetTypeToggle({
  value,
  onChange,
}: {
  value: GoogleSearchGeoTargetType;
  onChange: (next: GoogleSearchGeoTargetType) => void;
}) {
  const options: Array<{
    id: GoogleSearchGeoTargetType;
    title: string;
    subtitle: string;
    badge?: string;
  }> = [
    {
      id: "PRESENCE",
      title: "Presence",
      subtitle: "People physically in or regularly in your locations.",
      badge: "Recommended",
    },
    {
      id: "PRESENCE_OR_INTEREST",
      title: "Presence or interest",
      subtitle:
        "Also includes people who've shown interest in your locations (Google's default).",
    },
  ];
  return (
    <div role="radiogroup" aria-label="Location targeting" className="grid gap-2 sm:grid-cols-2">
      {options.map((opt) => {
        const active = opt.id === value;
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.id)}
            className={`flex flex-col items-start gap-1 rounded-md border p-3 text-left text-sm transition-colors ${
              active
                ? "border-primary bg-primary/5 text-foreground"
                : "border-border bg-background text-muted-foreground hover:border-border-strong hover:text-foreground"
            }`}
          >
            <div className="flex items-center gap-2">
              <span className={`font-medium ${active ? "text-foreground" : ""}`}>{opt.title}</span>
              {opt.badge ? (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-900">
                  {opt.badge}
                </span>
              ) : null}
            </div>
            <Datum className="text-xs">{opt.subtitle}</Datum>
          </button>
        );
      })}
    </div>
  );
}
