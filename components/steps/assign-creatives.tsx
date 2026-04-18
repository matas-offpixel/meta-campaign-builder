"use client";

import { useEffect, useMemo, useRef } from "react";
import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Info } from "lucide-react";
import type {
  AdSetSuggestion,
  AdCreativeDraft,
  CreativeAssignmentMatrix,
} from "@/lib/types";
import { ATTACHED_AD_SET_KEY_PREFIX } from "@/lib/types";

interface AssignCreativesProps {
  adSets: AdSetSuggestion[];
  creatives: AdCreativeDraft[];
  assignments: CreativeAssignmentMatrix;
  onChange: (assignments: CreativeAssignmentMatrix) => void;
  /**
   * When true, render the per-ad card view tailored for the
   * "Add ads to existing ad set(s)" flow. Each ad card lists the selected
   * ad sets as checkboxes (Ad → Ad Sets), and a global notice clarifies
   * that audience / budget / schedule / optimisation are inherited.
   */
  attachAdSetMode?: boolean;
}

export function AssignCreatives({
  adSets,
  creatives,
  assignments,
  onChange,
  attachAdSetMode = false,
}: AssignCreativesProps) {
  const enabledSets = useMemo(() => adSets.filter((s) => s.enabled), [adSets]);

  // ── attach_adset auto-default ───────────────────────────────────────────
  // When the user lands on Assign in attach_adset mode and no assignments
  // have been made yet for the projected synthetic ad set keys, default
  // to "every ad goes into every selected ad set". Only runs once per
  // (mode change × ad-set-id-set) so the user's manual edits aren't
  // overwritten on subsequent renders.
  const seededRef = useRef<string | null>(null);
  useEffect(() => {
    if (!attachAdSetMode) return;
    if (creatives.length === 0 || enabledSets.length === 0) return;

    const fingerprint = enabledSets.map((s) => s.id).sort().join(",");
    if (seededRef.current === fingerprint) return;

    const allEmpty = enabledSets.every(
      (s) => (assignments[s.id] ?? []).length === 0,
    );
    if (!allEmpty) {
      // User already has at least one assignment — respect it.
      seededRef.current = fingerprint;
      return;
    }

    const allCreativeIds = creatives.map((c) => c.id);
    const next: CreativeAssignmentMatrix = { ...assignments };
    for (const s of enabledSets) {
      next[s.id] = allCreativeIds;
    }
    console.log(
      `[AssignCreatives] attach_adset auto-default —` +
        ` ${creatives.length} ad${creatives.length !== 1 ? "s" : ""}` +
        ` × ${enabledSets.length} ad set${enabledSets.length !== 1 ? "s" : ""}`,
    );
    onChange(next);
    seededRef.current = fingerprint;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachAdSetMode, enabledSets, creatives.length]);

  const isAssigned = (adSetId: string, creativeId: string) =>
    (assignments[adSetId] || []).includes(creativeId);

  const toggle = (adSetId: string, creativeId: string) => {
    const current = assignments[adSetId] || [];
    const next = current.includes(creativeId)
      ? current.filter((id) => id !== creativeId)
      : [...current, creativeId];
    onChange({ ...assignments, [adSetId]: next });
  };

  const assignAll = () => {
    const next: CreativeAssignmentMatrix = {};
    enabledSets.forEach((s) => {
      next[s.id] = creatives.map((c) => c.id);
    });
    onChange(next);
  };

  const clearAll = () => {
    const next: CreativeAssignmentMatrix = {};
    enabledSets.forEach((s) => {
      next[s.id] = [];
    });
    onChange(next);
  };

  const assignColumnAll = (creativeId: string) => {
    const next = { ...assignments };
    enabledSets.forEach((s) => {
      const current = next[s.id] || [];
      if (!current.includes(creativeId)) {
        next[s.id] = [...current, creativeId];
      }
    });
    onChange(next);
  };

  const removeColumnAll = (creativeId: string) => {
    const next = { ...assignments };
    enabledSets.forEach((s) => {
      next[s.id] = (next[s.id] || []).filter((id) => id !== creativeId);
    });
    onChange(next);
  };

  const totalAds = useMemo(() => {
    return Object.values(assignments).reduce((sum, ids) => sum + ids.length, 0);
  }, [assignments]);

  if (enabledSets.length === 0 || creatives.length === 0) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h2 className="font-heading text-2xl tracking-wide">Assign Creatives</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {attachAdSetMode
              ? "Pick one or more existing ad sets in Step 1, then add creatives in Step 4."
              : "Mix and match creatives with ad sets before launch."}
          </p>
        </div>
        <Card className="py-10 text-center">
          <p className="text-sm text-muted-foreground">
            {creatives.length === 0
              ? "Add creatives first, then assign them to ad sets."
              : attachAdSetMode
                ? "Pick at least one existing ad set in Step 1 to continue."
                : "Generate and enable ad sets in Budget & Schedule first."}
          </p>
        </Card>
      </div>
    );
  }

  // ─── attach_adset card view ──────────────────────────────────────────────
  // One card per ad. Each card lists the selected ad sets as checkboxes,
  // matching the spec from the product brief:
  //
  //   Ad 1
  //     ☑ Broad
  //     ☑ Retargeting
  //     ☑ LAL
  if (attachAdSetMode) {
    return (
      <div className="mx-auto max-w-4xl space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-heading text-2xl tracking-wide">
              Assign Creatives
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Tick which existing ad sets each new ad should be added to.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={assignAll}>
              Assign all
            </Button>
            <Button variant="ghost" size="sm" onClick={clearAll}>
              Clear all
            </Button>
          </div>
        </div>

        <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary-light/30 px-3 py-2 text-xs">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="text-foreground">
            These ads will inherit each selected ad set&rsquo;s existing
            audience, budget, schedule and optimisation settings.
          </span>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {creatives.map((c, i) => {
            const adLabel = c.name?.trim() || `Ad #${i + 1}`;
            const assignedCount = enabledSets.filter((s) =>
              isAssigned(s.id, c.id),
            ).length;
            return (
              <Card key={c.id} className="space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{adLabel}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {(c.sourceType ?? "new") === "existing_post"
                          ? "post"
                          : "new"}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      Added to{" "}
                      <span className="font-medium text-foreground">
                        {assignedCount}
                      </span>{" "}
                      of {enabledSets.length} ad set
                      {enabledSets.length !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => assignColumnAll(c.id)}
                      className="rounded px-1.5 py-0.5 text-[10px] text-primary hover:underline"
                    >
                      All
                    </button>
                    <span className="text-muted-foreground">·</span>
                    <button
                      type="button"
                      onClick={() => removeColumnAll(c.id)}
                      className="rounded px-1.5 py-0.5 text-[10px] text-destructive hover:underline"
                    >
                      None
                    </button>
                  </div>
                </div>

                <ul className="space-y-1">
                  {enabledSets.map((adSet) => {
                    const checked = isAssigned(adSet.id, c.id);
                    return (
                      <li key={adSet.id}>
                        <label
                          className={`flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-1.5 transition-colors
                            ${checked
                              ? "border-primary bg-primary-light/40"
                              : "border-border hover:bg-muted/50"}`}
                        >
                          <span
                            className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                              checked
                                ? "border-primary bg-primary text-background"
                                : "border-border-strong bg-background"
                            }`}
                            aria-hidden
                          >
                            {checked && (
                              <Check className="h-3 w-3" strokeWidth={3} />
                            )}
                          </span>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggle(adSet.id, c.id)}
                            className="sr-only"
                          />
                          <div className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-medium">
                              {adSet.name}
                            </span>
                            {adSet.metaAdSetId && (
                              <code className="mt-0.5 inline-block rounded bg-muted px-1 py-0 text-[9px] text-muted-foreground">
                                {adSet.metaAdSetId}
                              </code>
                            )}
                          </div>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            );
          })}
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/50 px-4 py-3">
          <span className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{totalAds} ads</span>{" "}
            will be created
          </span>
          <span className="text-sm text-muted-foreground">
            {creatives.length} creative{creatives.length !== 1 ? "s" : ""} ×{" "}
            {enabledSets.length} ad set{enabledSets.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>
    );
  }

  // ─── Standard matrix view (used for "new" + "attach_campaign" modes) ────
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-heading text-2xl tracking-wide">Assign Creatives</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose which creatives run in each ad set.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={assignAll}>Assign All</Button>
          <Button variant="ghost" size="sm" onClick={clearAll}>Clear All</Button>
        </div>
      </div>

      <Card className="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Ad Set</th>
              {creatives.map((c, i) => (
                <th key={c.id} className="px-3 py-3 text-center min-w-[120px]">
                  <div className="text-xs font-semibold">{c.name || `Ad #${i + 1}`}</div>
                  <div className="mt-1 flex justify-center gap-1">
                    <button
                      type="button"
                      onClick={() => assignColumnAll(c.id)}
                      className="text-[10px] text-primary hover:underline"
                    >
                      All
                    </button>
                    <span className="text-muted-foreground">·</span>
                    <button
                      type="button"
                      onClick={() => removeColumnAll(c.id)}
                      className="text-[10px] text-destructive hover:underline"
                    >
                      None
                    </button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {enabledSets.map((adSet) => (
              <tr key={adSet.id} className="border-b border-border last:border-b-0 hover:bg-muted/30">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{adSet.name}</span>
                    {adSet.id.startsWith(ATTACHED_AD_SET_KEY_PREFIX) ? (
                      <Badge variant="primary" className="text-[10px]">existing ad set</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">{adSet.sourceType.replace("_", " ")}</Badge>
                    )}
                  </div>
                </td>
                {creatives.map((c) => {
                  const assigned = isAssigned(adSet.id, c.id);
                  return (
                    <td key={c.id} className="px-3 py-3 text-center">
                      <button
                        type="button"
                        onClick={() => toggle(adSet.id, c.id)}
                        className={`mx-auto flex h-8 w-8 items-center justify-center rounded-md transition-colors
                          ${assigned ? "bg-foreground text-background" : "border border-border-strong hover:bg-card"}`}
                      >
                        {assigned && <Check className="h-4 w-4" strokeWidth={3} />}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="flex items-center justify-between rounded-lg border border-border bg-muted/50 px-4 py-3">
        <span className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{totalAds} ads</span> will be created
        </span>
        <span className="text-sm text-muted-foreground">
          {creatives.length} creative{creatives.length !== 1 ? "s" : ""} × {enabledSets.length} ad set{enabledSets.length !== 1 ? "s" : ""}
        </span>
      </div>
    </div>
  );
}
