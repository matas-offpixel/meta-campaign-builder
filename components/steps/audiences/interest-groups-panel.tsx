"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SearchInput } from "@/components/ui/search-input";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Plus, Trash2, ChevronDown, ChevronUp, Sparkles, Wand2, Loader2,
  CheckSquare, Square, RefreshCw, AlertTriangle, Lightbulb, Info,
} from "lucide-react";
import type { SuggestedInterest } from "@/app/api/meta/interest-suggestions/route";
import type { InterestGroup, InterestSuggestion, AudienceSettings, MetaApiPage } from "@/lib/types";
import type {
  DiscoverCluster,
  DiscoverResponse,
  AudienceFingerprint,
  AgeRecommendation,
  CustomAudienceSignal,
  GenreDistribution,
} from "@/app/api/meta/interest-discover/route";
import {
  generateInterestGroupsFromAudiences,
  CLUSTER_LABELS,
  inferClusterFromName,
} from "@/lib/interest-suggestions";
import { getCachedUserPages } from "@/lib/hooks/useMeta";
import { readGenreCache } from "@/lib/genre-classification";
import { getSceneHintPresets, type SceneHintPreset } from "@/lib/scene-hint-presets";
import {
  getPersonaPresetsForCluster,
  type PersonaPreset,
} from "@/lib/audience-personas";
import {
  applyTargetabilityResult,
  enrichWithTargetability,
  isMetaConfirmedId,
  validateInterestsTargetability,
  type InterestValidateRequestItem,
} from "@/lib/interest-targetability";

interface DiscoveredItem {
  interest: InterestSuggestion;
  selected: boolean;
}

interface InterestGroupsPanelProps {
  groups: InterestGroup[];
  audiences: AudienceSettings;
  onChange: (groups: InterestGroup[]) => void;
  /** Optional campaign name for richer interest suggestions */
  campaignName?: string;
}

function createEmptyInterestGroup(): InterestGroup {
  return {
    id: crypto.randomUUID(),
    name: "",
    interests: [],
    aiPrompt: "",
  };
}

// ── Known-deprecated names — client-side fast check for chip indicator ──────
const LIKELY_DEPRECATED_NAMES = new Set([
  "metal magazine", "dj magazine", "dj mag", "fact magazine",
  "the sims 2: nightlife", "list of fashion magazines",
  "list of music genres", "music genre", "new rave", "fidget house",
  "electroclash", "heavy metal (magazine)", "heavy metal magazine",
  "mixmag media", "fact (uk magazine)", "ibiza rocks",
]);

function isLikelyDeprecated(name: string): boolean {
  return LIKELY_DEPRECATED_NAMES.has(
    name.toLowerCase().replace(/\s*\([^)]*\)/g, "").trim(),
  );
}

// ── Cluster interest count safety ───────────────────────────────────────────

const CLUSTER_COUNT = { min: 2, recommended: [3, 8], max: 12 } as const;

function clusterCountStatus(count: number): "empty" | "low" | "good" | "high" | "over" {
  if (count === 0) return "empty";
  if (count < CLUSTER_COUNT.min) return "low";
  if (count <= CLUSTER_COUNT.recommended[1]) return "good";
  if (count <= CLUSTER_COUNT.max) return "high";
  return "over";
}

// ── Related interest suggestions hook ────────────────────────────────────────

type SuggestionsEmptyReason =
  | "no_ids"
  | "no_valid_ids"
  | "meta_error"
  | "token_expired"
  | "token_permission"
  | "invalid_request"
  | "network_error"
  | "meta_returned_empty"
  | "all_excluded"
  | "blocklist_filtered"
  | "scored_out"
  | null;

function useRelatedSuggestions(
  selectedInterests: Array<{ id: string; name: string }>,
  cluster: string,
) {
  const [suggestions, setSuggestions] = useState<SuggestedInterest[]>([]);
  const [loading, setLoading] = useState(false);
  const [emptyReason, setEmptyReason] = useState<SuggestionsEmptyReason>(null);
  const [backendError, setBackendError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const realInterests = selectedInterests.filter((i) => /^\d{5,}$/.test(i.id));

    if (realInterests.length === 0) {
      setSuggestions([]);
      setEmptyReason(selectedInterests.length > 0 ? "no_valid_ids" : "no_ids");
      setBackendError(null);

      if (selectedInterests.length > 0) {
        // Some interests selected but none have real Meta IDs — log for debugging
        console.warn(
          "[useRelatedSuggestions] selected interests have no real Meta IDs:",
          selectedInterests.map((i) => `${i.name}(${i.id})`).join(", "),
        );
      }
      return;
    }

    console.info(
      `[useRelatedSuggestions] scheduling fetch — cluster="${cluster}"` +
      `\n  seeds (${realInterests.length}): ${realInterests.map((i) => `${i.name}(${i.id})`).join(", ")}` +
      `\n  non-real IDs dropped: ${selectedInterests.length - realInterests.length}`,
    );

    const timer = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      setBackendError(null);

      // Build the URL manually with explicit repeated params for arrays.
      // Each id and name is appended as ids[]=<val> and names[]=<val>.
      // The URLSearchParams approach encodes [] as %5B%5D which decodes correctly
      // on the server, but we use explicit URLSearchParams to be safe.
      const url = new URL("/api/meta/interest-suggestions", window.location.origin);
      realInterests.forEach((i) => {
        url.searchParams.append("ids[]", i.id);
        url.searchParams.append("names[]", i.name);
      });
      if (cluster) url.searchParams.set("cluster", cluster);

      const urlStr = url.toString();
      console.info(`[useRelatedSuggestions] fetching: ${urlStr.replace(/access_token=[^&]+/, "access_token=…")}`);

      fetch(urlStr, { signal: controller.signal })
        .then(async (res) => {
          const json = (await res.json()) as {
            suggestions?: SuggestedInterest[];
            count?: number;
            error?: string;
            emptyReason?: SuggestionsEmptyReason;
            debug?: Record<string, unknown>;
          };

          console.info(
            `[useRelatedSuggestions] response HTTP ${res.status}:` +
            `\n  suggestions: ${json.count ?? json.suggestions?.length ?? 0}` +
            `\n  emptyReason: ${json.emptyReason ?? "(none)"}` +
            `\n  error: ${json.error ?? "(none)"}` +
            (json.debug ? `\n  debug: ${JSON.stringify(json.debug)}` : ""),
          );

          if (!res.ok || json.error) {
            setBackendError(json.error ?? `HTTP ${res.status}`);
            setEmptyReason(json.emptyReason ?? "meta_error");
            setSuggestions([]);
            return;
          }

          setSuggestions(json.suggestions ?? []);
          setEmptyReason(json.emptyReason ?? null);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          const msg = err instanceof Error ? err.message : String(err);
          console.warn("[useRelatedSuggestions] fetch error:", msg);
          setBackendError(msg);
          setEmptyReason("network_error");
        })
        .finally(() => setLoading(false));
    }, 600);

    return () => {
      clearTimeout(timer);
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedInterests.map((i) => i.id).join(","), cluster]);

  return { suggestions, loading, emptyReason, backendError };
}

function useInterestSearch(query: string) {
  const [results, setResults] = useState<InterestSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      setError(null);
      return;
    }

    const debounce = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      setError(null);

      fetch(`/api/meta/interest-search?q=${encodeURIComponent(query)}`, {
        signal: controller.signal,
      })
        .then(async (res) => {
          const json = (await res.json()) as {
            data?: Array<{ id: string; name: string; audienceSize?: number; path?: string[] }>;
            error?: string;
          };
          if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
          setResults(
            (json.data ?? []).map((item) => ({
              id: item.id,
              name: item.name,
              audienceSize: item.audienceSize,
              path: item.path,
            })),
          );
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setError(err instanceof Error ? err.message : "Search failed");
        })
        .finally(() => setLoading(false));
    }, 300);

    return () => {
      clearTimeout(debounce);
      abortRef.current?.abort();
    };
  }, [query]);

  return { results, loading, error };
}

// ── Unresolved-interest chip with replacement popover ────────────────────────
// Renders a warning-toned chip whose name is a button. Clicking opens a
// dropdown listing up to 5 replacement suggestions (from
// `interest.targetabilityReplacements`, populated by /api/meta/interest-validate)
// plus a "Re-check" action that re-runs validation in place.
//
// The popover handles its own click-outside / Escape state. All persistence
// goes through the parent callbacks (`onReplace` / `onRecheck` / `onRemove`)
// so autosave is triggered the same way as any other selection change.

interface UnresolvedInterestChipProps {
  interest: InterestSuggestion;
  isPending: boolean;
  onReplace: (replacement: { id: string; name: string; audienceSize?: number }) => void;
  onRecheck: () => void;
  onRemove: () => void;
}

function UnresolvedInterestChip({
  interest,
  isPending,
  onReplace,
  onRecheck,
  onRemove,
}: UnresolvedInterestChipProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (wrapperRef.current.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const replacements = interest.targetabilityReplacements ?? [];

  return (
    <span ref={wrapperRef} className="relative inline-flex">
      <span className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2.5 py-1 pr-1 text-xs font-medium text-warning">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-1 rounded outline-none focus-visible:ring-1 focus-visible:ring-warning/60"
          title="Not currently available in Meta targeting — click to fix"
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          {isPending ? (
            <Loader2 className="h-2.5 w-2.5 shrink-0 animate-spin opacity-70" />
          ) : (
            <AlertTriangle className="h-2.5 w-2.5 shrink-0 opacity-70" />
          )}
          <span className="max-w-[180px] truncate underline decoration-dotted underline-offset-2">
            {interest.name}
          </span>
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="ml-0.5 rounded-full p-0.5 opacity-60 hover:opacity-100"
          aria-label={`Remove ${interest.name}`}
        >
          ×
        </button>
      </span>
      {open && (
        <div
          role="dialog"
          className="absolute left-0 top-full z-30 mt-1 w-64 rounded-lg border border-border bg-popover p-2 text-xs shadow-lg"
        >
          <div className="mb-2">
            <p className="truncate text-[12px] font-semibold text-foreground" title={interest.name}>
              {interest.name}
            </p>
            <p className="text-[10px] text-muted-foreground">
              Not currently available in Meta targeting. Will be skipped at launch unless replaced or resolved.
            </p>
          </div>
          {replacements.length > 0 ? (
            <div className="space-y-0.5">
              <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">
                Replace with…
              </p>
              {replacements.slice(0, 5).map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-[11px] hover:bg-muted"
                  onClick={() => {
                    onReplace(r);
                    setOpen(false);
                  }}
                  title={`Swap to "${r.name}"`}
                >
                  <span className="truncate">{r.name}</span>
                  {typeof r.audienceSize === "number" && r.audienceSize > 0 && (
                    <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
                      {Intl.NumberFormat("en", { notation: "compact" }).format(r.audienceSize)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-[10px] italic text-muted-foreground">
              No replacement suggestions available. Try Re-check, or remove this chip.
            </p>
          )}
          <div className="mt-2 flex items-center justify-between border-t border-border pt-1.5">
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-primary disabled:cursor-wait disabled:opacity-50"
              onClick={() => {
                onRecheck();
                setOpen(false);
              }}
              disabled={isPending}
            >
              <RefreshCw className={`h-3 w-3 ${isPending ? "animate-spin" : ""}`} />
              Re-check
            </button>
            <button
              type="button"
              className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-destructive"
              onClick={() => {
                onRemove();
                setOpen(false);
              }}
            >
              Remove
            </button>
          </div>
        </div>
      )}
    </span>
  );
}

// ── Selected interests + related suggestions sub-component ───────────────────
// Extracted as its own component so it can call useRelatedSuggestions
// (hooks cannot be called inside .map() callbacks).

interface GroupInterestSectionProps {
  group: InterestGroup;
  cluster: string;
  onAdd: (interest: InterestSuggestion) => void;
  onRemove: (id: string) => void;
  /** Swap an unresolved chip with one of its targetabilityReplacements. */
  onReplace: (
    interestId: string,
    replacement: { id: string; name: string; audienceSize?: number },
  ) => void;
  /** Force a fresh /api/meta/interest-validate lookup for one chip. */
  onRecheck: (interestId: string) => void;
}

function GroupInterestSection({ group, cluster, onAdd, onRemove, onReplace, onRecheck }: GroupInterestSectionProps) {
  const selectedIds = useMemo(() => new Set(group.interests.map((i) => i.id)), [group.interests]);
  const { suggestions, loading: sugLoading, emptyReason, backendError } = useRelatedSuggestions(group.interests, cluster);

  // Filter suggestions to only those not already selected
  const filteredSuggestions = useMemo(() => {
    const result = suggestions.filter((s) => !selectedIds.has(s.id)).slice(0, 12);

    // Client-side junk-leak assertion — fires if backend exclusion failed
    const JUNK_LEAK = [
      /\bservices?\b/i, /\bfriends?\s+of\b/i, /\bbirthday\b/i,
      /\b(lived|living)\s+in\b/i, /\bfrequent\s*travel\b/i, /\bnewlywed\b/i,
      /\bfacebook\s*access\b/i, /\b(mobile|browser)\s*access\b/i,
      /\bprotective\b/i, /\bhealthcare\b/i, /\binstallation\b/i,
    ];
    for (const s of result) {
      if (JUNK_LEAK.some((p) => p.test(s.name))) {
        console.error(
          `[useRelatedSuggestions] ⚠ JUNK LEAK (client): "${s.name}" [type=${s.suggestionType}] reached the render list. ` +
          `This should have been excluded by the backend. Report this as an exclusion bug.`,
        );
      }
    }

    return result;
  }, [suggestions, selectedIds]);

  const countStatus = clusterCountStatus(group.interests.length);

  const countBannerConfig = {
    empty: null,
    low: { color: "border-warning/40 bg-warning/5 text-warning", icon: <AlertTriangle className="h-3 w-3 shrink-0" />, text: `Add ${CLUSTER_COUNT.min - group.interests.length} more interest${CLUSTER_COUNT.min - group.interests.length !== 1 ? "s" : ""} for a usable cluster (minimum ${CLUSTER_COUNT.min})` },
    good: null,
    high: { color: "border-warning/40 bg-warning/5 text-warning", icon: <Info className="h-3 w-3 shrink-0" />, text: `${group.interests.length} interests — getting crowded. Recommended: 3–8 per cluster.` },
    over: { color: "border-destructive/40 bg-destructive/5 text-destructive", icon: <AlertTriangle className="h-3 w-3 shrink-0" />, text: `${group.interests.length} interests — too many. Split into multiple groups or remove the least relevant ones. Meta may dilute reach.` },
  } as const;

  const banner = countBannerConfig[countStatus];

  return (
    <div className="space-y-3">
      {/* ── Selected chips ─────────────────────────────────────────────── */}
      {group.interests.length > 0 && (
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-sm font-medium">
              Selected Interests
            </label>
            <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${
              countStatus === "good" ? "bg-success/10 text-success" :
              countStatus === "low" ? "bg-warning/10 text-warning" :
              countStatus === "over" ? "bg-destructive/10 text-destructive" :
              countStatus === "high" ? "bg-warning/10 text-warning" :
              "bg-muted text-muted-foreground"
            }`}>
              {group.interests.length} / {CLUSTER_COUNT.recommended[1]} rec.
            </span>
          </div>
          {banner && (
            <div className={`mb-2 flex items-start gap-1.5 rounded-lg border px-3 py-2 text-[11px] ${banner.color}`}>
              {banner.icon}
              <span>{banner.text}</span>
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {group.interests.map((interest) => {
              const deprecated = isLikelyDeprecated(interest.name) || interest.status === "deprecated";
              const targetability = interest.targetabilityStatus;
              const isUnresolved = targetability === "unresolved";
              const isDiscoveryOnly = targetability === "discovery_only";
              const isPending = targetability === "pending";

              // Unresolved chips get the interactive popover so the user can
              // pick a replacement or re-check. Everything else stays as the
              // existing static chip.
              if (isUnresolved) {
                return (
                  <UnresolvedInterestChip
                    key={interest.id}
                    interest={interest}
                    isPending={false}
                    onReplace={(repl) => onReplace(interest.id, repl)}
                    onRecheck={() => onRecheck(interest.id)}
                    onRemove={() => onRemove(interest.id)}
                  />
                );
              }

              const tone = deprecated
                ? "bg-warning/10 border-warning/40 text-warning pr-1"
                : isDiscoveryOnly
                  ? "bg-muted border-border text-muted-foreground pr-1"
                  : isPending
                    ? "bg-muted/50 border-border text-muted-foreground pr-1"
                    : "bg-primary/10 border-primary/30 text-primary pr-1";
              const tooltip = deprecated
                ? "This interest may be deprecated and will be replaced or removed at launch"
                : isDiscoveryOnly
                  ? "Kept as a discovery context seed — not sent to Meta targeting at launch."
                  : isPending
                    ? "Checking Meta targetability…"
                    : undefined;
              return (
                <span
                  key={interest.id}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium border ${tone}`}
                  title={tooltip}
                >
                  {deprecated && (
                    <AlertTriangle className="h-2.5 w-2.5 shrink-0 opacity-70" />
                  )}
                  {isPending && (
                    <Loader2 className="h-2.5 w-2.5 shrink-0 animate-spin opacity-70" />
                  )}
                  <span className="max-w-[180px] truncate">{interest.name}</span>
                  <button
                    type="button"
                    onClick={() => onRemove(interest.id)}
                    className="ml-0.5 rounded-full p-0.5 opacity-60 hover:opacity-100"
                    aria-label={`Remove ${interest.name}`}
                  >
                    ×
                  </button>
                </span>
              );
            })}
          </div>
          {group.interests.some((i) => isLikelyDeprecated(i.name) || i.status === "deprecated") && (
            <p className="mt-1.5 text-[10px] text-warning/80">
              ⚠ Some interests may be deprecated and will be automatically replaced or removed at launch.
            </p>
          )}
          {(() => {
            const unresolvedCount = group.interests.filter(
              (i) => i.targetabilityStatus === "unresolved",
            ).length;
            if (unresolvedCount === 0) return null;
            return (
              <p className="mt-1.5 text-[10px] text-warning/80">
                ⚠ {unresolvedCount} interest{unresolvedCount !== 1 ? "s" : ""} not currently available in Meta targeting — click each chip to swap in a replacement, re-check, or remove. Skipped at launch unless resolved.
              </p>
            );
          })()}
        </div>
      )}

      {/* ── Related suggestions panel ─────────────────────────────────── */}
      {group.interests.length > 0 && (
        <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
          <div className="flex items-center gap-1.5">
            <Lightbulb className="h-3.5 w-3.5 text-primary/70 shrink-0" />
            <span className="text-[11px] font-semibold text-foreground">Related interests</span>
            {sugLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
            <span className="ml-auto text-[10px] text-muted-foreground/60">
              {group.interests.length === 1
                ? "Add more to refine suggestions"
                : "Suggestions based on your selection"}
            </span>
            {/* Debug bypass — fetch without blocklist/path filtering */}
            {(emptyReason === "blocklist_filtered" || emptyReason === "meta_returned_empty" || backendError) && (
              <button
                type="button"
                title="Re-fetch without local filtering (debug)"
                className="text-[9px] text-muted-foreground/40 hover:text-primary underline"
                onClick={() => {
                  const realInterests = group.interests.filter((i) => /^\d{5,}$/.test(i.id));
                  if (realInterests.length === 0) return;
                  const url = new URL("/api/meta/interest-suggestions", window.location.origin);
                  realInterests.forEach((i) => {
                    url.searchParams.append("ids[]", i.id);
                    url.searchParams.append("names[]", i.name);
                  });
                  if (cluster) url.searchParams.set("cluster", cluster);
                  url.searchParams.set("debug", "1");
                  console.info("[interest-suggestions] debug bypass URL:", url.toString());
                  fetch(url.toString()).then((r) => r.json()).then((d) => {
                    console.info("[interest-suggestions] debug bypass result:", JSON.stringify(d, null, 2));
                  });
                }}
              >
                debug raw
              </button>
            )}
          </div>
          {filteredSuggestions.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {filteredSuggestions.map((s) => {
                const sizeColor =
                  (s.audienceSizeBand?.startsWith("micro") || s.audienceSizeBand?.startsWith("niche"))
                    ? "text-success"
                    : s.audienceSizeBand?.startsWith("mega") || s.audienceSizeBand?.startsWith("broad")
                      ? "text-destructive/60"
                      : "text-muted-foreground";
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => onAdd({ id: s.id, name: s.name, audienceSize: s.audienceSize ?? undefined, path: s.path, source: "suggested" })}
                    title={`${s.audienceSizeBand ?? ""}${s.likelyDeprecated ? " · may be deprecated" : ""}`}
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-primary/10 hover:border-primary/40 hover:text-primary ${
                      s.likelyDeprecated
                        ? "border-warning/30 bg-warning/5 text-warning/80"
                        : "border-border bg-white text-foreground"
                    }`}
                  >
                    <Plus className="h-2.5 w-2.5 shrink-0" />
                    <span className="max-w-[160px] truncate">{s.name}</span>
                    {s.audienceSize != null && (
                      <span className={`shrink-0 text-[9px] opacity-60 ${sizeColor}`}>
                        {s.audienceSize >= 1_000_000
                          ? `${(s.audienceSize / 1_000_000).toFixed(1)}M`
                          : s.audienceSize >= 1_000
                            ? `${Math.round(s.audienceSize / 1_000)}K`
                            : s.audienceSize}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ) : sugLoading ? (
            <p className="text-[10px] text-muted-foreground">Fetching suggestions from Meta…</p>
          ) : backendError ? (
            <p className="text-[10px] text-destructive/70">
              {emptyReason === "token_permission"
                ? "Suggestions unavailable — token lacks ads_management permission"
                : emptyReason === "token_expired"
                  ? "Suggestions unavailable — Meta token expired"
                  : emptyReason === "invalid_request"
                    ? "Suggestions unavailable — invalid request to Meta"
                    : `Suggestions unavailable: ${backendError}`}
            </p>
          ) : emptyReason === "meta_returned_empty" ? (
            <p className="text-[10px] text-muted-foreground/60">
              No suggestions returned by Meta for this selection.
            </p>
          ) : emptyReason === "blocklist_filtered" ? (
            <p className="text-[10px] text-muted-foreground/60">
              Suggestions were filtered out by cluster rules — try searching manually above.
            </p>
          ) : emptyReason === "no_valid_ids" ? (
            <p className="text-[10px] text-warning/70">
              Selected interests have no valid Meta IDs yet — suggestions will appear after using Search or Discover.
            </p>
          ) : (
            <p className="text-[10px] text-muted-foreground/60">
              No suggestions available — try searching manually above.
            </p>
          )}
          <p className="text-[9px] text-muted-foreground/40 italic">
            Some suggestions may be replaced or removed at launch if Meta no longer supports them.
          </p>
        </div>
      )}
    </div>
  );
}

export function InterestGroupsPanel({ groups, audiences, onChange, campaignName }: InterestGroupsPanelProps) {
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(
    groups[0]?.id ?? null
  );
  const [searchByGroup, setSearchByGroup] = useState<Record<string, string>>({});
  const [activeSearchGroupId, setActiveSearchGroupId] = useState<string | null>(null);
  const [discoveringGroupId, setDiscoveringGroupId] = useState<string | null>(null);
  const [discoveryError, setDiscoveryError] = useState<Record<string, string | null>>({});
  const [discoveredSuggestions, setDiscoveredSuggestions] = useState<Record<string, DiscoveredItem[]>>({});
  const [discoveredUnmatched, setDiscoveredUnmatched] = useState<Record<string, string[]>>({});

  // Clustered discover-from-pages state (per group)
  const [discoverClusters, setDiscoverClusters] = useState<Record<string, DiscoverCluster[]>>({});
  const [discoverSearchTerms, setDiscoverSearchTerms] = useState<Record<string, string[]>>({});
  const [discoverSceneTags, setDiscoverSceneTags] = useState<Record<string, string[]>>({});
  const [discoveringFromPages, setDiscoveringFromPages] = useState<string | null>(null);
  const [discoverFromPagesError, setDiscoverFromPagesError] = useState<Record<string, string | null>>({});
  // Per-cluster: which interests are checked — keyed by groupId+clusterLabel+interestId
  const [clusterSelections, setClusterSelections] = useState<Record<string, Record<string, boolean>>>({});
  // Scene hints per group — free-text field that maps to scene tags for better discovery
  const [sceneHintsByGroup, setSceneHintsByGroup] = useState<Record<string, string>>({});
  // Tracks the currently-selected scene hint preset chip per group (used for
  // styling the active chip). Cleared when the user types manually.
  const [selectedPresetByGroup, setSelectedPresetByGroup] = useState<Record<string, string>>({});
  // Audience fingerprint returned from the backend per group
  const [fingerprintByGroup, setFingerprintByGroup] = useState<Record<string, AudienceFingerprint>>({});

  const activeSearch = searchByGroup[activeSearchGroupId ?? ""] ?? "";
  const searchState = useInterestSearch(activeSearch);

  const hasPageAudiences = audiences.pageGroups.some((g) => g.pageIds.length > 0);

  // Resolve page context from cache + audiences
  const pageContext = useMemo((): MetaApiPage[] => {
    const cached = getCachedUserPages();
    const selectedIds = new Set(audiences.pageGroups.flatMap((g) => g.pageIds));
    if (selectedIds.size === 0) return cached.slice(0, 10);
    return cached.filter((p) => selectedIds.has(p.id));
  }, [audiences.pageGroups]);

  // Custom audience signals — group names as scene classifiers
  const customAudienceSignals = useMemo((): CustomAudienceSignal[] => {
    return (audiences.customAudienceGroups ?? [])
      .filter((g) => (g.audienceIds?.length ?? 0) > 0)
      .map((g) => ({ name: g.name }));
  }, [audiences.customAudienceGroups]);

  // Engagement types present (from pageGroups that have created engagement audiences)
  const engagementTypesPresent = useMemo((): string[] => {
    const types = new Set<string>();
    for (const g of audiences.pageGroups) {
      if (g.engagementAudiencesByType) {
        for (const t of Object.keys(g.engagementAudiencesByType)) {
          types.add(t);
        }
      }
    }
    return [...types];
  }, [audiences.pageGroups]);

  // Genre distribution: bucket → page count from selected pages' classifications
  const genreDistribution = useMemo((): GenreDistribution => {
    const cache = readGenreCache();
    const selectedIds = audiences.pageGroups.flatMap((g) => g.pageIds);
    const dist: GenreDistribution = {};
    for (const pageId of selectedIds) {
      const c = cache[pageId];
      if (!c) continue;
      for (const [bucket, w] of [
        [c.primaryBucket, 1.0],
        [c.secondaryBucket, 0.5],
        [c.tertiaryBucket, 0.25],
      ] as [string | undefined, number][]) {
        if (bucket) {
          dist[bucket] = (dist[bucket] ?? 0) + w;
        }
      }
    }
    // Round and filter out sub-threshold entries
    return Object.fromEntries(
      Object.entries(dist)
        .map(([k, v]) => [k, Math.max(1, Math.round(v))] as [string, number])
        .filter(([, v]) => v >= 1),
    );
  }, [audiences.pageGroups]);

  const addGroup = () => {
    const g = createEmptyInterestGroup();
    onChange([...groups, g]);
    setExpandedGroupId(g.id);
  };

  const removeGroup = (id: string) => {
    onChange(groups.filter((g) => g.id !== id));
  };

  const updateGroup = (id: string, patch: Partial<InterestGroup>) => {
    onChange(groups.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  };

  // ── Background targetability validator ──────────────────────────────────
  // Anything added with a non-Meta-shaped id (or migrated from an older draft
  // that lacked a status) is tagged "pending". This effect batches all such
  // chips across all groups, asks the backend to look them up against Meta's
  // live ad-interest index, and patches the result back in place.
  //
  // Design notes:
  //  - We track which ids we've already attempted in this session via a ref,
  //    so a transient API failure doesn't loop forever.
  //  - We keep a snapshot of `groups` in a ref so the async callback always
  //    writes against the latest state via `onChange`.
  //  - Today no production add-path produces a "pending" item (every add path
  //    uses a Meta-confirmed id); this hook is in place to safely handle older
  //    drafts and any future seed/hint-driven add paths without breaking them.
  const groupsRef = useRef(groups);
  useEffect(() => { groupsRef.current = groups; }, [groups]);
  const validatedIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const pending: Array<{ groupId: string; interest: InterestSuggestion }> = [];
    for (const g of groups) {
      for (const i of g.interests) {
        if (i.targetabilityStatus !== "pending") continue;
        if (validatedIdsRef.current.has(`${g.id}::${i.id}`)) continue;
        pending.push({ groupId: g.id, interest: i });
      }
    }
    if (pending.length === 0) return;

    const items: InterestValidateRequestItem[] = pending.map((p) => ({
      id: p.interest.id,
      name: p.interest.name,
    }));
    for (const p of pending) validatedIdsRef.current.add(`${p.groupId}::${p.interest.id}`);

    const controller = new AbortController();
    let cancelled = false;
    void (async () => {
      try {
        const { results } = await validateInterestsTargetability(items, {
          signal: controller.signal,
        });
        if (cancelled) return;

        // Build {groupId → {requestedId|name → result}} lookup so we can patch
        // each group's interests in a single onChange call below.
        const resultByPending = new Map<number, typeof results[number]>();
        for (let idx = 0; idx < pending.length; idx++) {
          const r = results[idx];
          if (r) resultByPending.set(idx, r);
        }
        const patchByGroup = new Map<string, Map<string, typeof results[number]>>();
        pending.forEach((p, idx) => {
          const r = resultByPending.get(idx);
          if (!r) return;
          if (!patchByGroup.has(p.groupId)) patchByGroup.set(p.groupId, new Map());
          patchByGroup.get(p.groupId)!.set(p.interest.id, r);
        });

        const next = groupsRef.current.map((g) => {
          const patches = patchByGroup.get(g.id);
          if (!patches) return g;
          const interests = g.interests.map((i) => {
            const r = patches.get(i.id);
            if (!r) return i;
            return applyTargetabilityResult(i, r);
          });
          return { ...g, interests };
        });
        onChange(next);
        if (process.env.NODE_ENV !== "production") {
          console.info(
            `[targetability] validated ${pending.length} interest(s):`,
            results.map((r) => `${r.name}=${r.targetabilityStatus}`).join(", "),
          );
        }
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return;
        console.warn("[targetability] validation failed:", err);
        // Leave items "pending" — they'll be retried only on next change since
        // we've already added them to validatedIdsRef. To force a retry, the
        // user can re-add the chip.
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [groups, onChange]);

  const addInterest = (groupId: string, interest: InterestSuggestion) => {
    const group = groups.find((g) => g.id === groupId);
    if (!group || group.interests.some((i) => i.id === interest.id)) return;
    const tagged = enrichWithTargetability(interest);
    updateGroup(groupId, { interests: [...group.interests, tagged] });
  };

  const removeInterest = (groupId: string, interestId: string) => {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    updateGroup(groupId, {
      interests: group.interests.filter((i) => i.id !== interestId),
    });
  };

  /**
   * Swap an unresolved chip with one of the suggested replacements returned by
   * /api/meta/interest-validate. Preserves the chip's position in the array so
   * the user's mental model of order is intact, copies forward optional local
   * metadata (path), and tags `targetabilityStatus` based on whether the new
   * id looks Meta-confirmed.
   *
   * If the replacement id is already present elsewhere in the same group, the
   * unresolved chip is just removed (no duplicate added).
   */
  const replaceInterest = (
    groupId: string,
    interestId: string,
    replacement: { id: string; name: string; audienceSize?: number },
  ) => {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    if (!group.interests.some((i) => i.id === interestId)) return;
    const isDup = group.interests.some(
      (i) => i.id === replacement.id && i.id !== interestId,
    );
    if (isDup) {
      updateGroup(groupId, {
        interests: group.interests.filter((i) => i.id !== interestId),
      });
      validatedIdsRef.current.delete(`${groupId}::${interestId}`);
      return;
    }
    const isMetaId = isMetaConfirmedId(replacement.id);
    const interests = group.interests.map((i) => {
      if (i.id !== interestId) return i;
      const next: InterestSuggestion = {
        ...i,
        id: replacement.id,
        name: replacement.name,
        audienceSize: replacement.audienceSize ?? i.audienceSize,
        targetabilityStatus: isMetaId ? "valid" : "pending",
        targetabilityCheckedAt: new Date().toISOString(),
        targetabilityReplacements: undefined,
      };
      return next;
    });
    validatedIdsRef.current.delete(`${groupId}::${interestId}`);
    if (!isMetaId) validatedIdsRef.current.delete(`${groupId}::${replacement.id}`);
    updateGroup(groupId, { interests });
  };

  /**
   * Force a fresh targetability check for one chip. Marks it `pending` and
   * clears it from the validator's "already attempted" set so the existing
   * background effect picks it up on the next render.
   */
  const recheckInterest = (groupId: string, interestId: string) => {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    const interests = group.interests.map((i) =>
      i.id === interestId
        ? {
            ...i,
            targetabilityStatus: "pending" as const,
            targetabilityReplacements: undefined,
          }
        : i,
    );
    validatedIdsRef.current.delete(`${groupId}::${interestId}`);
    updateGroup(groupId, { interests });
  };

  const handleAutoGenerate = () => {
    const generated = generateInterestGroupsFromAudiences(audiences);
    onChange(generated);
    if (generated.length > 0) setExpandedGroupId(generated[0].id);
  };

  const handleSearchChange = (groupId: string, value: string) => {
    setSearchByGroup((prev) => ({ ...prev, [groupId]: value }));
    setActiveSearchGroupId(groupId);
  };

  const handleSearchClear = (groupId: string) => {
    setSearchByGroup((prev) => ({ ...prev, [groupId]: "" }));
  };

  const getResults = (groupId: string) => {
    if (groupId !== activeSearchGroupId) return [];
    return searchState.results;
  };

  const handleDiscover = useCallback(async (groupId: string) => {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;

    const prompt = (group.aiPrompt ?? "").trim();
    if (!prompt) {
      setDiscoveryError((prev) => ({ ...prev, [groupId]: "Enter a description first." }));
      return;
    }

    const cleaned = prompt
      .replace(/^(find|suggest|search|get|show|list|give me|i want|interests?\s+(?:for|about|related to|in))\s+/gi, "")
      .trim();

    const keywords = cleaned
      .split(/[,;\n]+|\s+and\s+/i)
      .map((k) => k.trim())
      .filter((k) => k.length >= 2)
      .slice(0, 10);

    if (keywords.length === 0) {
      setDiscoveryError((prev) => ({ ...prev, [groupId]: "Could not extract search terms. Try comma-separated keywords like: electronic music, nightclub, festivals" }));
      return;
    }

    setDiscoveringGroupId(groupId);
    setDiscoveryError((prev) => ({ ...prev, [groupId]: null }));
    setDiscoveredSuggestions((prev) => ({ ...prev, [groupId]: [] }));
    setDiscoveredUnmatched((prev) => ({ ...prev, [groupId]: [] }));

    const existingIds = new Set(group.interests.map((i) => i.id));
    const found: InterestSuggestion[] = [];
    const unmatchedKws: string[] = [];

    try {
      for (const kw of keywords) {
        const res = await fetch(
          `/api/meta/interest-search?q=${encodeURIComponent(kw)}`,
        );
        const json = (await res.json()) as {
          data?: Array<{ id: string; name: string; audienceSize?: number; path?: string[] }>;
          error?: string;
        };
        let matched = false;
        if (json.data) {
          for (const item of json.data) {
            if (!existingIds.has(item.id) && !found.some((f) => f.id === item.id)) {
              found.push({ id: item.id, name: item.name, audienceSize: item.audienceSize, path: item.path });
              matched = true;
            }
          }
        }
        if (!matched) unmatchedKws.push(kw);
      }

      if (found.length > 0) {
        setDiscoveredSuggestions((prev) => ({
          ...prev,
          [groupId]: found.slice(0, 25).map((interest) => ({ interest, selected: false })),
        }));
      }
      setDiscoveredUnmatched((prev) => ({ ...prev, [groupId]: unmatchedKws }));

      if (found.length === 0) {
        setDiscoveryError((prev) => ({
          ...prev,
          [groupId]: `No Meta interests matched. Searched: ${keywords.join(", ")}. Try more specific terms.`,
        }));
      } else {
        setDiscoveryError((prev) => ({
          ...prev,
          [groupId]: unmatchedKws.length > 0
            ? `Found ${found.length} suggestions. No matches for: ${unmatchedKws.join(", ")}`
            : null,
        }));
      }
    } catch (err) {
      setDiscoveryError((prev) => ({
        ...prev,
        [groupId]: err instanceof Error ? err.message : "Discovery failed",
      }));
    } finally {
      setDiscoveringGroupId(null);
    }
  }, [groups]);

  const handleDiscoverFromPages = useCallback(async (
    groupId: string,
    /** Optional override for the scene-hint text. Used by the preset chip
     *  click handler so the new hint is sent immediately without waiting
     *  for the `sceneHintsByGroup` state update to flush. */
    hintOverride?: string,
  ) => {
    if (discoveringFromPages === groupId) return;

    // Resolve cluster type: stored on group, or inferred from name.
    // IMPORTANT: `groups` and `sceneHintsByGroup` must be in the deps array
    // below so we read the current cluster chip selection (stored in
    // group.clusterType) rather than a stale snapshot from mount-time.
    const group = groups.find((g) => g.id === groupId);
    const inferredFromName = group?.name ? inferClusterFromName(group.name) : null;
    const effectiveClusterType = group?.clusterType ?? inferredFromName ?? undefined;

    if (process.env.NODE_ENV !== "production") {
      console.info(
        `[discover-ui] group="${group?.name ?? "<unknown>"}" ` +
        `clusterType="${group?.clusterType ?? ""}" ` +
        `inferredFromName="${inferredFromName ?? ""}" ` +
        `clusterLabel="${effectiveClusterType ?? ""}"`,
      );
    }

    // Require an explicit cluster for a group-scoped regenerate. Without one,
    // the backend would fan out to all five clusters — which is precisely the
    // "campaign-wide leakage" we want to avoid.
    if (!effectiveClusterType) {
      setDiscoverFromPagesError((prev) => ({
        ...prev,
        [groupId]: "Pick a cluster for this group (Music, Fashion, Lifestyle, Activities, Media, or Sports) before regenerating.",
      }));
      return;
    }

    setDiscoveringFromPages(groupId);
    setDiscoverFromPagesError((prev) => ({ ...prev, [groupId]: null }));
    setDiscoverClusters((prev) => ({ ...prev, [groupId]: [] }));
    setDiscoverSearchTerms((prev) => ({ ...prev, [groupId]: [] }));
    setDiscoverSceneTags((prev) => ({ ...prev, [groupId]: [] }));

    try {
      // Parse scene hints: split on commas/semicolons/newlines; keep each
      // phrase as natural-language text. Do NOT underscore-join words — the
      // backend intent classifier relies on real word boundaries, and Meta's
      // interest search works better on the unmangled phrase too.
      const rawHints = hintOverride ?? sceneHintsByGroup[groupId] ?? "";
      const sceneHints = rawHints
        .split(/[,;\n]+/)
        .map((h) => h.trim())
        .filter((h) => h.length > 0);

      const res = await fetch("/api/meta/interest-discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageContext: pageContext.map((p) => ({
            name: p.name,
            category: p.category,
            instagramUsername: p.instagramUsername,
          })),
          customAudienceSignals,
          engagementTypesPresent,
          genreDistribution,
          campaignName,
          clusterLabel: effectiveClusterType,
          ...(sceneHints.length > 0 ? { sceneHints } : {}),
        }),
      });

      const json = (await res.json()) as DiscoverResponse & { error?: string };
      if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);

      setDiscoverClusters((prev) => ({ ...prev, [groupId]: json.clusters }));
      setDiscoverSearchTerms((prev) => ({ ...prev, [groupId]: json.searchTermsUsed }));
      setDiscoverSceneTags((prev) => ({ ...prev, [groupId]: json.detectedSceneTags ?? [] }));
      if (json.audienceFingerprint) {
        setFingerprintByGroup((prev) => ({ ...prev, [groupId]: json.audienceFingerprint }));
      }

      // Init selections to false for all
      const init: Record<string, boolean> = {};
      for (const cluster of json.clusters) {
        for (const i of cluster.interests) init[i.id] = false;
      }
      setClusterSelections((prev) => ({ ...prev, [groupId]: init }));

      if (json.clusters.length === 0) {
        setDiscoverFromPagesError((prev) => ({
          ...prev,
          [groupId]: "No matching interests found. Try loading more pages or adding a campaign name.",
        }));
      }
    } catch (err) {
      setDiscoverFromPagesError((prev) => ({
        ...prev,
        [groupId]: err instanceof Error ? err.message : "Discovery failed",
      }));
    } finally {
      setDiscoveringFromPages(null);
    }
  }, [discoveringFromPages, groups, sceneHintsByGroup, pageContext, customAudienceSignals, engagementTypesPresent, genreDistribution, campaignName]);

  const toggleClusterInterest = (groupId: string, interestId: string) => {
    setClusterSelections((prev) => ({
      ...prev,
      [groupId]: { ...(prev[groupId] ?? {}), [interestId]: !(prev[groupId]?.[interestId] ?? false) },
    }));
  };

  const selectAllInCluster = (groupId: string, cluster: DiscoverCluster) => {
    setClusterSelections((prev) => {
      const next = { ...(prev[groupId] ?? {}) };
      for (const i of cluster.interests) next[i.id] = true;
      return { ...prev, [groupId]: next };
    });
  };

  const addSelectedClusterInterests = (groupId: string) => {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    const selections = clusterSelections[groupId] ?? {};
    const clusters = discoverClusters[groupId] ?? [];
    const existingIds = new Set(group.interests.map((i) => i.id));
    const toAdd: InterestSuggestion[] = [];
    for (const cluster of clusters) {
      for (const item of cluster.interests) {
        if (selections[item.id] && !existingIds.has(item.id)) {
          toAdd.push({ id: item.id, name: item.name, audienceSize: item.audienceSize, path: item.path });
        }
      }
    }
    if (toAdd.length > 0) {
      updateGroup(groupId, {
        interests: [...group.interests, ...toAdd.map(enrichWithTargetability)],
      });
    }
    // Clear clusters after adding (keep selections so user can re-open)
    setDiscoverClusters((prev) => ({ ...prev, [groupId]: [] }));
  };

  const selectedClusterCount = (groupId: string): number => {
    const selections = clusterSelections[groupId] ?? {};
    return Object.values(selections).filter(Boolean).length;
  };

  const toggleSuggestion = (groupId: string, interestId: string) => {
    setDiscoveredSuggestions((prev) => ({
      ...prev,
      [groupId]: (prev[groupId] ?? []).map((item) =>
        item.interest.id === interestId ? { ...item, selected: !item.selected } : item,
      ),
    }));
  };

  const selectAllSuggestions = (groupId: string) => {
    setDiscoveredSuggestions((prev) => ({
      ...prev,
      [groupId]: (prev[groupId] ?? []).map((item) => ({ ...item, selected: true })),
    }));
  };

  const clearAllSuggestions = (groupId: string) => {
    setDiscoveredSuggestions((prev) => ({
      ...prev,
      [groupId]: (prev[groupId] ?? []).map((item) => ({ ...item, selected: false })),
    }));
  };

  const addSelectedSuggestions = (groupId: string) => {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    const items = discoveredSuggestions[groupId] ?? [];
    const toAdd = items.filter((i) => i.selected).map((i) => i.interest);
    if (toAdd.length === 0) return;
    const existingIds = new Set(group.interests.map((i) => i.id));
    const deduped = toAdd.filter((i) => !existingIds.has(i.id));
    if (deduped.length > 0) {
      updateGroup(groupId, {
        interests: [...group.interests, ...deduped.map(enrichWithTargetability)],
      });
    }
    setDiscoveredSuggestions((prev) => ({ ...prev, [groupId]: [] }));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold">Interest Groups ({groups.length})</h3>
          <p className="text-xs text-muted-foreground">
            Search Meta&apos;s interest database and group interests for targeted ad sets.
          </p>
          {(pageContext.length > 0 || customAudienceSignals.length > 0 || Object.keys(genreDistribution).length > 0) && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              <span className="font-medium text-primary">Discover from Pages</span> pooling{" "}
              {pageContext.length > 0 && <><span className="font-medium text-foreground">{pageContext.length}</span> pages</>}
              {customAudienceSignals.length > 0 && <> · <span className="font-medium text-foreground">{customAudienceSignals.length}</span> CA groups</>}
              {engagementTypesPresent.length > 0 && <> · <span className="font-medium text-success">{engagementTypesPresent.length}</span> engagement type{engagementTypesPresent.length !== 1 ? "s" : ""}</>}
              {Object.keys(genreDistribution).length > 0 && <> · <span className="font-medium text-foreground">{Object.keys(genreDistribution).length}</span> genre buckets</>}
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          {hasPageAudiences && (
            <Button variant="outline" size="sm" onClick={handleAutoGenerate} title="Creates empty named groups — use Discover from Pages for real Meta interests">
              <Wand2 className="h-3.5 w-3.5" />
              Empty groups
            </Button>
          )}
          <Button size="sm" onClick={addGroup}>
            <Plus className="h-3.5 w-3.5" />
            New Group
          </Button>
        </div>
      </div>

      {/* Auto-generate prompt when no groups exist */}
      {groups.length === 0 && (
        <Card className="py-8 text-center">
          {hasPageAudiences ? (
            <>
              <p className="text-sm text-muted-foreground">
                Auto-generate interest groups based on your page audiences.
              </p>
              <p className="mt-1 text-xs text-warning">
                Auto-generated suggestions use heuristic genre mapping — search Meta&apos;s interest database for real targeting IDs.
              </p>
              <div className="mt-3 flex justify-center gap-2">
                <Button size="sm" variant="outline" onClick={handleAutoGenerate}>
                  <Wand2 className="h-3.5 w-3.5" />
                  Auto-generate (heuristic)
                </Button>
                <Button size="sm" onClick={addGroup}>
                  <Plus className="h-3.5 w-3.5" />
                  Create manually
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Add an interest group to target users by interests.
              </p>
              <Button size="sm" className="mt-3" onClick={addGroup}>
                <Plus className="h-3.5 w-3.5" />
                New Group
              </Button>
            </>
          )}
        </Card>
      )}

      {groups.map((group) => {
        const isExpanded = expandedGroupId === group.id;
        const search = searchByGroup[group.id] || "";
        const results = getResults(group.id);
        const isSearching = activeSearchGroupId === group.id && searchState.loading;
        const searchError = activeSearchGroupId === group.id ? searchState.error : null;

        return (
          <Card key={group.id} className="p-0 overflow-hidden">
            <div
              role="button"
              tabIndex={0}
              onClick={() => setExpandedGroupId(isExpanded ? null : group.id)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpandedGroupId(isExpanded ? null : group.id); } }}
              className="flex w-full cursor-pointer items-center justify-between p-4 text-left hover:bg-muted/50"
            >
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold">
                  {group.name || "Untitled Group"}
                </span>
                <Badge variant="primary">{group.interests.length} interests</Badge>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); removeGroup(group.id); }}
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
                {isExpanded ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
            </div>

            {isExpanded && (
              <div className="border-t border-border p-4 space-y-4">
                <Input
                  label="Group Name"
                  value={group.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    // Auto-set clusterType from name only if not already explicitly chosen
                    const inferred = inferClusterFromName(name);
                    updateGroup(group.id, {
                      name,
                      ...(inferred && !group.clusterType ? { clusterType: inferred } : {}),
                    });
                  }}
                  placeholder="e.g. Music Interests"
                />

                {/* Cluster type selector — controls which cluster AI discovery targets */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    AI Discovery Cluster
                    <span className="ml-1 font-normal">(controls which category Discover from Pages uses)</span>
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {CLUSTER_LABELS.map((label) => {
                      const active = (group.clusterType ?? inferClusterFromName(group.name)) === label;
                      return (
                        <button
                          key={label}
                          type="button"
                          onClick={() =>
                            updateGroup(group.id, {
                              clusterType: group.clusterType === label ? undefined : label,
                            })
                          }
                          className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium border transition-colors ${
                            active
                              ? "bg-primary text-white border-primary"
                              : "bg-muted text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                    {(group.clusterType || inferClusterFromName(group.name)) && (
                      <button
                        type="button"
                        onClick={() => updateGroup(group.id, { clusterType: undefined })}
                        className="rounded-full px-2 py-0.5 text-[11px] text-muted-foreground hover:text-destructive"
                        title="Clear cluster type (discover all categories)"
                      >
                        ✕ All
                      </button>
                    )}
                  </div>
                </div>

                <div>
                  <div className="mb-1.5 flex items-center gap-2">
                    <label className="text-sm font-medium">Search Meta Interests</label>
                    {isSearching && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                  </div>
                  <SearchInput
                    value={search}
                    onChange={(e) => handleSearchChange(group.id, e.target.value)}
                    onClear={() => handleSearchClear(group.id)}
                    placeholder="Search Meta interest database (min 2 chars)…"
                  />
                  {searchError && (
                    <p className="mt-1 text-xs text-destructive">{searchError}</p>
                  )}
                  {search.length >= 2 && (
                    <div className="mt-1.5 max-h-48 overflow-y-auto rounded-lg border border-border">
                      {results.length > 0 ? (
                        results.map((interest) => {
                          const selected = group.interests.some((i) => i.id === interest.id);
                          return (
                            <button
                              key={interest.id}
                              type="button"
                              disabled={selected}
                              onClick={() => addInterest(group.id, interest)}
                              className="flex w-full items-center justify-between border-b border-border px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted/50 disabled:opacity-40"
                            >
                              <div className="min-w-0 flex-1">
                                <span className="block truncate">{interest.name}</span>
                                {interest.path && interest.path.length > 0 && (
                                  <span className="block truncate text-[10px] text-muted-foreground">
                                    {interest.path.join(" › ")}
                                  </span>
                                )}
                              </div>
                              {interest.audienceSize != null && (
                                <span className="shrink-0 ml-2 text-xs text-muted-foreground">
                                  {interest.audienceSize >= 1_000_000
                                    ? `${(interest.audienceSize / 1_000_000).toFixed(1)}M`
                                    : interest.audienceSize >= 1_000
                                      ? `${Math.round(interest.audienceSize / 1_000)}K`
                                      : interest.audienceSize}
                                </span>
                              )}
                            </button>
                          );
                        })
                      ) : isSearching ? (
                        <div className="flex items-center justify-center gap-2 px-3 py-4">
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">Searching Meta…</span>
                        </div>
                      ) : (
                        <p className="px-3 py-3 text-center text-xs text-muted-foreground">
                          No interests found for &ldquo;{search}&rdquo;
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* ── Discover from Pages — AI-style fan interest discovery ─── */}
                {(() => {
                  const effectiveCluster = group.clusterType ?? inferClusterFromName(group.name);
                  return (
                <div className="rounded-xl border-2 border-dashed border-primary/30 bg-primary-light p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 text-sm font-medium text-primary">
                        <Sparkles className="h-4 w-4" />
                        Discover from Pages
                        {effectiveCluster && (
                          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                            {effectiveCluster}
                          </span>
                        )}
                      </div>
                      {effectiveCluster ? (
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          Generates <span className="font-medium">{effectiveCluster}</span> interests based on fans of your selected pages.
                          Irrelevant categories filtered out.
                        </p>
                      ) : (
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          Select a cluster above to get targeted suggestions, or discover across all categories.
                        </p>
                      )}
                      <p className="mt-0.5 text-[10px] text-muted-foreground/70 italic">
                        Suggestions are tailored to each cluster using selected page audience signals.
                      </p>
                      {pageContext.length > 0 ? (
                        <p className="mt-1 text-[11px] text-muted-foreground/80">
                          Seeded by: <span className="font-medium text-foreground">
                            {pageContext.slice(0, 3).map((p) => p.name).join(", ")}
                            {pageContext.length > 3 && ` +${pageContext.length - 3} more`}
                          </span>
                          {customAudienceSignals.length > 0 && (
                            <span className="ml-1 text-success">· {customAudienceSignals.length} CA</span>
                          )}
                          {engagementTypesPresent.length > 0 && (
                            <span className="ml-1 text-success">· {engagementTypesPresent.length} engagement type{engagementTypesPresent.length !== 1 ? "s" : ""}</span>
                          )}
                        </p>
                      ) : (
                        <p className="mt-1 text-[11px] text-warning">
                          Load your Facebook pages in the Pages tab to improve suggestions.
                        </p>
                      )}
                    </div>
                    {(discoverClusters[group.id]?.length ?? 0) > 0 && (
                      <button
                        type="button"
                        onClick={() => handleDiscoverFromPages(group.id)}
                        className="shrink-0 rounded p-1 text-muted-foreground hover:text-primary"
                        title="Regenerate suggestions"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  {/* ── Audience Fingerprint card ──────────────────── */}
                  {fingerprintByGroup[group.id] && (() => {
                    const fp = fingerprintByGroup[group.id]!;
                    const specColor =
                      fp.specificity === "very_high" ? "text-success border-success/30 bg-success/5" :
                      fp.specificity === "high" ? "text-primary border-primary/30 bg-primary/5" :
                      fp.specificity === "moderate" ? "text-warning border-warning/30 bg-warning/5" :
                      "text-muted-foreground border-border bg-muted/30";
                    const specLabel =
                      fp.specificity === "very_high" ? "Very Specific" :
                      fp.specificity === "high" ? "High Confidence" :
                      fp.specificity === "moderate" ? "Moderate" : "Broad";
                    return (
                      <div className={`rounded-lg border px-3 py-2.5 space-y-2 text-xs ${specColor}`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold">Audience Fingerprint</span>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${specColor} border`}>{specLabel}</span>
                        </div>

                        {/* Source chips */}
                        <div className="flex flex-wrap gap-1">
                          {fp.sources.pages > 0 && (
                            <span className="rounded bg-black/8 px-1.5 py-0.5 text-[10px]">
                              {fp.sources.pages} page{fp.sources.pages !== 1 ? "s" : ""}
                            </span>
                          )}
                          {fp.sources.customAudiences > 0 && (
                            <span className="rounded bg-black/8 px-1.5 py-0.5 text-[10px]">
                              {fp.sources.customAudiences} CA group{fp.sources.customAudiences !== 1 ? "s" : ""}
                            </span>
                          )}
                          {fp.sources.engagementTypes > 0 && (
                            <span className="rounded bg-success/20 px-1.5 py-0.5 text-[10px] font-medium text-success">
                              {fp.sources.engagementTypes} engagement type{fp.sources.engagementTypes !== 1 ? "s" : ""} ↑
                            </span>
                          )}
                          {fp.sources.genreGroups > 0 && (
                            <span className="rounded bg-black/8 px-1.5 py-0.5 text-[10px]">
                              {fp.sources.genreGroups} genre bucket{fp.sources.genreGroups !== 1 ? "s" : ""}
                            </span>
                          )}
                          {fp.sources.hints > 0 && (
                            <span className="rounded bg-black/8 px-1.5 py-0.5 text-[10px]">
                              {fp.sources.hints} hint{fp.sources.hints !== 1 ? "s" : ""}
                            </span>
                          )}
                        </div>

                        {/* Dominant scenes */}
                        {fp.dominantScenes.length > 0 && (
                          <div>
                            <span className="text-[10px] opacity-70">Dominant signals:</span>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {fp.dominantScenes.slice(0, 6).map((s) => {
                                const maxW = fp.dominantScenes[0]?.weight ?? 1;
                                const rel = Math.round((s.weight / maxW) * 100);
                                return (
                                  <span
                                    key={s.tag}
                                    title={`weight: ${s.weight}`}
                                    className="flex items-center gap-1 rounded bg-black/10 px-1.5 py-0.5 text-[10px] font-medium"
                                    style={{ opacity: 0.5 + rel / 200 }}
                                  >
                                    {s.tag.replace(/_/g, " ")}
                                    <span className="opacity-60 text-[9px]">{rel}%</span>
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Confidence bar */}
                        <div>
                          <div className="mb-0.5 flex items-center justify-between">
                            <span className="text-[10px] opacity-70">Confidence</span>
                            <span className="text-[10px] font-bold">{fp.confidence}%</span>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/10">
                            <div
                              className="h-full rounded-full bg-current transition-all"
                              style={{ width: `${fp.confidence}%` }}
                            />
                          </div>
                          <p className="mt-1 text-[10px] opacity-60">
                            {fp.specificity === "very_high"
                              ? "High confidence — interests will be highly specific, generic suggestions removed."
                              : fp.specificity === "high"
                                ? "Good signal depth — interests will be scene-specific with moderate filtering."
                                : fp.specificity === "moderate"
                                  ? "Moderate signal — some curated seeds included alongside entity matches."
                                  : "Low signal — broad curated suggestions shown. Add more pages or custom audiences to improve."}
                          </p>
                        </div>

                        {/* Age recommendation */}
                        {fp.ageRecommendation && fp.ageRecommendation.confidence !== "low" && (
                          <div className="rounded-md border border-current/20 bg-current/5 px-2.5 py-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[10px] font-semibold">Suggested Age Range</span>
                              <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold border ${
                                fp.ageRecommendation.confidence === "high"
                                  ? "text-success border-success/30"
                                  : "text-warning border-warning/30"
                              }`}>
                                {fp.ageRecommendation.confidence}
                              </span>
                            </div>
                            <div className="mt-1 flex items-baseline gap-1.5">
                              <span className="text-lg font-bold leading-none">
                                {fp.ageRecommendation.minAge}–{fp.ageRecommendation.maxAge}
                              </span>
                              <span className="text-[10px] opacity-60">
                                peak ~{fp.ageRecommendation.peakAge}
                              </span>
                            </div>
                            <p className="mt-1 text-[9px] opacity-50 leading-tight">
                              {fp.ageRecommendation.rationale}
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Scene hints — optional nudge for niche subgenre discovery */}
                  <div>
                    <Input
                      label="Scene hints (optional)"
                      value={sceneHintsByGroup[group.id] ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        setSceneHintsByGroup((prev) => ({ ...prev, [group.id]: v }));
                        // Manual edit invalidates any active preset selection.
                        setSelectedPresetByGroup((prev) => {
                          if (!prev[group.id]) return prev;
                          const next = { ...prev };
                          delete next[group.id];
                          return next;
                        });
                      }}
                      placeholder="e.g. hard_techno, queer_underground, avant_garde_fashion"
                    />
                    <p className="mt-0.5 text-[10px] text-muted-foreground/70">
                      Comma-separated scene tags to bias discovery. Helps when page names don&apos;t clearly signal the niche (e.g. <span className="font-mono">hard_techno</span>, <span className="font-mono">editorial_fashion</span>, <span className="font-mono">psy_trance</span>).
                    </p>

                    {/* Suggested scene hints — quick-pick chips per cluster */}
                    {(() => {
                      if (!effectiveCluster) return null;
                      const fp = fingerprintByGroup[group.id];
                      const presets: SceneHintPreset[] = getSceneHintPresets({
                        clusterLabel: effectiveCluster,
                        dominantScenes: fp?.dominantScenes,
                        detectedSceneTags: discoverSceneTags[group.id],
                      });
                      if (presets.length === 0) return null;
                      if (process.env.NODE_ENV !== "production") {
                        const top = fp?.dominantScenes?.[0]?.tag ?? "<none>";
                        console.info(
                          `[scene-hints] cluster=${effectiveCluster} presets=${presets.length} topScene=${top}`,
                        );
                      }
                      const activeId = selectedPresetByGroup[group.id];
                      const isBusy = discoveringFromPages === group.id;
                      return (
                        <div className="mt-2">
                          <p className="text-[10px] font-medium text-muted-foreground mb-1">
                            Suggested scene hints
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {presets.map((preset) => {
                              const isActive = activeId === preset.id;
                              return (
                                <button
                                  key={preset.id}
                                  type="button"
                                  disabled={isBusy}
                                  title={preset.hint}
                                  onClick={() => {
                                    setSceneHintsByGroup((prev) => ({
                                      ...prev,
                                      [group.id]: preset.hint,
                                    }));
                                    setSelectedPresetByGroup((prev) => ({
                                      ...prev,
                                      [group.id]: preset.id,
                                    }));
                                    void handleDiscoverFromPages(group.id, preset.hint);
                                  }}
                                  className={
                                    "rounded-full border px-2.5 py-1 text-[11px] transition disabled:opacity-50 disabled:cursor-not-allowed " +
                                    (isActive
                                      ? "border-primary bg-primary/10 text-primary font-medium"
                                      : "border-border bg-white text-foreground hover:bg-muted")
                                  }
                                >
                                  {preset.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Suggested audience personas — Phase 1 layer above the
                        scene-hint chips. Currently active for Fashion &
                        Streetwear, Music & Nightlife, and Lifestyle &
                        Nightlife (clusters defined in PERSONAS_BY_CLUSTER
                        in lib/audience-personas.ts). Empty for Sports etc.
                        Shares selectedPresetByGroup so only one chip — scene
                        OR persona — is highlighted at a time. */}
                    {(() => {
                      if (!effectiveCluster) return null;
                      const fp = fingerprintByGroup[group.id];
                      const personaPresets: PersonaPreset[] =
                        getPersonaPresetsForCluster(
                          effectiveCluster,
                          fp?.dominantScenes,
                          discoverSceneTags[group.id],
                        );
                      if (personaPresets.length === 0) return null;
                      if (process.env.NODE_ENV !== "production") {
                        console.info(
                          `[persona-presets] cluster=${effectiveCluster} count=${personaPresets.length} ` +
                            `keys=${personaPresets.map((p) => p.personaKey).join(",")}`,
                        );
                      }
                      const activeId = selectedPresetByGroup[group.id];
                      const isBusy = discoveringFromPages === group.id;
                      return (
                        <div className="mt-2">
                          <p className="text-[10px] font-medium text-muted-foreground mb-1">
                            Suggested audience personas
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {personaPresets.map((preset) => {
                              const isActive = activeId === preset.id;
                              return (
                                <button
                                  key={preset.id}
                                  type="button"
                                  disabled={isBusy}
                                  title={preset.hint}
                                  onClick={() => {
                                    setSceneHintsByGroup((prev) => ({
                                      ...prev,
                                      [group.id]: preset.hint,
                                    }));
                                    setSelectedPresetByGroup((prev) => ({
                                      ...prev,
                                      [group.id]: preset.id,
                                    }));
                                    void handleDiscoverFromPages(group.id, preset.hint);
                                  }}
                                  className={
                                    "rounded-full border px-2.5 py-1 text-[11px] transition disabled:opacity-50 disabled:cursor-not-allowed " +
                                    (isActive
                                      ? "border-violet-500 bg-violet-500/10 text-violet-700 font-medium"
                                      : "border-border bg-white text-foreground hover:bg-muted")
                                  }
                                >
                                  {preset.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  <Button
                    size="sm"
                    className="w-full"
                    disabled={discoveringFromPages === group.id}
                    onClick={() => handleDiscoverFromPages(group.id)}
                  >
                    {discoveringFromPages === group.id ? (
                      <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Discovering {effectiveCluster ?? "all categories"}…</>
                    ) : (discoverClusters[group.id]?.length ?? 0) > 0 ? (
                      <><RefreshCw className="h-3.5 w-3.5" /> Regenerate {effectiveCluster ? `(${effectiveCluster})` : ""}</>
                    ) : (
                      <><Sparkles className="h-3.5 w-3.5" /> Discover {effectiveCluster ? `${effectiveCluster} Interests` : "Interests from Pages"}</>
                    )}
                  </Button>

                  {discoverFromPagesError[group.id] && (
                    <p className="text-xs text-destructive">{discoverFromPagesError[group.id]}</p>
                  )}

                  {/* Discovery results — single-cluster or multi-cluster */}
                  {(discoverClusters[group.id]?.length ?? 0) > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-foreground">
                          {effectiveCluster
                            ? `${effectiveCluster} suggestions — select and add`
                            : "Suggested interests — select and add"}
                        </span>
                        {selectedClusterCount(group.id) > 0 && (
                          <Button
                            size="sm"
                            className="h-6 px-2 text-[11px]"
                            onClick={() => addSelectedClusterInterests(group.id)}
                          >
                            Add {selectedClusterCount(group.id)} selected
                          </Button>
                        )}
                      </div>

                      {discoverClusters[group.id]!.map((cluster) => {
                        // Single-cluster mode: suppress cluster header label (already shown above)
                        const isSingleCluster = (discoverClusters[group.id]?.length ?? 0) === 1;
                        return (
                          <div key={cluster.label} className="rounded-lg border border-border bg-white overflow-hidden">
                            {!isSingleCluster && (
                              <div className="flex items-start justify-between gap-2 px-3 py-1.5 bg-muted/30 border-b border-border">
                                <div className="min-w-0">
                                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                    {cluster.label}
                                  </span>
                                  {cluster.description && (
                                    <p className="text-[10px] text-muted-foreground/70 leading-tight mt-0.5">
                                      {cluster.description}
                                    </p>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => selectAllInCluster(group.id, cluster)}
                                  className="shrink-0 text-[10px] font-medium text-primary hover:underline"
                                >
                                  Select all
                                </button>
                              </div>
                            )}
                            {isSingleCluster && cluster.description && (
                              <div className="px-3 py-1.5 bg-muted/20 border-b border-border flex items-start justify-between">
                                <p className="text-[10px] text-muted-foreground/80 italic">
                                  {cluster.description}
                                </p>
                                <button
                                  type="button"
                                  onClick={() => selectAllInCluster(group.id, cluster)}
                                  className="shrink-0 ml-2 text-[10px] font-medium text-primary hover:underline"
                                >
                                  Select all
                                </button>
                              </div>
                            )}
                            {cluster.interests.map((item) => {
                              const isSelected = clusterSelections[group.id]?.[item.id] ?? false;
                              const alreadyAdded = group.interests.some((i) => i.id === item.id);
                              const sizeBand = (item as { audienceSizeBand?: string }).audienceSizeBand;
                              const matchReason = (item as { matchReason?: string }).matchReason;
                              const sizeColor =
                                sizeBand?.startsWith("micro") ? "text-success" :
                                sizeBand?.startsWith("niche") ? "text-primary" :
                                sizeBand?.startsWith("targeted") ? "text-foreground" :
                                sizeBand?.startsWith("broad") || sizeBand?.startsWith("mega") ? "text-destructive/60" :
                                "text-muted-foreground";
                              return (
                                <label
                                  key={item.id}
                                  className={`flex cursor-pointer items-center gap-2.5 border-b border-border px-3 py-2 last:border-b-0 hover:bg-muted/50 ${alreadyAdded ? "opacity-50" : ""}`}
                                >
                                  <Checkbox
                                    checked={isSelected || alreadyAdded}
                                    onChange={() => !alreadyAdded && toggleClusterInterest(group.id, item.id)}
                                    disabled={alreadyAdded}
                                  />
                                  <div className="min-w-0 flex-1">
                                    <span className="block truncate text-sm">{item.name}</span>
                                    <div className="flex items-center gap-1.5">
                                      {item.path && item.path.length > 0 && (
                                        <span className="truncate text-[10px] text-muted-foreground">
                                          {item.path.join(" › ")}
                                        </span>
                                      )}
                                      {matchReason && (
                                        <span className="shrink-0 text-[9px] text-muted-foreground/50" title={`Match: ${matchReason}`}>
                                          {matchReason.split(",")[0]}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="shrink-0 flex flex-col items-end gap-0.5">
                                    <span className={`text-[10px] ${sizeColor}`}>
                                      {(item.audienceSize ?? 0) >= 1_000_000
                                        ? `${((item.audienceSize ?? 0) / 1_000_000).toFixed(1)}M`
                                        : (item.audienceSize ?? 0) >= 1_000
                                          ? `${Math.round((item.audienceSize ?? 0) / 1_000)}K`
                                          : (item.audienceSize ?? 0) > 0 ? String(item.audienceSize) : ""}
                                    </span>
                                    {sizeBand && !sizeBand.startsWith("unknown") && (
                                      <span className={`text-[9px] ${sizeColor} opacity-60`}>{sizeBand}</span>
                                    )}
                                  </div>
                                  {alreadyAdded && (
                                    <Badge variant="outline" className="shrink-0 text-[9px]">Added</Badge>
                                  )}
                                </label>
                              );
                            })}
                          </div>
                        );
                      })}

                      {(discoverSceneTags[group.id]?.length ?? 0) > 0 && !fingerprintByGroup[group.id] && (
                        <div className="flex flex-wrap gap-1 pt-1">
                          <span className="text-[10px] text-muted-foreground/60 self-center">Detected scenes:</span>
                          {discoverSceneTags[group.id]!.map((tag) => (
                            <span key={tag} className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
                              {tag.replace(/_/g, " ")}
                            </span>
                          ))}
                        </div>
                      )}
                      {(discoverSearchTerms[group.id]?.length ?? 0) > 0 && (
                        <p className="text-[10px] text-muted-foreground/60">
                          Searched {discoverSearchTerms[group.id]!.length} entity terms
                        </p>
                      )}
                    </div>
                  )}

                  {/* Manual keyword fallback */}
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground select-none">
                      Manual keyword search
                    </summary>
                    <div className="mt-2 space-y-2">
                      <p className="text-[11px] text-muted-foreground">
                        Enter comma-separated keywords to search Meta&apos;s interest database directly.
                      </p>
                      <textarea
                        value={group.aiPrompt || ""}
                        onChange={(e) => updateGroup(group.id, { aiPrompt: e.target.value })}
                        placeholder="e.g. electronic music, nightclub, Resident Advisor, Boiler Room"
                        className="w-full resize-none rounded-lg border border-primary/20 bg-white p-3 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                        rows={2}
                      />
                      <Button
                        size="sm"
                        className="w-full"
                        variant="outline"
                        disabled={discoveringGroupId === group.id || !(group.aiPrompt ?? "").trim()}
                        onClick={() => handleDiscover(group.id)}
                      >
                        {discoveringGroupId === group.id ? (
                          <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching Meta…</>
                        ) : (
                          <><Sparkles className="h-3.5 w-3.5" /> Search by keywords</>
                        )}
                      </Button>
                      {discoveryError[group.id] && (
                        <p className="text-xs text-destructive">{discoveryError[group.id]}</p>
                      )}
                      {(discoveredSuggestions[group.id]?.length ?? 0) > 0 && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-foreground">
                              Results ({discoveredSuggestions[group.id]!.length})
                            </span>
                            <div className="flex gap-1.5">
                              <button type="button" onClick={() => selectAllSuggestions(group.id)} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/10">
                                <CheckSquare className="h-3 w-3" /> All
                              </button>
                              <button type="button" onClick={() => clearAllSuggestions(group.id)} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted">
                                <Square className="h-3 w-3" /> None
                              </button>
                            </div>
                          </div>
                          <div className="max-h-48 overflow-y-auto rounded-lg border border-border bg-white">
                            {discoveredSuggestions[group.id]!.map((item) => (
                              <label key={item.interest.id} className="flex cursor-pointer items-center gap-2.5 border-b border-border px-3 py-2 last:border-b-0 hover:bg-muted/50">
                                <Checkbox checked={item.selected} onChange={() => toggleSuggestion(group.id, item.interest.id)} />
                                <span className="flex-1 truncate text-sm">{item.interest.name}</span>
                                {item.interest.audienceSize != null && (
                                  <span className="shrink-0 text-xs text-muted-foreground">
                                    {item.interest.audienceSize >= 1_000_000 ? `${(item.interest.audienceSize / 1_000_000).toFixed(1)}M` : item.interest.audienceSize >= 1_000 ? `${Math.round(item.interest.audienceSize / 1_000)}K` : item.interest.audienceSize}
                                  </span>
                                )}
                              </label>
                            ))}
                          </div>
                          <Button size="sm" className="w-full" disabled={!discoveredSuggestions[group.id]!.some((i) => i.selected)} onClick={() => addSelectedSuggestions(group.id)}>
                            Add {discoveredSuggestions[group.id]!.filter((i) => i.selected).length} selected
                          </Button>
                        </div>
                      )}
                      {(discoveredUnmatched[group.id]?.length ?? 0) > 0 && (
                        <p className="text-[10px] text-muted-foreground">No match for: {discoveredUnmatched[group.id]!.join(", ")}</p>
                      )}
                    </div>
                  </details>
                </div>
                  );
                })()}

                <GroupInterestSection
                  group={group}
                  cluster={group.clusterType ?? inferClusterFromName(group.name) ?? ""}
                  onAdd={(interest) => addInterest(group.id, interest)}
                  onRemove={(id) => removeInterest(group.id, id)}
                  onReplace={(id, repl) => replaceInterest(group.id, id, repl)}
                  onRecheck={(id) => recheckInterest(group.id, id)}
                />
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
