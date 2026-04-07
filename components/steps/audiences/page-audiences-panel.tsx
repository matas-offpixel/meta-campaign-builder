"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SearchInput } from "@/components/ui/search-input";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Plus, Trash2, ChevronDown, ChevronUp, XCircle,
  Building2, User, AlertCircle, Loader2, RefreshCw, Clock, Activity,
} from "lucide-react";
import type { PageAudienceGroup, EngagementType, LookalikeRange, MetaApiPage, SelectedPagesLookalikeGroup, PageCapabilities } from "@/lib/types";
import {
  useFetchPages,
  useFetchAdditionalPages,
  useFetchCustomAudiences,
  useFetchUserPages,
  useFacebookToken,
  type PageLoadMode,
  PAGE_LOAD_MODE_LIMITS,
} from "@/lib/hooks/useMeta";

interface PageAudiencesPanelProps {
  groups: PageAudienceGroup[];
  onChange: (groups: PageAudienceGroup[]) => void;
  /** If provided, fetches Business Manager pages for this ad account automatically */
  adAccountId?: string;
  /** Selected Pages Lookalike groups — separate from standard page groups */
  splalGroups?: SelectedPagesLookalikeGroup[];
  onSplalGroupsChange?: (groups: SelectedPagesLookalikeGroup[]) => void;
}

const ENGAGEMENT_OPTIONS: { value: EngagementType; label: string }[] = [
  { value: "fb_likes", label: "FB Likes" },
  { value: "fb_engagement_365d", label: "FB Engagement 365d" },
  { value: "ig_followers", label: "IG Followers" },
  { value: "ig_engagement_365d", label: "IG Engagement 365d" },
];

const LOOKALIKE_RANGES: LookalikeRange[] = ["0-1%", "1-2%", "2-3%"];

function createEmptyGroup(): PageAudienceGroup {
  return {
    id: crypto.randomUUID(),
    name: "",
    pageIds: [],
    engagementTypes: ["fb_likes", "fb_engagement_365d", "ig_followers", "ig_engagement_365d"],
    lookalike: false,
    lookalikeRanges: ["0-1%"],
    customAudienceIds: [],
  };
}

function formatFanCount(n?: number): string {
  if (!n) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  return `${Math.floor(diffHrs / 24)}d ago`;
}

function RateLimitStatusRow({ rateLimit }: { rateLimit: { appCallCountPct: number | null; businessCallCountPct: number | null } }) {
  const appPct = rateLimit.appCallCountPct;
  const bizPct = rateLimit.businessCallCountPct;
  const maxPct = Math.max(appPct ?? 0, bizPct ?? 0);
  if (appPct == null && bizPct == null) return null;

  const color = maxPct >= 80 ? "text-destructive" : maxPct >= 60 ? "text-warning-foreground" : "text-muted-foreground";

  return (
    <div className={`flex items-center gap-3 pt-0.5 ${color}`}>
      {appPct != null && (
        <span>App usage: <strong>{appPct}%</strong></span>
      )}
      {bizPct != null && (
        <span>Biz usage: <strong>{bizPct}%</strong></span>
      )}
      {maxPct >= 80 && <AlertCircle className="h-3 w-3 shrink-0" />}
    </div>
  );
}

function PageThumbnail({ page }: { page: MetaApiPage }) {
  const url = page.picture?.data?.url;
  if (!url) {
    return (
      <div className="h-8 w-8 shrink-0 rounded bg-muted flex items-center justify-center">
        <User className="h-4 w-4 text-muted-foreground" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={page.name}
      className="h-8 w-8 shrink-0 rounded object-cover"
      loading="lazy"
    />
  );
}

/**
 * Derives per-page capability flags from enrichment data.
 * FB source capabilities (Likes/Engagement) can't be validated pre-launch,
 * so they start as `true` (assumed available) unless explicitly overridden
 * via `page.capabilities.fbLikesSource === false` after a launch failure.
 */
function inferCapabilities(page: MetaApiPage): PageCapabilities {
  const hasIg =
    page.hasInstagramLinked ??
    !!(page.instagram_business_account?.id ?? page.connected_instagram_account?.id);
  const stored: Partial<PageCapabilities> = page.capabilities ?? {};

  const fbLikesSource = stored.fbLikesSource ?? true;
  const fbEngagementSource = stored.fbEngagementSource ?? true;
  const igFollowersSource = stored.igFollowersSource ?? hasIg;
  const igEngagementSource = stored.igEngagementSource ?? hasIg;
  const lookalikeEligible = stored.lookalikeEligible ?? (fbLikesSource || hasIg);

  return {
    standardPageAudience: true,
    fbLikesSource,
    fbEngagementSource,
    igFollowersSource,
    igEngagementSource,
    lookalikeEligible,
    failureReasons: stored.failureReasons,
  };
}

function PageRow({
  page,
  selected,
  onToggle,
}: {
  page: MetaApiPage;
  selected: boolean;
  onToggle: () => void;
}) {
  // Prefer enriched fields, fall back to raw API fields
  const fbFollowers = page.facebookFollowers ?? page.fan_count;
  const fbFollowersFmt = fbFollowers !== undefined ? formatFanCount(fbFollowers) : null;
  const hasIg =
    page.hasInstagramLinked ??
    !!(page.instagram_business_account?.id ?? page.connected_instagram_account?.id);
  const igHandle = page.instagramUsername ?? null;
  const igFollowers = page.instagramFollowers !== undefined ? formatFanCount(page.instagramFollowers) : null;

  // Only show explicit capability failures (set after a launch attempt)
  const caps = page.capabilities;
  const fbLikesFailed    = caps?.fbLikesSource    === false;
  const fbEngageFailed   = caps?.fbEngagementSource === false;
  const lookalikeBlocked = caps?.lookalikeEligible  === false;

  return (
    <label className="flex cursor-pointer items-start gap-3 border-b border-border px-3 py-2 last:border-b-0 hover:bg-muted/50">
      <Checkbox checked={selected} onChange={onToggle} className="mt-0.5 shrink-0" />
      <PageThumbnail page={page} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium leading-snug">{page.name}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {fbFollowersFmt
            ? <span>FB: {fbFollowersFmt} followers</span>
            : <span className="italic">Followers unavailable</span>
          }
        </p>
        {hasIg ? (
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            IG: {igHandle ? `@${igHandle}` : "(no username)"}
            {igFollowers && <span> · {igFollowers} followers</span>}
          </p>
        ) : (
          <p className="mt-0.5 text-[11px] text-muted-foreground/50 italic">No linked Instagram</p>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 self-start">
        {page.category && (
          <Badge variant="outline" className="text-[10px]">
            {page.category}
          </Badge>
        )}

        {/* IG capability — shown once enrichment has run */}
        {page.hasInstagramLinked != null && (
          <Badge
            variant={page.hasInstagramLinked ? "primary" : "outline"}
            className="text-[10px]"
          >
            {page.hasInstagramLinked
              ? page.igLinkSource === "connected_instagram_account"
                ? "IG connected ✓"
                : "IG source ✓"
              : "No IG source"}
          </Badge>
        )}

        {/* FB source failures — only visible after a failed launch attempt */}
        {fbLikesFailed && (
          <Badge variant="destructive" className="text-[10px]">
            FB Likes N/A
          </Badge>
        )}
        {fbEngageFailed && (
          <Badge variant="destructive" className="text-[10px]">
            FB Engagement N/A
          </Badge>
        )}
        {lookalikeBlocked && (
          <Badge variant="destructive" className="text-[10px]">
            Lookalike N/A
          </Badge>
        )}

        {fbFollowers != null && fbFollowers === 0 && (
          <Badge variant="outline" className="text-[10px] text-muted-foreground/70">
            0 followers
          </Badge>
        )}
      </div>
    </label>
  );
}

function SectionHeader({
  icon,
  label,
  count,
  loading,
  error,
}: {
  icon: React.ReactNode;
  label: string;
  count?: number;
  loading?: boolean;
  error?: string | null;
}) {
  return (
    <div className="flex items-center gap-2 pb-1">
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      {!loading && typeof count === "number" && (
        <span className="text-xs text-muted-foreground">({count})</span>
      )}
      {error && <AlertCircle className="h-3 w-3 text-destructive" aria-label={error} />}
    </div>
  );
}

// ── IG Diagnostic Panel ────────────────────────────────────────────────────

type IgStatus =
  | "linked_business_account"
  | "linked_connected_account"
  | "linked_both"
  | "not_linked"
  | "api_error";

interface IgDiagResult {
  pageId: string;
  pageName: string | null;
  pageCategory: string | null;
  tokenType: string;
  rawResponse: Record<string, unknown>;
  instagramBusinessAccount: { id: string; username?: string | null; name?: string | null; followers_count?: number | null } | null;
  connectedInstagramAccount: { id: string; username?: string | null; name?: string | null; followers_count?: number | null } | null;
  resolvedIgId: string | null;
  resolvedIgSource: "instagram_business_account" | "connected_instagram_account" | null;
  status: IgStatus;
  diagnosis: string;
  apiError?: string;
  pageTokenResult?: Omit<IgDiagResult, "pageId" | "pageName" | "pageTokenResult">;
}

const STATUS_COLORS: Record<IgStatus, string> = {
  linked_business_account: "text-success",
  linked_connected_account: "text-primary",
  linked_both: "text-success",
  not_linked: "text-warning",
  api_error: "text-destructive",
};

const STATUS_LABELS: Record<IgStatus, string> = {
  linked_business_account: "IG linked (Business)",
  linked_connected_account: "IG linked (Connected)",
  linked_both: "IG linked (both fields)",
  not_linked: "No IG linked",
  api_error: "API error",
};

function IgDiagnosticPanel({
  groupId,
  selectedPageIds,
  allPages,
  facebookToken,
}: {
  groupId: string;
  selectedPageIds: string[];
  allPages: MetaApiPage[];
  facebookToken: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<IgDiagResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runRef = useRef(0);

  const runDiagnostic = useCallback(async () => {
    if (!facebookToken) {
      setError("No Facebook token available — connect Facebook first.");
      return;
    }
    if (selectedPageIds.length === 0) {
      setError("Select at least one page to run the diagnostic.");
      return;
    }

    const run = ++runRef.current;
    setLoading(true);
    setError(null);
    setResults(null);
    setOpen(true);

    // Collect page tokens if available in cache
    const pageTokens: Record<string, string> = {};
    for (const pid of selectedPageIds) {
      const p = allPages.find((pp) => pp.id === pid);
      if (p?.access_token) pageTokens[pid] = p.access_token;
    }

    try {
      const res = await fetch("/api/meta/pages/diagnose", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${facebookToken}`,
        },
        body: JSON.stringify({
          pageIds: selectedPageIds,
          ...(Object.keys(pageTokens).length > 0 ? { pageTokens } : {}),
        }),
      });
      const json = await res.json() as { diagnostics?: IgDiagResult[]; error?: string };
      if (run !== runRef.current) return;
      if (json.error) { setError(json.error); return; }
      setResults(json.diagnostics ?? []);
    } catch (e) {
      if (run === runRef.current) setError(String(e));
    } finally {
      if (run === runRef.current) setLoading(false);
    }
  }, [facebookToken, selectedPageIds, allPages]);

  return (
    <div className="rounded-lg border border-border bg-muted/10 text-xs">
      <button
        type="button"
        onClick={() => {
          if (!open && !results) {
            runDiagnostic();
          } else {
            setOpen((v) => !v);
          }
        }}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/30"
      >
        <Activity className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="font-medium text-muted-foreground">IG Diagnostic</span>
        <span className="ml-1 text-muted-foreground/60">
          ({selectedPageIds.length} selected page{selectedPageIds.length !== 1 ? "s" : ""})
        </span>
        {loading && <Loader2 className="ml-auto h-3 w-3 animate-spin" />}
        {results && !loading && (
          <>
            <span className="ml-auto text-muted-foreground/60">
              {results.filter((r) => r.resolvedIgId).length}/{results.length} have IG
            </span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); runDiagnostic(); }}
              className="ml-2 text-muted-foreground hover:text-foreground"
              title="Re-run diagnostic"
            >
              <RefreshCw className="h-3 w-3" />
            </button>
          </>
        )}
        {!loading && (open
          ? <ChevronUp className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
          : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="border-t border-border px-3 py-2 space-y-2">
          {error && (
            <p className="text-destructive">{error}</p>
          )}
          {loading && (
            <p className="text-muted-foreground italic">Running diagnostic…</p>
          )}
          {results && results.map((r) => (
            <div
              key={r.pageId}
              className="rounded border border-border bg-background px-3 py-2 space-y-1.5"
            >
              {/* Page header */}
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="font-semibold">{r.pageName ?? r.pageId}</span>
                  {r.pageCategory && (
                    <span className="ml-1.5 text-muted-foreground">({r.pageCategory})</span>
                  )}
                  <span className="ml-1.5 text-[10px] text-muted-foreground/60">
                    id: {r.pageId}
                  </span>
                </div>
                <span className={`shrink-0 font-medium ${STATUS_COLORS[r.status]}`}>
                  {STATUS_LABELS[r.status]}
                </span>
              </div>

              {/* IG field results */}
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                <div>
                  <span className="text-muted-foreground">instagram_business_account: </span>
                  {r.instagramBusinessAccount
                    ? <span className="text-success font-medium">id={r.instagramBusinessAccount.id}{r.instagramBusinessAccount.username ? ` @${r.instagramBusinessAccount.username}` : ""}</span>
                    : <span className="text-muted-foreground/50 italic">null</span>
                  }
                </div>
                <div>
                  <span className="text-muted-foreground">connected_instagram_account: </span>
                  {r.connectedInstagramAccount
                    ? <span className="text-primary font-medium">id={r.connectedInstagramAccount.id}{r.connectedInstagramAccount.username ? ` @${r.connectedInstagramAccount.username}` : ""}</span>
                    : <span className="text-muted-foreground/50 italic">null</span>
                  }
                </div>
              </div>

              {/* Resolved result */}
              {r.resolvedIgId && (
                <p className="text-success">
                  ✓ Resolved IG: <strong>{r.resolvedIgId}</strong>
                  <span className="ml-1.5 text-muted-foreground">via {r.resolvedIgSource}</span>
                </p>
              )}

              {/* Token context */}
              <p className="text-muted-foreground/70">
                Token: <span className="font-mono">{r.tokenType}</span>
              </p>

              {/* Diagnosis text */}
              <p className={`leading-snug ${r.status === "not_linked" || r.status === "api_error" ? "text-warning" : "text-muted-foreground"}`}>
                {r.diagnosis}
              </p>

              {/* Page token comparison (if different result) */}
              {r.pageTokenResult && (
                <div className="rounded border border-primary/20 bg-primary/5 px-2 py-1.5 space-y-0.5">
                  <p className="font-medium text-primary">Page token result (different from user token):</p>
                  <p>
                    <span className="text-muted-foreground">instagram_business_account: </span>
                    {r.pageTokenResult.instagramBusinessAccount
                      ? <span className="text-success">id={r.pageTokenResult.instagramBusinessAccount.id}</span>
                      : <span className="italic text-muted-foreground/50">null</span>
                    }
                  </p>
                  <p>
                    <span className="text-muted-foreground">connected_instagram_account: </span>
                    {r.pageTokenResult.connectedInstagramAccount
                      ? <span className="text-primary">id={r.pageTokenResult.connectedInstagramAccount.id}</span>
                      : <span className="italic text-muted-foreground/50">null</span>
                    }
                  </p>
                  <p className="text-muted-foreground">{r.pageTokenResult.diagnosis}</p>
                </div>
              )}

              {/* Raw response toggle */}
              <details className="text-[10px]">
                <summary className="cursor-pointer text-muted-foreground/60 hover:text-muted-foreground">
                  Raw API response
                </summary>
                <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded bg-muted/50 p-2 font-mono text-[10px]">
                  {JSON.stringify(r.rawResponse, null, 2)}
                </pre>
              </details>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function PageAudiencesPanel({
  groups,
  onChange,
  adAccountId,
  splalGroups = [],
  onSplalGroupsChange,
}: PageAudiencesPanelProps) {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(groups[0]?.id ?? null);
  const [caSearch, setCaSearch] = useState("");
  const [userPagesSearch, setUserPagesSearch] = useState("");
  const [confirmClearGroupId, setConfirmClearGroupId] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  const CONFIRM_THRESHOLD = 5;

  // ── Real page data ───────────────────────────────────────────────────────
  const businessPages = useFetchPages(adAccountId);
  const businessPageIds = useMemo(
    () => new Set(businessPages.data.map((p) => p.id)),
    [businessPages.data],
  );
  const additionalPages = useFetchAdditionalPages(businessPageIds);

  // User's own Facebook pages (loaded via their provider_token)
  const userPages = useFetchUserPages();
  // Token needed for the IG diagnostic panel
  const { token: fbToken } = useFacebookToken();

  // ── Load mode selector — persists the user's last choice ─────────────────
  // Default to the mode that was used last (from cache), falling back to "sample".
  const [selectedLoadMode, setSelectedLoadMode] = useState<PageLoadMode>(
    () => (userPages.loadMode ?? "sample"),
  );
  // Keep in sync with the hydrated cache value after mount
  useEffect(() => {
    if (userPages.loadMode && !userPages.loading) {
      setSelectedLoadMode(userPages.loadMode);
    }
  }, [userPages.loadMode, userPages.loading]);

  // All pages available for selection (deduped across all sources)
  const allPages = useMemo(() => {
    const seen = new Set<string>();
    const result: MetaApiPage[] = [];
    for (const p of [...businessPages.data, ...additionalPages.pages, ...userPages.data]) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        result.push(p);
      }
    }
    return result;
  }, [businessPages.data, additionalPages.pages, userPages.data]);

  // Dynamic categories from loaded pages
  const categories = useMemo(() => {
    const cats = new Set<string>();
    allPages.forEach((p) => {
      if (p.category) cats.add(p.category);
    });
    return Array.from(cats).sort();
  }, [allPages]);

  // Category → page count mapping
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    allPages.forEach((p) => {
      if (p.category) counts[p.category] = (counts[p.category] ?? 0) + 1;
    });
    return counts;
  }, [allPages]);

  // How many pages from each category are already selected in a group
  const categorySelectedCounts = useCallback(
    (group: PageAudienceGroup) => {
      const counts: Record<string, number> = {};
      group.pageIds.forEach((pid) => {
        const page = allPages.find((p) => p.id === pid);
        if (page?.category) counts[page.category] = (counts[page.category] ?? 0) + 1;
      });
      return counts;
    },
    [allPages],
  );

  // Filtered page lists (apply search + category filter within each section)
  const applyFilters = useCallback(
    (pages: MetaApiPage[]) =>
      pages.filter((p) => {
        const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase());
        const matchCat = !activeCategory || p.category === activeCategory;
        return matchSearch && matchCat;
      }),
    [search, activeCategory],
  );

  const filteredBusiness = useMemo(
    () => applyFilters(businessPages.data),
    [applyFilters, businessPages.data],
  );

  const filteredAdditional = useMemo(
    () => applyFilters(additionalPages.pages),
    [applyFilters, additionalPages.pages],
  );

  // User's own Facebook pages — deduped then filtered by userPagesSearch
  const filteredUserPages = useMemo(() => {
    const existingIds = new Set([
      ...businessPages.data.map((p) => p.id),
      ...additionalPages.pages.map((p) => p.id),
    ]);
    const unique = userPages.data.filter((p) => !existingIds.has(p.id));
    if (!userPagesSearch.trim()) return unique;
    const q = userPagesSearch.toLowerCase();
    return unique.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.instagramUsername?.toLowerCase().includes(q) ?? false),
    );
  }, [userPages.data, businessPages.data, additionalPages.pages, userPagesSearch]);

  // ── Custom audiences for optional group enrichment ───────────────────────
  const customAudiences = useFetchCustomAudiences(adAccountId);

  const filteredCA = useMemo(() => {
    if (!customAudiences.loaded) return [];
    if (!caSearch) return customAudiences.data;
    return customAudiences.data.filter((a) =>
      a.name.toLowerCase().includes(caSearch.toLowerCase()),
    );
  }, [customAudiences.loaded, customAudiences.data, caSearch]);

  // ── Clear helpers ────────────────────────────────────────────────────────
  const totalSelectedPages = useMemo(
    () => groups.reduce((sum, g) => sum + g.pageIds.length, 0),
    [groups],
  );

  const clearGroupPages = (groupId: string) => {
    updateGroup(groupId, { pageIds: [] });
    setConfirmClearGroupId(null);
  };

  const handleClearGroupPages = (groupId: string) => {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    if (group.pageIds.length >= CONFIRM_THRESHOLD) {
      setConfirmClearGroupId(groupId);
    } else {
      clearGroupPages(groupId);
    }
  };

  const clearAllPages = () => {
    onChange(groups.map((g) => ({ ...g, pageIds: [] })));
    setConfirmClearAll(false);
  };

  const handleClearAll = () => {
    if (totalSelectedPages >= CONFIRM_THRESHOLD) {
      setConfirmClearAll(true);
    } else {
      clearAllPages();
    }
  };

  // ── Group helpers ────────────────────────────────────────────────────────
  const addGroup = () => {
    const g = createEmptyGroup();
    onChange([...groups, g]);
    setExpandedGroupId(g.id);
  };

  const removeGroup = (id: string) => onChange(groups.filter((g) => g.id !== id));

  const updateGroup = useCallback(
    (id: string, patch: Partial<PageAudienceGroup>) =>
      onChange(groups.map((g) => (g.id === id ? { ...g, ...patch } : g))),
    [groups, onChange],
  );

  const togglePage = (groupId: string, pageId: string) => {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    const pageIds = group.pageIds.includes(pageId)
      ? group.pageIds.filter((id) => id !== pageId)
      : [...group.pageIds, pageId];
    updateGroup(groupId, { pageIds });
  };

  const handleCategoryClick = (category: string, groupId: string) => {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;

    if (activeCategory === category) {
      setActiveCategory(null);
      return;
    }

    setActiveCategory(category);
    const catPageIds = allPages
      .filter((p) => p.category === category)
      .map((p) => p.id);
    const merged = Array.from(new Set([...group.pageIds, ...catPageIds]));
    updateGroup(groupId, { pageIds: merged });
  };

  const toggleEngagement = (groupId: string, et: EngagementType) => {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    const types = group.engagementTypes.includes(et)
      ? group.engagementTypes.filter((t) => t !== et)
      : [...group.engagementTypes, et];
    updateGroup(groupId, { engagementTypes: types });
  };

  const toggleCustomAudience = (groupId: string, caId: string) => {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    const ids = group.customAudienceIds.includes(caId)
      ? group.customAudienceIds.filter((id) => id !== caId)
      : [...group.customAudienceIds, caId];
    updateGroup(groupId, { customAudienceIds: ids });
  };

  const totalPagesAvailable = businessPages.data.length + additionalPages.pages.length;

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Page Groups</h3>
          <p className="text-xs text-muted-foreground">
            {totalPagesAvailable > 0
              ? `${totalPagesAvailable} pages loaded`
              : businessPages.loading
              ? "Loading pages…"
              : "No pages loaded"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {totalSelectedPages > 0 && !confirmClearAll && (
            <Button variant="ghost" size="sm" onClick={handleClearAll}>
              <XCircle className="h-3.5 w-3.5" />
              Clear All ({totalSelectedPages})
            </Button>
          )}
          {confirmClearAll && (
            <div className="flex items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-1">
              <span className="text-xs text-destructive">
                Clear {totalSelectedPages} pages?
              </span>
              <button type="button" onClick={clearAllPages} className="text-xs font-medium text-destructive hover:underline">
                Confirm
              </button>
              <button type="button" onClick={() => setConfirmClearAll(false)} className="text-xs text-muted-foreground hover:underline">
                Cancel
              </button>
            </div>
          )}
          <Button size="sm" onClick={addGroup}>
            <Plus className="h-3.5 w-3.5" />
            New Group
          </Button>
        </div>
      </div>

      {groups.length === 0 && (
        <Card className="py-8 text-center">
          <p className="text-sm text-muted-foreground">
            Create a page group to start adding targeting audiences.
          </p>
          <Button size="sm" className="mt-3" onClick={addGroup}>
            <Plus className="h-3.5 w-3.5" />
            New Group
          </Button>
        </Card>
      )}

      {groups.map((group) => {
        const isExpanded = expandedGroupId === group.id;
        const selectedByCategory = categorySelectedCounts(group);

        return (
          <Card key={group.id} className="overflow-hidden p-0">
            {/* ── Group header ── */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => setExpandedGroupId(isExpanded ? null : group.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setExpandedGroupId(isExpanded ? null : group.id);
                }
              }}
              className="flex w-full cursor-pointer items-center justify-between p-4 text-left hover:bg-muted/50"
            >
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold">
                  {group.name || "Untitled Group"}
                </span>
                <Badge variant="primary">{group.pageIds.length} pages</Badge>
                {group.customAudienceIds.length > 0 && (
                  <Badge variant="warning">{group.customAudienceIds.length} custom</Badge>
                )}
                {group.lookalike && (
                  <Badge variant="success">{(group.lookalikeRanges ?? []).join(", ") || "0-1%"} LAL</Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); removeGroup(group.id); }}
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
                {isExpanded
                  ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
                  : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
              </div>
            </div>

            {isExpanded && (
              <div className="space-y-4 border-t border-border p-4">
                {/* Group name + clear */}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1">
                    <Input
                      label="Group Name"
                      value={group.name}
                      onChange={(e) => updateGroup(group.id, { name: e.target.value })}
                      placeholder="e.g. Lineup Fans"
                    />
                  </div>
                  {group.pageIds.length > 0 && confirmClearGroupId !== group.id && (
                    <button
                      type="button"
                      onClick={() => handleClearGroupPages(group.id)}
                      className="mt-5 shrink-0 flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-colors"
                    >
                      <XCircle className="h-3 w-3" />
                      Clear ({group.pageIds.length})
                    </button>
                  )}
                  {confirmClearGroupId === group.id && (
                    <div className="mt-5 shrink-0 flex items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1">
                      <span className="text-[10px] text-destructive">
                        Clear {group.pageIds.length}?
                      </span>
                      <button type="button" onClick={() => clearGroupPages(group.id)} className="text-[10px] font-medium text-destructive hover:underline">
                        Yes
                      </button>
                      <button type="button" onClick={() => setConfirmClearGroupId(null)} className="text-[10px] text-muted-foreground hover:underline">
                        No
                      </button>
                    </div>
                  )}
                </div>

                {/* Capability pre-flight summary */}
                {(() => {
                  if (group.pageIds.length === 0) return null;
                  const selectedPageObjs = group.pageIds
                    .map((id) => allPages.find((p) => p.id === id))
                    .filter(Boolean) as MetaApiPage[];

                  if (selectedPageObjs.length === 0) return null;

                  const noIg = selectedPageObjs.filter((p) => !inferCapabilities(p).igFollowersSource);
                  const fbFailed = selectedPageObjs.filter((p) =>
                    p.capabilities?.fbLikesSource === false || p.capabilities?.fbEngagementSource === false,
                  );

                  if (noIg.length === 0 && fbFailed.length === 0) return null;

                  return (
                    <div className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs space-y-1">
                      <p className="font-medium text-foreground flex items-center gap-1.5">
                        <AlertCircle className="h-3.5 w-3.5 text-warning shrink-0" />
                        Capability notes for {selectedPageObjs.length} selected page{selectedPageObjs.length !== 1 ? "s" : ""}
                      </p>
                      {noIg.length > 0 && (
                        <p className="text-muted-foreground">
                          <span className="font-medium">{noIg.length}</span> page{noIg.length !== 1 ? "s have" : " has"} no linked Instagram — IG source audiences will be skipped automatically.
                        </p>
                      )}
                      {fbFailed.length > 0 && (
                        <p className="text-muted-foreground">
                          <span className="font-medium">{fbFailed.length}</span> page{fbFailed.length !== 1 ? "s" : ""} previously failed FB source audience creation (event-source permission missing). Consider disabling engagement audiences below.
                        </p>
                      )}
                      {noIg.length === selectedPageObjs.length && !group.lookalike && (
                        <p className="text-muted-foreground/80 italic text-[10px]">
                          No IG-capable pages — lookalike seeding will rely solely on FB sources.
                        </p>
                      )}
                    </div>
                  );
                })()}

                {/* IG Diagnostic — for selected pages with IG issues or enrichment */}
                {group.pageIds.length > 0 && (
                  <IgDiagnosticPanel
                    groupId={group.id}
                    selectedPageIds={group.pageIds}
                    allPages={allPages}
                    facebookToken={fbToken}
                  />
                )}

                {/* Engagement types */}
                <div>
                  <div className="mb-1.5 flex items-baseline justify-between gap-2">
                    <label className="block text-sm font-medium">Engagement Types</label>
                    <span className="text-[11px] text-muted-foreground">
                      {group.engagementTypes.length === 0
                        ? "None selected — standard page ad set only"
                        : `${group.engagementTypes.length} type${group.engagementTypes.length !== 1 ? "s" : ""} selected`}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {ENGAGEMENT_OPTIONS.map((eo) => (
                      <button
                        key={eo.value}
                        type="button"
                        onClick={() => toggleEngagement(group.id, eo.value)}
                        className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors
                          ${group.engagementTypes.includes(eo.value)
                            ? "border-success bg-success/15 text-success"
                            : "border-border-strong text-muted-foreground hover:border-foreground/20"
                          }`}
                      >
                        {eo.label}
                      </button>
                    ))}
                  </div>
                  <div className="mt-1.5 space-y-0.5">
                    {group.engagementTypes.includes("fb_likes") && (
                      <p className="text-[11px] text-muted-foreground">
                        <span className="font-medium text-success">FB Likes</span> — engagement audience auto-created at launch from selected pages
                      </p>
                    )}
                    {group.engagementTypes.includes("fb_engagement_365d") && (
                      <p className="text-[11px] text-muted-foreground">
                        <span className="font-medium text-success">FB Engagement 365d</span> — engagement audience auto-created at launch from selected pages
                      </p>
                    )}
                    {group.engagementTypes.includes("ig_followers") && (
                      <p className="text-[11px] text-muted-foreground">
                        <span className="font-medium text-success">IG Followers</span> — engagement audience auto-created at launch (requires linked IG account)
                      </p>
                    )}
                    {group.engagementTypes.includes("ig_engagement_365d") && (
                      <p className="text-[11px] text-muted-foreground">
                        <span className="font-medium text-success">IG Engagement 365d</span> — engagement audience auto-created at launch (requires linked IG account)
                      </p>
                    )}
                  </div>
                </div>{/* end engagement-types opacity wrapper */}

                {/* Lookalike */}
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => {
                      const patch: Partial<PageAudienceGroup> = { lookalike: !group.lookalike };
                      if (!group.lookalike && !(group.lookalikeRanges?.length)) {
                        patch.lookalikeRanges = ["0-1%"];
                      }
                      updateGroup(group.id, patch);
                    }}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors
                      ${group.lookalike
                        ? "border-foreground bg-foreground text-background"
                        : "border-border-strong text-muted-foreground hover:border-foreground/20"
                      }`}
                  >
                    Lookalike
                  </button>
                  {group.lookalike && (
                    <div className="flex gap-1">
                      {LOOKALIKE_RANGES.map((r) => {
                        const ranges = group.lookalikeRanges ?? [];
                        const isActive = ranges.includes(r);
                        return (
                          <button
                            key={r}
                            type="button"
                            onClick={() => {
                              const next = isActive
                                ? ranges.filter((x) => x !== r)
                                : [...ranges, r];
                              updateGroup(group.id, {
                                lookalikeRanges: next.length > 0 ? next : ["0-1%"],
                              });
                            }}
                            className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors
                              ${isActive
                                ? "border-primary bg-primary-light text-primary"
                                : "border-border text-muted-foreground hover:bg-muted"
                              }`}
                          >
                            {r}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* ── Page selector ── */}
                <div>
                  <div className="mb-1.5 flex items-baseline justify-between">
                    <label className="text-sm font-medium">Select Pages</label>
                    <div className="flex items-center gap-2">
                      {group.pageIds.length > 0 && (
                        <button
                          type="button"
                          onClick={() => updateGroup(group.id, { pageIds: [] })}
                          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive"
                        >
                          <XCircle className="h-3 w-3" />
                          Clear selected ({group.pageIds.length})
                        </button>
                      )}
                      {categories.length > 0 && (
                        <span className="text-[11px] text-muted-foreground">
                          Click a category to auto-select all
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Category chips */}
                  {categories.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {categories.map((cat) => {
                        const total = categoryCounts[cat] ?? 0;
                        const selected = selectedByCategory[cat] ?? 0;
                        const allSelected = selected >= total;
                        return (
                          <button
                            key={cat}
                            type="button"
                            onClick={() => handleCategoryClick(cat, group.id)}
                            className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors
                              ${activeCategory === cat ? "bg-foreground text-background" : ""}
                              ${allSelected && activeCategory !== cat ? "bg-success/15 text-success ring-1 ring-success/30" : ""}
                              ${!allSelected && activeCategory !== cat ? "bg-muted text-muted-foreground hover:text-foreground" : ""}`}
                          >
                            {cat} {selected > 0 ? `(${selected}/${total})` : `(${total})`}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <SearchInput
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onClear={() => setSearch("")}
                    placeholder="Search pages…"
                  />

                  <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-border">
                    {/* Business Manager section */}
                    {(businessPages.loading || businessPages.data.length > 0 || businessPages.error) && (
                      <div>
                        <div className="sticky top-0 flex items-center gap-1.5 border-b border-border bg-muted/80 px-3 py-1.5 backdrop-blur-sm">
                          <Building2 className="h-3 w-3 text-muted-foreground" />
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Business Manager
                          </span>
                          {businessPages.loading && (
                            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                          )}
                          {!businessPages.loading && (
                            <span className="text-[10px] text-muted-foreground">
                              ({filteredBusiness.length})
                            </span>
                          )}
                          {businessPages.error && (
                            <span className="ml-1 text-[10px] text-destructive" title={businessPages.error}>
                              Error loading
                            </span>
                          )}
                        </div>
                        {filteredBusiness.map((page) => (
                          <PageRow
                            key={page.id}
                            page={page}
                            selected={group.pageIds.includes(page.id)}
                            onToggle={() => togglePage(group.id, page.id)}
                          />
                        ))}
                        {!businessPages.loading && filteredBusiness.length === 0 && businessPages.data.length > 0 && (
                          <p className="px-3 py-3 text-center text-xs text-muted-foreground">
                            No Business Manager pages match the filter.
                          </p>
                        )}
                        {!businessPages.loading && !businessPages.error && businessPages.data.length === 0 && !adAccountId && (
                          <p className="px-3 py-3 text-center text-xs text-muted-foreground">
                            Select an ad account to load Business Manager pages.
                          </p>
                        )}
                      </div>
                    )}

                    {/* Additional pages section */}
                    {additionalPages.pages.length > 0 && (
                      <div>
                        <div className="sticky top-0 flex items-center gap-1.5 border-b border-t border-border bg-muted/80 px-3 py-1.5 backdrop-blur-sm">
                          <User className="h-3 w-3 text-muted-foreground" />
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Additional Pages
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            ({filteredAdditional.length} loaded)
                          </span>
                        </div>
                        {filteredAdditional.map((page) => (
                          <PageRow
                            key={page.id}
                            page={page}
                            selected={group.pageIds.includes(page.id)}
                            onToggle={() => togglePage(group.id, page.id)}
                          />
                        ))}
                      </div>
                    )}

                    {/* Empty state */}
                    {!businessPages.loading &&
                      filteredBusiness.length === 0 &&
                      filteredAdditional.length === 0 &&
                      allPages.length > 0 && (
                        <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                          No pages match your search.
                        </p>
                      )}
                  </div>

                  {/* Load All Pages button */}
                  <div className="mt-2 flex items-center gap-3">
                    {additionalPages.hasMore && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={additionalPages.loadMore}
                        disabled={additionalPages.loading}
                        className="gap-1.5"
                      >
                        {additionalPages.loading
                          ? <><Loader2 className="h-3 w-3 animate-spin" /> Loading…</>
                          : <><Plus className="h-3 w-3" /> Load All Pages</>}
                      </Button>
                    )}
                    {additionalPages.error && (
                      <p className="flex items-center gap-1 text-xs text-destructive">
                        <AlertCircle className="h-3 w-3" />
                        {additionalPages.error}
                      </p>
                    )}
                    {!additionalPages.hasMore && additionalPages.pages.length > 0 && (
                      <span className="text-xs text-muted-foreground">
                        All {additionalPages.pages.length} additional pages loaded
                      </span>
                    )}
                  </div>

                  {/* ── My Facebook Pages (user's own via provider token) ── */}
                  <div className="mt-3 border-t border-border pt-3">
                    {/* Header row: title + total count */}
                    <div className="flex items-center justify-between">
                      <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-foreground">
                        <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span>My Facebook Pages</span>
                        {userPages.count > 0 && (
                          <span className="text-muted-foreground">({userPages.count})</span>
                        )}
                        {userPages.fromCache && userPages.loadedAt && !userPages.loading && (
                          <span className="flex items-center gap-0.5 text-muted-foreground font-normal">
                            <Clock className="h-3 w-3" />
                            {formatRelativeTime(userPages.loadedAt)}
                          </span>
                        )}
                        {userPages.loading && (
                          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                        )}
                      </div>
                    </div>

                    {/* Mode selector + load button */}
                    {!userPages.loading && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {/* Segmented control */}
                        <div className="flex rounded-md border border-border overflow-hidden text-xs shrink-0">
                          {(["test", "sample", "all"] as PageLoadMode[]).map((mode) => (
                            <button
                              key={mode}
                              type="button"
                              onClick={() => setSelectedLoadMode(mode)}
                              className={`px-2.5 py-1 font-medium transition-colors border-r border-border last:border-r-0 ${
                                selectedLoadMode === mode
                                  ? "bg-foreground text-background"
                                  : "bg-background text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              {mode === "test" ? "10" : mode === "sample" ? "50" : "All"}
                            </button>
                          ))}
                        </div>

                        {/* Load / Reload button */}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => userPages.fetch(selectedLoadMode)}
                          disabled={userPages.loading}
                          className="gap-1.5 h-7 shrink-0 text-xs"
                        >
                          {userPages.loaded || userPages.loadStatus === "partial" || userPages.fromCache ? (
                            <><RefreshCw className="h-3 w-3" /> Reload {selectedLoadMode === "test" ? "10" : selectedLoadMode === "sample" ? "50" : "All"} Pages</>
                          ) : (
                            <><Plus className="h-3 w-3" /> Load {selectedLoadMode === "test" ? "10" : selectedLoadMode === "sample" ? "50" : "All"} Pages</>
                          )}
                        </Button>

                        {/* Mode hints */}
                        <span className="text-[10px] text-muted-foreground">
                          {selectedLoadMode === "test"
                            ? "10 pages · fast test · no enrichment"
                            : selectedLoadMode === "sample"
                              ? "50 pages · enriched · good default"
                              : "All pages · full enrichment · may take a while"}
                        </span>
                      </div>
                    )}

                    {/* Rate-limit note */}
                    {!userPages.loading && (
                      <p className="mt-1 text-[10px] text-muted-foreground/70">
                        Use smaller loads for testing to avoid rate-limit issues.
                      </p>
                    )}

                    {/* ── Live progress panel ─────────────────────────────── */}
                    {userPages.loading && (
                      <div className="mt-2 rounded-md border border-border bg-muted/30 px-3 py-2.5 text-xs space-y-1.5">
                        {/* Status heading */}
                        <div className="flex items-center gap-2">
                          <Loader2 className="h-3 w-3 animate-spin shrink-0 text-muted-foreground" />
                          <span className="font-medium text-foreground">
                            {userPages.rateLimitWaiting
                              ? `Rate limit — waiting ${Math.round((userPages.rateLimitWaitMs ?? 0) / 1000)}s before retry…`
                              : userPages.loadStatus === "enriching"
                                ? "Enriching page details…"
                                : userPages.loadMode === "test"
                                  ? "Loading 10 pages for testing…"
                                  : userPages.loadMode === "sample"
                                    ? "Loading 50 pages…"
                                    : "Loading all accessible pages…"}
                          </span>
                        </div>

                        {/* Progress grid */}
                        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-muted-foreground">
                          <span>Phase:</span>
                          <span className="font-medium text-foreground capitalize">
                            {userPages.rateLimitWaiting ? "rate limit backoff" : userPages.loadStatus}
                          </span>
                          <span>Pages loaded:</span>
                          <span className="font-mono font-medium text-foreground">{userPages.count}</span>
                          {userPages.loadStatus === "listing" && (
                            <>
                              <span>List batches:</span>
                              <span className="font-mono font-medium text-foreground">{userPages.batchesLoaded}</span>
                            </>
                          )}
                          {userPages.loadStatus === "enriching" && userPages.enrichChunksTotal > 0 && (
                            <>
                              <span>Enriched chunks:</span>
                              <span className="font-mono font-medium text-foreground">
                                {userPages.enrichChunksDone} / {userPages.enrichChunksTotal}
                              </span>
                            </>
                          )}
                        </div>

                        {/* Rate-limit status row */}
                        {userPages.rateLimit && (
                          <RateLimitStatusRow rateLimit={userPages.rateLimit} />
                        )}
                      </div>
                    )}

                    {/* ── Rate-limit warning (non-loading state) ──────────── */}
                    {!userPages.loading && userPages.rateLimit && (
                      (() => {
                        const pct = Math.max(
                          userPages.rateLimit.appCallCountPct ?? 0,
                          userPages.rateLimit.businessCallCountPct ?? 0,
                        );
                        if (pct < 60) return null;
                        return (
                          <div className={`mt-1.5 flex items-start gap-1.5 rounded-md border px-2.5 py-1.5 text-xs ${
                            pct >= 80
                              ? "border-destructive/30 bg-destructive/5 text-destructive"
                              : "border-warning/40 bg-warning/5 text-warning-foreground"
                          }`}>
                            <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                            <span>
                              Meta API usage at <strong>{pct}%</strong>.
                              {pct >= 80 ? " Slow down or you may hit the limit." : " Approaching rate limit."}
                            </span>
                          </div>
                        );
                      })()
                    )}

                    {/* ── Completion summary ───────────────────────────────── */}
                    {!userPages.loading && (userPages.loadStatus === "done" || (userPages.fromCache && userPages.loaded)) && (() => {
                      const withIg = userPages.data.filter((p) => p.hasInstagramLinked).length;
                      const modeLabel = userPages.loadMode === "test" ? "test mode"
                        : userPages.loadMode === "sample" ? "sample" : "all pages";
                      return (
                        <div className="mt-1.5 space-y-1">
                          <p className="text-xs text-muted-foreground">
                            {userPages.fromCache && !userPages.loaded ? "Cached: " : "Loaded "}
                            <span className="font-medium text-foreground">{userPages.count}</span> pages
                            {" "}(<span className="font-medium">{modeLabel}</span>)
                            {userPages.batchesLoaded > 0 && (
                              <> · <span className="font-medium text-foreground">{userPages.batchesLoaded}</span> batch{userPages.batchesLoaded !== 1 ? "es" : ""}</>
                            )}.
                            {!userPages.enrichmentSkipped && (
                              <> <span className="font-medium text-foreground">{withIg}</span> with linked Instagram.</>
                            )}
                            {userPages.enrichFallback && (
                              <span className="ml-1 text-warning"> (Instagram details unavailable — scope restricted)</span>
                            )}
                          </p>
                          {/* Test mode notice + enrich button */}
                          {userPages.enrichmentSkipped && (
                            <div className="flex items-center gap-2 rounded-md border border-primary/20 bg-primary-light px-2.5 py-1.5 text-xs">
                              <span className="text-muted-foreground flex-1">Fast test mode: enrichment skipped (no photos, followers, or IG data).</span>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 px-2 text-[11px] shrink-0"
                                onClick={userPages.enrich}
                                disabled={userPages.loading}
                              >
                                {userPages.loading ? <><Loader2 className="h-2.5 w-2.5 animate-spin" /> Enriching…</> : "Enrich loaded pages"}
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* ── Partial failure ──────────────────────────────────── */}
                    {!userPages.loading && userPages.loadStatus === "partial" && !userPages.fromCache && (
                      <div className="mt-1.5 rounded-md border border-warning/40 bg-warning/5 px-2.5 py-2 text-xs">
                        <p className="font-medium text-foreground">
                          Loaded {userPages.count} pages (stopped at batch {userPages.failedAtBatch ?? "?"}).
                        </p>
                        {userPages.error && (
                          <p className="mt-0.5 text-muted-foreground">{userPages.error}</p>
                        )}
                        <p className="mt-0.5 text-muted-foreground">Pages collected so far are still selectable.</p>
                      </div>
                    )}

                    {/* ── Hard error ───────────────────────────────────────── */}
                    {!userPages.loading && userPages.loadStatus === "error" && userPages.error && (
                      <p className="mt-1 flex items-center gap-1 text-xs text-destructive">
                        <AlertCircle className="h-3 w-3 shrink-0" />
                        {userPages.error}
                      </p>
                    )}

                    {/* ── Search input (shown once we have pages) ──────────── */}
                    {userPages.count > 0 && (
                      <div className="mt-2">
                        <SearchInput
                          value={userPagesSearch}
                          onChange={(e) => setUserPagesSearch(e.target.value)}
                          onClear={() => setUserPagesSearch("")}
                          placeholder="Search Facebook pages…"
                        />
                        {userPagesSearch.trim() && (
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            Showing {filteredUserPages.length} of {userPages.data.filter((p) => {
                              const existingIds = new Set([
                                ...businessPages.data.map((x) => x.id),
                                ...additionalPages.pages.map((x) => x.id),
                              ]);
                              return !existingIds.has(p.id);
                            }).length}
                          </p>
                        )}
                      </div>
                    )}

                    {/* ── Empty state ───────────────────────────────────────── */}
                    {!userPages.loading && userPages.loaded && filteredUserPages.length === 0 && !userPages.error && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {userPages.count === 0
                          ? "No pages found — reconnect Facebook with correct permissions."
                          : userPagesSearch
                            ? "No pages match your search."
                            : "All your Facebook pages are already shown above."}
                      </p>
                    )}

                    {/* ── Page list ─────────────────────────────────────────── */}
                    {filteredUserPages.length > 0 && (
                      <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-border bg-card">
                        {filteredUserPages.map((p) => (
                          <PageRow
                            key={p.id}
                            page={p}
                            selected={group.pageIds.includes(p.id)}
                            onToggle={() => togglePage(group.id, p.id)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Selected pages chips */}
                {group.pageIds.length > 0 && (
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">
                      Selected Pages ({group.pageIds.length})
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {group.pageIds.map((pid) => {
                        const page = allPages.find((p) => p.id === pid);
                        return (
                          <Badge
                            key={pid}
                            variant="primary"
                            onRemove={() => togglePage(group.id, pid)}
                          >
                            {page?.name ?? pid}
                          </Badge>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Custom audiences optional enrichment */}
                <div className="rounded-lg border border-dashed border-border-strong bg-muted/30 p-4 space-y-3">
                  {/* Header row */}
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <span className="text-sm font-medium">Custom Audiences</span>
                      <span className="ml-1.5 text-sm font-normal text-muted-foreground">
                        (optional — expand with hot/warm data)
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {!adAccountId ? (
                        <span className="text-xs text-muted-foreground">
                          Select an ad account first
                        </span>
                      ) : (
                        <>
                          {customAudiences.loaded && (
                            <span className="text-xs text-muted-foreground">
                              {customAudiences.data.length} loaded
                            </span>
                          )}
                          {!customAudiences.loaded && !customAudiences.loading && (
                            <span className="text-xs text-muted-foreground">0 loaded</span>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={customAudiences.fetch}
                            disabled={customAudiences.loading || !adAccountId}
                            className="gap-1.5"
                          >
                            {customAudiences.loading ? (
                              <><Loader2 className="h-3 w-3 animate-spin" /> Loading…</>
                            ) : customAudiences.loaded ? (
                              <><RefreshCw className="h-3 w-3" /> Refresh</>
                            ) : (
                              <>Load Custom Audiences</>
                            )}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Error */}
                  {customAudiences.error && (
                    <p className="flex items-center gap-1.5 text-xs text-destructive">
                      <AlertCircle className="h-3 w-3 shrink-0" />
                      {customAudiences.error}
                    </p>
                  )}

                  {/* List — only shown after a successful load */}
                  {customAudiences.loaded && (
                    <>
                      <SearchInput
                        value={caSearch}
                        onChange={(e) => setCaSearch(e.target.value)}
                        onClear={() => setCaSearch("")}
                        placeholder="Search custom audiences…"
                      />

                      {/* Select all / Clear all actions */}
                      {filteredCA.length > 0 && (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              const ids = new Set(group.customAudienceIds);
                              for (const ca of filteredCA) ids.add(ca.id);
                              updateGroup(group.id, { customAudienceIds: Array.from(ids) });
                            }}
                            className="text-[11px] font-medium text-primary hover:underline"
                          >
                            Select all ({filteredCA.length})
                          </button>
                          <span className="text-muted-foreground text-[10px]">·</span>
                          <button
                            type="button"
                            onClick={() => updateGroup(group.id, { customAudienceIds: [] })}
                            className="text-[11px] font-medium text-muted-foreground hover:text-destructive hover:underline"
                          >
                            Clear all
                          </button>
                        </div>
                      )}

                      <div className="max-h-40 overflow-y-auto rounded-lg border border-border bg-card">
                        {filteredCA.length === 0 ? (
                          <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                            {caSearch ? "No audiences match your search." : "No custom audiences found."}
                          </p>
                        ) : (
                          filteredCA.map((ca) => (
                            <label
                              key={ca.id}
                              className="flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2 last:border-b-0 hover:bg-muted/50"
                            >
                              <Checkbox
                                checked={group.customAudienceIds.includes(ca.id)}
                                onChange={() => toggleCustomAudience(group.id, ca.id)}
                              />
                              <span className="flex-1 truncate text-sm">{ca.name}</span>
                              {ca.approximateSize !== undefined && (
                                <span className="shrink-0 text-[10px] text-muted-foreground">
                                  {ca.approximateSize >= 1000
                                    ? `${(ca.approximateSize / 1000).toFixed(0)}K`
                                    : ca.approximateSize}
                                </span>
                              )}
                              <Badge variant="outline" className="shrink-0 text-[10px]">
                                {ca.type}
                              </Badge>
                            </label>
                          ))
                        )}
                      </div>
                    </>
                  )}

                  {/* Selected chips — only from user-selected customAudienceIds */}
                  {group.customAudienceIds.length > 0 && (
                    <div>
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground">
                          Selected ({group.customAudienceIds.length})
                          {!customAudiences.loaded && (
                            <span className="ml-1 text-[10px] text-muted-foreground">(load audiences to see names)</span>
                          )}
                        </span>
                        <button
                          type="button"
                          onClick={() => updateGroup(group.id, { customAudienceIds: [] })}
                          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive"
                        >
                          <XCircle className="h-3 w-3" />
                          Clear
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {group.customAudienceIds.map((caId) => {
                          const ca = customAudiences.data.find((a) => a.id === caId);
                          // If audiences are loaded but this ID isn't found, it's a stale ID
                          const isStale = customAudiences.loaded && !ca;
                          return (
                            <Badge
                              key={caId}
                              variant={isStale ? "destructive" : "warning"}
                              onRemove={() => toggleCustomAudience(group.id, caId)}
                            >
                              {ca?.name ?? (isStale ? `⚠ stale: ${caId}` : caId)}
                            </Badge>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Engagement audiences note */}
                  {(group.engagementAudienceIds?.length ?? 0) > 0 && (
                    <p className="text-[11px] text-muted-foreground">
                      {group.engagementAudienceIds!.length} engagement audience{group.engagementAudienceIds!.length !== 1 ? "s" : ""} auto-created from previous launch (stored separately from your selection).
                    </p>
                  )}
                </div>
              </div>
            )}
          </Card>
        );
      })}

      {/* ═══════════════════════════════════════════════════════════════════
          Selected Pages Lookalike section
          Lets users pick any of their loaded Facebook pages and generate
          combined lookalike ad sets — entirely separate from page groups.
      ═══════════════════════════════════════════════════════════════════ */}
      <SelectedPagesLookalikeSection
        splalGroups={splalGroups}
        onChange={onSplalGroupsChange ?? (() => {})}
        userPages={userPages}
      />
    </div>
  );
}

// ─── Selected Pages Lookalike Section ────────────────────────────────────────

const RANGE_LABELS: Record<LookalikeRange, string> = {
  "0-1%": "1%",
  "1-2%": "2%",
  "2-3%": "3%",
};

function createEmptySplalGroup(): SelectedPagesLookalikeGroup {
  return {
    id: crypto.randomUUID(),
    name: "Selected Pages Lookalike",
    selectedPageIds: [],
    engagementTypes: ["fb_likes", "fb_engagement_365d", "ig_followers", "ig_engagement_365d"],
    lookalikeRanges: ["0-1%"],
  };
}

interface SplalSectionProps {
  splalGroups: SelectedPagesLookalikeGroup[];
  onChange: (groups: SelectedPagesLookalikeGroup[]) => void;
  userPages: ReturnType<typeof useFetchUserPages>;
}

function SelectedPagesLookalikeSection({ splalGroups, onChange, userPages }: SplalSectionProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [splalSearch, setSplalSearch] = useState<Record<string, string>>({});

  const addGroup = () => {
    const g = createEmptySplalGroup();
    onChange([...splalGroups, g]);
    setExpandedId(g.id);
  };

  const removeGroup = (id: string) => {
    onChange(splalGroups.filter((g) => g.id !== id));
    if (expandedId === id) setExpandedId(null);
  };

  const updateGroup = (id: string, patch: Partial<SelectedPagesLookalikeGroup>) => {
    onChange(splalGroups.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  };

  const togglePageInGroup = (groupId: string, pageId: string) => {
    const group = splalGroups.find((g) => g.id === groupId);
    if (!group) return;
    const next = group.selectedPageIds.includes(pageId)
      ? group.selectedPageIds.filter((id) => id !== pageId)
      : [...group.selectedPageIds, pageId];
    updateGroup(groupId, { selectedPageIds: next });
  };

  const toggleRange = (groupId: string, range: LookalikeRange) => {
    const group = splalGroups.find((g) => g.id === groupId);
    if (!group) return;
    const next = group.lookalikeRanges.includes(range)
      ? group.lookalikeRanges.filter((r) => r !== range)
      : [...group.lookalikeRanges, range];
    // Keep at least one range
    if (next.length > 0) updateGroup(groupId, { lookalikeRanges: next });
  };

  const toggleEngagement = (groupId: string, et: EngagementType) => {
    const group = splalGroups.find((g) => g.id === groupId);
    if (!group) return;
    const next = group.engagementTypes.includes(et)
      ? group.engagementTypes.filter((t) => t !== et)
      : [...group.engagementTypes, et];
    if (next.length > 0) updateGroup(groupId, { engagementTypes: next });
  };

  return (
    <div className="mt-4 space-y-3">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Selected Pages Lookalike</h3>
          <p className="text-xs text-muted-foreground">
            Create lookalike audiences from your loaded Facebook pages — combined into one ad set per percentage tier.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={addGroup}
          className="shrink-0"
        >
          <Plus className="mr-1 h-3 w-3" />
          Add group
        </Button>
      </div>

      {splalGroups.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          No lookalike groups yet. Click &ldquo;Add group&rdquo; to create one.
        </div>
      )}

      {splalGroups.map((group) => {
        const isExpanded = expandedId === group.id;
        const search = splalSearch[group.id] ?? "";

        // Filter userPages for this group's picker
        const availablePages = userPages.data.filter((p) =>
          !search ||
          p.name?.toLowerCase().includes(search.toLowerCase()) ||
          p.instagramUsername?.toLowerCase().includes(search.toLowerCase()),
        );

        // Preview counts
        const pageCount = group.selectedPageIds.length;
        const rangeCount = group.lookalikeRanges.length;
        const engCount = group.engagementTypes.length;
        const expectedSourceAudiences = pageCount * engCount;
        const expectedAdSets = rangeCount;

        return (
          <Card key={group.id} className="overflow-hidden">
            {/* Card header */}
            <div
              className="flex cursor-pointer items-center justify-between px-4 py-3"
              onClick={() => setExpandedId(isExpanded ? null : group.id)}
            >
              <div className="flex items-center gap-2 min-w-0">
                <button
                  type="button"
                  className="shrink-0 text-muted-foreground"
                  onClick={(e) => { e.stopPropagation(); setExpandedId(isExpanded ? null : group.id); }}
                >
                  {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
                <span className="truncate text-sm font-medium">
                  {group.name || "Selected Pages Lookalike"}
                </span>
                {pageCount > 0 && (
                  <Badge variant="primary" className="shrink-0">
                    {pageCount} page{pageCount !== 1 ? "s" : ""}
                  </Badge>
                )}
                {group.lookalikeRanges.map((r) => (
                  <Badge key={r} variant="outline" className="shrink-0 text-[10px]">
                    {RANGE_LABELS[r]}
                  </Badge>
                ))}
              </div>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); removeGroup(group.id); }}
                className="ml-2 shrink-0 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>

            {isExpanded && (
              <div className="border-t border-border px-4 py-4 space-y-4">
                {/* Group name */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    Group name
                  </label>
                  <Input
                    value={group.name}
                    onChange={(e) => updateGroup(group.id, { name: e.target.value })}
                    placeholder="Selected Pages Lookalike"
                    className="h-8 text-sm"
                  />
                </div>

                {/* Engagement types */}
                <div>
                  <label className="mb-2 block text-xs font-medium text-muted-foreground">
                    Source audience types
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {ENGAGEMENT_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => toggleEngagement(group.id, opt.value)}
                        className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                          group.engagementTypes.includes(opt.value)
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-background text-muted-foreground hover:border-primary/50"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Lookalike ranges */}
                <div>
                  <label className="mb-2 block text-xs font-medium text-muted-foreground">
                    Lookalike percentage tiers
                  </label>
                  <div className="flex gap-2">
                    {LOOKALIKE_RANGES.map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => toggleRange(group.id, r)}
                        className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                          group.lookalikeRanges.includes(r)
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-background text-muted-foreground hover:border-primary/50"
                        }`}
                      >
                        {RANGE_LABELS[r]}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    Each selected tier creates one ad set containing all valid lookalike audiences from the pages below.
                  </p>
                </div>

                {/* Page selection */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-medium text-muted-foreground">
                      Select pages for lookalike creation
                      {userPages.count > 0 && (
                        <span className="ml-1 text-muted-foreground/60">
                          (My Facebook Pages — {userPages.count} loaded)
                        </span>
                      )}
                    </label>
                    {group.selectedPageIds.length > 0 && (
                      <button
                        type="button"
                        onClick={() => updateGroup(group.id, { selectedPageIds: [] })}
                        className="text-[11px] text-muted-foreground hover:text-destructive"
                      >
                        Clear all
                      </button>
                    )}
                  </div>

                  {!userPages.loaded && userPages.count === 0 ? (
                    <p className="rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
                      Load your Facebook pages first using the &ldquo;My Facebook Pages&rdquo; section above.
                    </p>
                  ) : (
                    <>
                      <SearchInput
                        value={search}
                        onChange={(e) => setSplalSearch((prev) => ({ ...prev, [group.id]: e.target.value }))}
                        onClear={() => setSplalSearch((prev) => ({ ...prev, [group.id]: "" }))}
                        placeholder="Search pages…"
                      />
                      {search && (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Showing {availablePages.length} of {userPages.data.length}
                        </p>
                      )}
                      <div className="mt-2 max-h-52 overflow-y-auto rounded-lg border border-border bg-card">
                        {availablePages.length === 0 ? (
                          <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                            {search ? "No pages match your search." : "No pages loaded yet."}
                          </p>
                        ) : (
                          availablePages.map((p) => {
                            const selected = group.selectedPageIds.includes(p.id);
                            return (
                              <label
                                key={p.id}
                                className="flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2 last:border-b-0 hover:bg-muted/50"
                              >
                                <Checkbox
                                  checked={selected}
                                  onChange={() => togglePageInGroup(group.id, p.id)}
                                />
                                {p.pictureUrl ? (
                                  <img
                                    src={p.pictureUrl}
                                    alt={p.name}
                                    className="h-6 w-6 shrink-0 rounded-full object-cover"
                                  />
                                ) : (
                                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
                                    {(p.name ?? "?").charAt(0).toUpperCase()}
                                  </div>
                                )}
                                <div className="flex-1 min-w-0">
                                  <p className="truncate text-sm">{p.name}</p>
                                  {p.instagramUsername && (
                                    <p className="text-[10px] text-muted-foreground">@{p.instagramUsername}</p>
                                  )}
                                </div>
                                {p.facebookFollowers != null && (
                                  <span className="shrink-0 text-[10px] text-muted-foreground">
                                    {p.facebookFollowers >= 1000
                                      ? `${(p.facebookFollowers / 1000).toFixed(0)}K`
                                      : p.facebookFollowers}
                                  </span>
                                )}
                              </label>
                            );
                          })
                        )}
                      </div>
                    </>
                  )}
                </div>

                {/* Selected page chips */}
                {group.selectedPageIds.length > 0 && (
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Selected for lookalike ({group.selectedPageIds.length})
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {group.selectedPageIds.map((pid) => {
                        const page = userPages.data.find((p) => p.id === pid);
                        return (
                          <Badge
                            key={pid}
                            variant="primary"
                            onRemove={() => togglePageInGroup(group.id, pid)}
                          >
                            {page?.name ?? pid}
                          </Badge>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Preview */}
                {pageCount > 0 && (
                  <div className="rounded-lg bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground space-y-1">
                    <p className="font-medium text-foreground">Launch preview</p>
                    <p>
                      Up to <span className="font-medium text-foreground">{expectedSourceAudiences}</span> source audiences
                      ({pageCount} pages × {engCount} engagement type{engCount !== 1 ? "s" : ""})
                    </p>
                    <p>
                      <span className="font-medium text-foreground">{expectedAdSets}</span> lookalike ad set{expectedAdSets !== 1 ? "s" : ""}
                      {" "}({group.lookalikeRanges.map((r) => `"${group.name || "Selected Pages"} — ${RANGE_LABELS[r]} Lookalike"`).join(", ")})
                    </p>
                    <p className="text-[11px]">
                      Pages without linked Instagram will skip IG engagement types. Skipped pages do not block the rest.
                    </p>
                  </div>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
