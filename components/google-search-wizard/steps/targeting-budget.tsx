"use client";

import { CheckCircle2, AlertTriangle, Loader2, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { parseBidModifierInput } from "@/lib/google-search/bid-modifier";
import { updateCampaign, updatePlan } from "@/lib/google-search/tree-mutations";
import {
  type GoogleSearchGeoTarget,
  type GoogleSearchGeoTargetType,
  type GoogleSearchPlanTree,
} from "@/lib/google-search/types";

interface Props {
  tree: GoogleSearchPlanTree;
  onChange: (next: GoogleSearchPlanTree) => void;
}

export function TargetingBudgetStep({ tree, onChange }: Props) {
  const total = tree.plan.total_budget ?? 0;
  const allocated = tree.campaigns.reduce((s, c) => s + (c.monthly_budget ?? 0), 0);
  const remaining = total - allocated;

  function setGeo(next: GoogleSearchGeoTarget[]) {
    onChange(updatePlan(tree, { geo_targets: next }));
  }

  function addGeo() {
    setGeo([...tree.plan.geo_targets, { location: "United Kingdom", bid_modifier_pct: null }]);
  }
  function updateGeo(index: number, patch: Partial<GoogleSearchGeoTarget>) {
    setGeo(tree.plan.geo_targets.map((g, i) => (i === index ? { ...g, ...patch } : g)));
  }
  function removeGeo(index: number) {
    setGeo(tree.plan.geo_targets.filter((_, i) => i !== index));
  }

  return (
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
          onChange={(next) => onChange(updatePlan(tree, { geo_target_type: next }))}
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

        {tree.plan.geo_targets.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            No geo targets — campaigns will use account defaults.
            <div className="mt-3">
              <Button variant="outline" size="sm" onClick={addGeo}>
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
                {tree.plan.geo_targets.map((g, i) => (
                  <GeoRow
                    key={i}
                    index={i}
                    geo={g}
                    accountId={tree.plan.google_ads_account_id ?? null}
                    onUpdate={(patch) => updateGeo(i, patch)}
                    onRemove={() => removeGeo(i)}
                  />
                ))}
              </tbody>
            </table>
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={addGeo}>
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
          <p className="text-xs text-muted-foreground">No campaigns yet.</p>
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
                        onChange(
                          updateCampaign(tree, c.id, {
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
                        onChange(
                          updateCampaign(tree, c.id, {
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
  );
}

// ─── GeoRow ───────────────────────────────────────────────────────────

type ResolveStatus = "idle" | "loading" | "matched" | "no_match" | "no_account";

interface ResolveState {
  status: ResolveStatus;
  /** Present when status === 'matched'. Canonical name from Google. */
  canonicalName?: string;
  /** Present when status === 'no_match'. The attempted location string. */
  attempted?: string;
}

interface GeoRowProps {
  index: number;
  geo: GoogleSearchGeoTarget;
  accountId: string | null;
  onUpdate: (patch: Partial<GoogleSearchGeoTarget>) => void;
  onRemove: () => void;
}

const DEBOUNCE_MS = 450;

function GeoRow({ geo, accountId, onUpdate, onRemove }: GeoRowProps) {
  const [resolveState, setResolveState] = useState<ResolveState>(() => {
    // If the geo entry was already resolved (loaded from DB), show it.
    if (geo.resolved_resource_name && geo.resolved_name) {
      return { status: "matched", canonicalName: geo.resolved_name };
    }
    return { status: "idle" };
  });

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const resolveLocation = useCallback(
    async (location: string) => {
      if (!accountId) {
        setResolveState({ status: "no_account" });
        return;
      }
      const trimmed = location.trim();
      if (!trimmed) {
        setResolveState({ status: "idle" });
        return;
      }

      // Cancel any in-flight request.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setResolveState({ status: "loading" });

      try {
        const res = await fetch("/api/google-search/resolve-geo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ location: trimmed, google_ads_account_id: accountId }),
          signal: controller.signal,
        });
        const json = (await res.json()) as
          | { ok: true; matches: Array<{ canonicalName: string; resourceName: string }> }
          | { ok: false; reason: string };

        if (json.ok && json.matches.length > 0) {
          const top = json.matches[0];
          setResolveState({ status: "matched", canonicalName: top.canonicalName });
          // Store the resolved IDs on the tree so the push adapter can skip re-resolution.
          onUpdate({
            resolved_resource_name: top.resourceName,
            resolved_name: top.canonicalName,
          });
        } else {
          setResolveState({ status: "no_match", attempted: trimmed });
          onUpdate({ resolved_resource_name: null, resolved_name: null });
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setResolveState({ status: "no_match", attempted: trimmed });
      }
    },
    [accountId, onUpdate],
  );

  // Debounce: trigger resolve 450ms after the user stops typing.
  function handleLocationChange(value: string) {
    onUpdate({ location: value, resolved_resource_name: null, resolved_name: null });
    setResolveState({ status: "loading" });

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void resolveLocation(value);
    }, DEBOUNCE_MS);
  }

  // On mount, resolve if the entry doesn't already have a pre-resolved ID.
  useEffect(() => {
    if (!geo.resolved_resource_name && geo.location.trim()) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void resolveLocation(geo.location);
      }, DEBOUNCE_MS);
    }
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
    // Run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <tr className="border-t border-border align-top">
      <td className="px-2 py-1">
        <Input
          aria-label={`Geo ${geo.location} location`}
          value={geo.location}
          onChange={(e) => handleLocationChange(e.target.value)}
          placeholder="London, England, United Kingdom"
        />
        <GeoResolveHint state={resolveState} />
      </td>
      <td className="px-2 py-1">
        <Input
          aria-label={`Geo ${geo.location} bid modifier`}
          type="text"
          inputMode="numeric"
          value={geo.bid_modifier_pct ?? ""}
          onChange={(e) => {
            onUpdate({ bid_modifier_pct: parseBidModifierInput(e.target.value) });
          }}
          placeholder="+20"
        />
      </td>
      <td className="px-2 py-1 text-right">
        <Button variant="ghost" size="sm" onClick={onRemove} aria-label="Remove geo">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </td>
    </tr>
  );
}

function GeoResolveHint({ state }: { state: ResolveState }) {
  if (state.status === "idle") return null;

  if (state.status === "loading") {
    return (
      <p className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
        Resolving…
      </p>
    );
  }

  if (state.status === "matched") {
    return (
      <p className="mt-0.5 flex items-center gap-1 text-[10px] text-emerald-700">
        <CheckCircle2 className="h-2.5 w-2.5" />
        {state.canonicalName}
      </p>
    );
  }

  if (state.status === "no_match") {
    return (
      <p className="mt-0.5 flex items-center gap-1 text-[10px] text-amber-700">
        <AlertTriangle className="h-2.5 w-2.5" />
        No match for &ldquo;{state.attempted}&rdquo; — check spelling
      </p>
    );
  }

  if (state.status === "no_account") {
    return (
      <p className="mt-0.5 text-[10px] text-muted-foreground">
        Link a Google Ads account to preview resolution
      </p>
    );
  }

  return null;
}

// ─── GeoTargetTypeToggle ──────────────────────────────────────────────

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
            <p className="text-xs">{opt.subtitle}</p>
          </button>
        );
      })}
    </div>
  );
}
