"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CampaignLibraryPicker, type LibraryPick } from "@/components/library/campaign-library-picker";
import { CanvasAdjust } from "@/components/plan/canvas-adjust";
import { CanvasLearn } from "@/components/plan/canvas-learn";
import { CanvasAssets } from "@/components/plan/canvas-assets";
import { CanvasBudget } from "@/components/plan/canvas-budget";
import { CanvasChannels } from "@/components/plan/canvas-channels";
import { CanvasHeader } from "@/components/plan/canvas-header";
import { CanvasLaunch } from "@/components/plan/canvas-launch";
import { CanvasTarget } from "@/components/plan/canvas-target";
import { CanvasWindow } from "@/components/plan/canvas-window";
import { DecisionsSheet } from "@/components/plan/decisions-sheet";
import { GoogleDrawerMount } from "@/components/plan/google-drawer";
import type { GoogleSearchWizardContext } from "@/components/google-search-wizard/wizard-shell";
import { MetaDrawerMount } from "@/components/plan/meta-drawer";
import { TikTokDrawerMount } from "@/components/plan/tiktok-drawer";
import { PlanDeleteAction } from "@/components/plan/plan-delete-action";
import { Combobox } from "@/components/ui/combobox";
import { InfoTip } from "@/components/viz/info-tip";
import type { OverflowMenuItem } from "@/components/viz/overflow-menu";
import {
  PLAN_CANVAS_COPY,
  countDecisionsSince,
  defaultAnchorFor,
  planCanvasMenuItemSpecs,
  planCanvasState,
  planChannelRows,
  planLastOpenedKey,
  planLaunchButton,
  type PlanChannelRowModel,
} from "@/lib/plan/canvas";
import type { IdentityNameMap } from "@/lib/plan/identity-chips";
import { EMPTY_CHANNEL_FACTS } from "@/lib/plan/canvas-facts";
import {
  planDefaultWindow,
  planWindowFromHandles,
  planWindowHandles,
  planWindowMoments,
  planWindowValidity,
  type PlanWindowDates,
} from "@/lib/plan/canvas-inputs";
import {
  adjustPrimaryReadingUnit,
  domainFromUrl,
  plannedSpendByToday,
  type AdjustDecisionRow,
  type AdjustWindowReads,
} from "@/lib/plan/adjust-face";
import { planBenchmark, runFromViewRow, selectBenchmarkRows, type BenchmarkRow } from "@/lib/plan/benchmarks";
import { planDisposalAction } from "@/lib/plan/delete-policy";
import { drawerUrl, readDrawerUrl, tabForAnchor } from "@/lib/plan/drawer";
import { dismissBlockerBadges } from "@/lib/viz/blockers";
import { VIZ_UNIT_WORD, VIZ_ZONE_GUTTER } from "@/lib/viz/tokens";
import { resolvePlanDestination } from "@/lib/plan/destination";
import { planHeaderName } from "@/lib/plan/plan-name";
import { shouldPersistPlanOnChange } from "@/lib/plan/persist-policy";
import { wizardHrefForDraft } from "@/lib/plan/prepare-draft";
import type { BlockerAnchor, BlockerRowModel } from "@/lib/viz/blockers";
import { useCampaignDraft } from "@/lib/wizard/use-campaign-draft";
import {
  planEventPickerRows,
  todayIsoDate,
  visiblePlanEvents,
  type PlanEventOption,
} from "@/lib/plan/event-picker";
import { scheduledDayCount } from "@/lib/plan/budget-split";
import { objectiveForTargetUnit } from "@/lib/plan/target-unit";
import { PLAN_STEP2_HASH } from "@/lib/plan/schedule";
import {
  learnNextTime,
  planIsClosed,
  type CampaignPlanPrediction,
} from "@/lib/plan/learn-face";
import { planAdsManagerLinks } from "@/lib/plan/ads-manager-links";
import {
  identityAccountLabel,
  launchBlockedLine,
  launchChannelRunning,
  launchReadingUnit,
  planIdentityMetaId,
  planLaunchedAt,
  planLaunchStamp,
  readyLaunchAdapters,
} from "@/lib/plan/launch-face";
import { PlanShareAction } from "@/components/plan/plan-share-action";
import { planShareControls, type PlanRole } from "@/lib/plan/share-role";
import type { LaunchRollupDay } from "@/lib/plan/launch-face";
import type { ResolvedChannelDefaults } from "@/lib/clients/channel-defaults";
import type { EventFunnelView } from "@/lib/dashboard/event-funnel";
import { planPreflightBlockerCount, type PlanPreflightIssue } from "@/lib/plan/preflight";
import type { PlanTargetUnit } from "@/lib/types";
import { isCampaignPlanObjectiveIntent, type CampaignPlan, type PlanAdapterName } from "@/lib/plan/types";

export type { PlanEventOption };

interface GateState {
  enabled: boolean;
  skippedReason: string | null;
}

interface MirrorFacts {
  meta: { n: number; noun: string }[];
  tiktok: { n: number; noun: string }[];
  google: { n: number; noun: string }[];
}

/**
 * `/plan/[id]` — the canvas (§2). Seven zones top to bottom, one button.
 *
 * Everything that used to be a form control on this page is either a
 * zone, a badge, or gone: the name comes from the event, the objective
 * from the target unit, the destination from the event, and a platform
 * at £0 is simply off. The five step-views this replaces are listed in
 * §5 rows 5, 8, 10, 14, 17, 19, 23, 27, 28, 29.
 *
 * Drawers are PR 4/5. Until then a row click prepares the draft and
 * navigates to the wizard, while `row.anchor` already carries the drawer
 * coordinate PR 4 will use.
 */
export function PlanWorkspace({
  initialPlan,
  events,
  tiktokAdvertiserId,
  googleAdsAccounts = [],
  isNew = false,
  funnel = null,
  liveSpend = null,
  adjustReads = null,
  thumbUrl = null,
  targetBenchmark: _targetBenchmark = null,
  identityNames,
  rollupDays = [],
  predictions = [],
  benchmarkRows = [],
  role = "operator",
  initialResolved = null,
  initialDecisions = [],
  initialShareToken = null,
  initialShareEnabled,
}: {
  initialPlan: CampaignPlan;
  events: PlanEventOption[];
  tiktokAdvertiserId?: string | null;
  googleAdsAccounts?: GoogleSearchWizardContext["googleAdsAccounts"];
  isNew?: boolean;
  /** LIVE state only — resolved on the server from event_daily_rollups. */
  funnel?: EventFunnelView | null;
  liveSpend?: number | null;
  adjustReads?: AdjustWindowReads | null;
  thumbUrl?: string | null;
  role?: PlanRole;
  initialResolved?: ResolvedChannelDefaults | null;
  initialDecisions?: AdjustDecisionRow[];
  /**
   * The client preset's benchmark for this plan's objective. Zone D shows
   * it with the seed badge when the plan has no target of its own, so the
   * field is never empty (§2 zone D).
   */
  targetBenchmark?: number | null;
  /** Stored cache names for the identity chips — loaded on the page, never fetched here. */
  identityNames?: IdentityNameMap;
  rollupDays?: readonly LaunchRollupDay[];
  predictions?: readonly CampaignPlanPrediction[];
  benchmarkRows?: readonly BenchmarkRow[];
  initialShareToken?: string | null;
  initialShareEnabled?: boolean;
}) {
  void _targetBenchmark;
  const [plan, setPlan] = useState(initialPlan);
  const [hasUserEdit, setHasUserEdit] = useState(false);
  const [persisted, setPersisted] = useState(!isNew);
  const [staleChips, setStaleChips] = useState<Partial<Record<PlanAdapterName, string | null>>>({});
  const [facts, setFacts] = useState<MirrorFacts>(EMPTY_CHANNEL_FACTS);
  /** `validateStep` rows for the Meta row's badge — see the mirror route. */
  const [drawerBlockers, setDrawerBlockers] = useState<
    Partial<Record<PlanAdapterName, readonly BlockerRowModel[]>>
  >({});
  const [gate, setGate] = useState<GateState | null>(null);
  const [issues, setIssues] = useState<PlanPreflightIssue[]>([]);
  const [resolved, setResolved] = useState<ResolvedChannelDefaults | null>(initialResolved);
  const [preflightOk, setPreflightOk] = useState<boolean | null>(role === "client" ? true : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [budgetMode, setBudgetMode] = useState<"daily" | "lifetime">("daily");
  const [lifetimeTotal, setLifetimeTotal] = useState(0);
  const [decisionCount, setDecisionCount] = useState(0);
  const [adjustDecisions, setAdjustDecisions] = useState<AdjustDecisionRow[]>(initialDecisions);
  const share = planShareControls(role);
  const readOnly = role === "client";
  const [adjustGates, setAdjustGates] = useState({
    writesEnabled: false,
    enabled: false,
    live: false,
  });
  const [unregisteredAssets, setUnregisteredAssets] = useState(0);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  /**
   * The open drawer. A drawer is not a route, so this is component state;
   * the URL carries `?drawer=f&tab=…` only so a refresh can restore it.
   */
  const [drawer, setDrawer] = useState<{
    adapter: PlanAdapterName;
    draftId: string;
    anchor: BlockerAnchor | null;
    /** The tab actually open, which diverges from `anchor` once tabs are used. */
    tab: string | null;
  } | null>(null);
  const metaOpenRef = useRef<HTMLButtonElement | null>(null);
  const tiktokOpenRef = useRef<HTMLButtonElement | null>(null);
  const googleOpenRef = useRef<HTMLButtonElement | null>(null);
  const decisionsOpenRef = useRef<HTMLButtonElement | null>(null);
  const [decisionsOpen, setDecisionsOpen] = useState(false);

  /**
   * Restore an open drawer after a refresh, once. The plan's draft ids are
   * not in the URL — only which drawer and which tab — so the id comes
   * from the plan, which means a `?drawer=f` on a plan with no Meta draft
   * yet simply does nothing.
   */
  const restoredDrawer = useRef(false);
  useEffect(() => {
    if (restoredDrawer.current) return;
    restoredDrawer.current = true;
    const fromUrl = readDrawerUrl(searchParams);
    if (fromUrl.sheet === "decisions") {
      setDecisionsOpen(true);
      return;
    }
    if (!fromUrl.adapter) return;
    const draftId = plan.launches[fromUrl.adapter].draftId;
    if (!draftId) return;
    setDrawer({
      adapter: fromUrl.adapter,
      draftId,
      anchor: fromUrl.tab
        ? { drawer: fromUrl.adapter, section: fromUrl.tab }
        : defaultAnchorFor(fromUrl.adapter),
      tab: fromUrl.tab,
    });
  }, [searchParams, plan.launches]);

  /** Shallow replace — the route stays `/plan/[id]`; only the query moves. */
  useEffect(() => {
    const next = drawerUrl(
      pathname,
      decisionsOpen
        ? { adapter: null, tab: null, sheet: "decisions" }
        : drawer
          ? {
              adapter: drawer.adapter,
              tab: drawer.tab ?? tabForAnchor(drawer.adapter, drawer.anchor),
            }
          : { adapter: null, tab: null },
      searchParams,
    );
    const current = `${pathname}${searchParams.toString() ? `?${searchParams}` : ""}`;
    if (next !== current) router.replace(next, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- searchParams is the comparison basis, not a trigger
  }, [drawer, decisionsOpen, pathname, router]);

  const hasMetaDraft = plan.launches.meta.draftId != null;
  const selectedEvent = events.find((event) => event.id === plan.intent.eventId) ?? null;
  const googleWizardContext = useMemo<GoogleSearchWizardContext>(
    () => ({
      eventName: selectedEvent?.name ?? null,
      eventCode: selectedEvent?.eventCode ?? null,
      clientName: selectedEvent?.clientName ?? null,
      googleAdsAccounts,
      events: events.map((event) => ({
        id: event.id,
        name: event.name,
        event_code: event.eventCode ?? null,
        client_id: event.clientId ?? null,
      })),
    }),
    [events, googleAdsAccounts, selectedEvent],
  );

  function markPlan(updater: (current: CampaignPlan) => CampaignPlan) {
    setHasUserEdit(true);
    setPlan(updater);
  }

  /**
   * Every channel opens in a drawer over the canvas — no route change.
   * The URL only gains `?drawer=f|tt|g&tab=…` so a refresh reopens it.
   */
  function openDrawerOrWizard(
    adapter: PlanAdapterName,
    draftId: string,
    anchor?: BlockerAnchor | null,
  ) {
    dismissBlockerBadges();
    setDecisionsOpen(false);
    setDrawer({
      adapter,
      draftId,
      anchor: anchor ?? defaultAnchorFor(adapter),
      tab: null,
    });
  }

  function patchIntent(patch: Partial<CampaignPlan["intent"]>) {
    markPlan((current) => ({
      ...current,
      intent: { ...current.intent, ...patch },
      updatedAt: new Date().toISOString(),
    }));
  }

  useEffect(() => {
    if (readOnly) return;
    let cancelled = false;
    fetch("/api/plan/launch")
      .then((res) => res.json())
      .then((json: GateState & { error?: string }) => {
        if (cancelled) return;
        setGate({
          enabled: json.enabled === true,
          skippedReason: json.skippedReason ?? (json.enabled ? null : "killswitch"),
        });
      })
      .catch(() => {
        if (!cancelled) setGate({ enabled: false, skippedReason: "killswitch" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Staleness chip + zone E facts share one round trip. */
  const refreshMirror = useCallback(async () => {
    if (readOnly || !persisted) return;
    const res = await fetch(`/api/plan/${encodeURIComponent(plan.id)}/mirror`);
    const json = (await res.json()) as {
      ok?: boolean;
      tiktok?: { chip?: string | null };
      google?: { chip?: string | null };
      facts?: MirrorFacts;
      drawerBlockers?: Partial<Record<PlanAdapterName, readonly BlockerRowModel[]>>;
    };
    if (!res.ok || !json.ok) return;
    setStaleChips({
      tiktok: json.tiktok?.chip ?? null,
      google: json.google?.chip ?? null,
    });
    if (json.facts) setFacts(json.facts);
    if (json.drawerBlockers) setDrawerBlockers(json.drawerBlockers);
  }, [persisted, plan.id, readOnly]);

  useEffect(() => {
    void refreshMirror();
  }, [refreshMirror, hasMetaDraft]);

  useEffect(() => {
    function onFocus() {
      void refreshMirror();
    }
    function onVisibility() {
      if (document.visibilityState === "visible") void refreshMirror();
    }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refreshMirror]);

  /**
   * `◐ n ▸` — decisions since this operator last opened the plan.
   * "Last opened" is one browser's fact, so it lives in localStorage.
   */
  const metaDraftId = plan.launches.meta.draftId;
  useEffect(() => {
    if (readOnly || !metaDraftId) return;
    let cancelled = false;
    const lastOpened =
      typeof window === "undefined"
        ? null
        : window.localStorage.getItem(planLastOpenedKey(plan.id));
    fetch(`/api/campaigns/${encodeURIComponent(metaDraftId)}/automation`)
      .then((res) => res.json())
      .then(
        (json: {
          ok?: boolean;
          decisions?: Array<{
            decidedAt?: string | null;
            action?: string;
            reasonText?: string;
            resultCount?: number | null;
            applied?: boolean;
            dryRun?: boolean;
            adsetId?: string | null;
            adsetName?: string | null;
            scope?: string | null;
            budgetBeforePence?: number | null;
            budgetAfterPence?: number | null;
            metricValue?: number | null;
            metricWindow?: string | null;
          }>;
          enabled?: boolean;
          live?: boolean;
          writesEnabled?: boolean;
        }) => {
        if (cancelled || !json.ok) return;
        setDecisionCount(countDecisionsSince(json.decisions ?? [], lastOpened));
        setAdjustDecisions(
          (json.decisions ?? [])
            .filter((row): row is typeof row & { decidedAt: string } => typeof row.decidedAt === "string")
            .map((row) => ({
              decidedAt: row.decidedAt,
              action: row.action ?? "",
              reasonText: row.reasonText ?? "",
              resultCount: row.resultCount ?? null,
              applied: row.applied === true,
              dryRun: row.dryRun !== false,
              adsetId: row.adsetId ?? null,
              adsetName: row.adsetName ?? null,
              campaignName: row.adsetName ?? null,
              scope: row.scope ?? null,
              budgetBeforePence: row.budgetBeforePence ?? null,
              budgetAfterPence: row.budgetAfterPence ?? null,
              metricValue: row.metricValue ?? null,
              metricWindow: row.metricWindow ?? null,
            })),
        );
        setAdjustGates({
          writesEnabled: json.writesEnabled === true,
          enabled: json.enabled === true,
          live: json.live === true,
        });
      },
      )
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [metaDraftId, plan.id, readOnly]);

  useEffect(() => {
    if (readOnly) return;
    if (!shouldPersistPlanOnChange({ hasUserEdit, eventId: plan.intent.eventId })) return;
    const handle = window.setTimeout(() => {
      void fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      })
        .then((res) => res.json())
        .then((json: { ok?: boolean; error?: string }) => {
          if (json.ok) {
            setPersisted(true);
            if (window.location.pathname === "/plan/new") {
              router.replace(`/plan/${plan.id}`);
            }
            return;
          }
          setError(json.error ?? null);
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : null);
        });
    }, 400);
    return () => window.clearTimeout(handle);
  }, [plan, router, hasUserEdit, readOnly]);

  useEffect(() => {
    if (readOnly) return;
    setPreflightOk(null);
    const handle = window.setTimeout(() => {
      void fetch("/api/plan/preflight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      })
        .then((res) => res.json())
        .then(
          (json: {
            ok?: boolean;
            issues?: PlanPreflightIssue[];
            resolved?: ResolvedChannelDefaults;
          }) => {
            setIssues(json.issues ?? []);
            setResolved(json.resolved ?? null);
            setPreflightOk(json.ok === true);
          },
        )
        .catch(() => {
          setIssues([]);
          setPreflightOk(false);
        });
    }, 250);
    return () => window.clearTimeout(handle);
  }, [plan, readOnly]);

  const destination = useMemo(
    () =>
      resolvePlanDestination(
        selectedEvent,
        plan.intent.target.unit,
        plan.intent.destinationUrl,
      ),
    [plan.intent.destinationUrl, plan.intent.target.unit, selectedEvent],
  );

  /** Whatever the event resolves to is the URL the adapters must send. */
  useEffect(() => {
    if (readOnly) return;
    if (destination.source === "manual" || destination.source === "none") return;
    if (plan.intent.destinationUrl === destination.url) return;
    setPlan((current) => ({
      ...current,
      intent: { ...current.intent, destinationUrl: destination.url },
    }));
  }, [destination.source, destination.url, plan.intent.destinationUrl, readOnly]);

  const rows = useMemo(
    () =>
      planChannelRows({
        plan,
        issues,
        facts,
        drawerBlockers,
        hrefs: {
          meta: plan.launches.meta.draftId
            ? wizardHrefForDraft("meta", plan.launches.meta.draftId)
            : null,
          tiktok: null,
          google: null,
        },
        adsManagerLinks: planAdsManagerLinks(plan, {
          metaAdAccountId:
            plan.launches.meta.platformAdAccountId ??
            resolved?.metaAdAccount.value ??
            selectedEvent?.eventMetaAdAccountId ??
            selectedEvent?.metaAdAccountId,
          googleCustomerId:
            plan.launches.google.platformAdAccountId ??
            selectedEvent?.googleCustomerId,
          tiktokAdvertiserId:
            plan.launches.tiktok.platformAdAccountId ?? tiktokAdvertiserId,
        }),
        staleChips,
        delivering: (liveSpend ?? 0) > 0,
      }),
    [
      drawerBlockers,
      facts,
      issues,
      liveSpend,
      plan,
      resolved,
      selectedEvent,
      staleChips,
      tiktokAdvertiserId,
    ],
  );

  const state = useMemo(
    () => planCanvasState({ plan, rows, liveSpend }),
    [liveSpend, plan, rows],
  );

  const windowOk = useMemo(
    () =>
      planWindowValidity(
        {
          startDate: plan.intent.startDate,
          startTime: plan.intent.startTime,
          endDate: plan.intent.endDate,
          endTime: plan.intent.endTime,
        },
        selectedEvent,
        { createdAt: plan.createdAt },
      ).ok,
    [
      plan.createdAt,
      plan.intent.endDate,
      plan.intent.endTime,
      plan.intent.startDate,
      plan.intent.startTime,
      selectedEvent,
    ],
  );

  const launchButton = useMemo(
    () =>
      planLaunchButton({
        state,
        rows,
        gateEnabled: gate?.enabled === true,
        gateReason: gate
          ? gate.enabled
            ? null
            : PLAN_CANVAS_COPY.fanoutOff
          : PLAN_CANVAS_COPY.fanoutOff,
        hasEvent: Boolean(plan.intent.eventId),
        hasDestination: destination.url.trim().length > 0,
        windowOk,
        preflightOk,
        busy,
      }),
    [busy, destination.url, gate, plan.intent.eventId, preflightOk, rows, state, windowOk],
  );

  const isAdjustFace = state === "live" || state === "launched";

  async function persistNow(): Promise<boolean> {
    const res = await fetch("/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan }),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || !json.ok) {
      setError(json.error ?? null);
      return false;
    }
    setHasUserEdit(true);
    setPersisted(true);
    if (window.location.pathname === "/plan/new") router.replace(`/plan/${plan.id}`);
    return true;
  }

  /** Row click = open. The draft is created on first open, not by a button. */
  async function openChannel(
    row: PlanChannelRowModel,
    source?: LibraryPick,
    anchor?: BlockerAnchor | null,
  ) {
    if (!share.drawerEdit) return;
    // An existing draft opens straight away; only a first open prepares one.
    if (row.draftId && !source) {
      openDrawerOrWizard(row.adapter, row.draftId, anchor ?? row.anchor);
      return;
    }
    if (row.href && !source) {
      router.push(row.href);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (!(await persistNow())) return;
      const res = await fetch(`/api/plan/${encodeURIComponent(plan.id)}/prepare-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adapter: row.adapter,
          clientId: selectedEvent?.clientId ?? null,
          source: source ?? { kind: "plan" },
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        launches?: CampaignPlan["launches"];
      };
      if (!res.ok || !json.ok || !json.launches) {
        setError(json.error ?? null);
        return;
      }
      const launches = json.launches;
      setPlan((current) => ({ ...current, launches }));
      setLibraryOpen(false);
      const draftId = launches[row.adapter].draftId;
      if (draftId) openDrawerOrWizard(row.adapter, draftId, anchor ?? row.anchor);
    } catch (err) {
      setError(err instanceof Error ? err.message : null);
    } finally {
      setBusy(false);
    }
  }

  async function rederive(adapter: PlanAdapterName) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/plan/${encodeURIComponent(plan.id)}/derive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adapter }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setError(json.error ?? null);
        return;
      }
      setStaleChips((current) => ({ ...current, [adapter]: null }));
      void refreshMirror();
    } catch (err) {
      setError(err instanceof Error ? err.message : null);
    } finally {
      setBusy(false);
    }
  }

  async function launchAll() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/plan/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        skippedReason?: string | null;
        plan?: CampaignPlan | null;
      };
      if (json.skippedReason) {
        setError(json.skippedReason);
        return;
      }
      if (!res.ok || !json.plan) {
        setError(json.error ?? null);
        return;
      }
      setPlan(json.plan);
    } catch (err) {
      setError(err instanceof Error ? err.message : null);
    } finally {
      setBusy(false);
    }
  }

  async function resume(adapters: PlanAdapterName[]) {
    setBusy(true);
    setError(null);
    try {
      for (const adapter of adapters) {
        const res = await fetch(`/api/plan/${encodeURIComponent(plan.id)}/resume`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ adapter }),
        });
        const json = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok || !json.ok) {
          setError(json.error ?? null);
          return;
        }
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : null);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Changing the unit changes the objective (§2 zone D). Writing both in
   * one patch is what makes preflight re-run and the preset re-resolve —
   * `prepare-draft` reads the unit first and the intent second (#877).
   */
  function setTargetUnit(unit: PlanTargetUnit | null) {
    const objective = unit ? objectiveForTargetUnit(unit) : null;
    patchIntent({
      target: { value: plan.intent.target.value, unit },
      objectiveIntent:
        objective && isCampaignPlanObjectiveIntent(objective)
          ? objective
          : plan.intent.objectiveIntent,
    });
  }

  function setWindow(next: PlanWindowDates) {
    patchIntent(next);
  }

  const adjustClock = useMemo(() => new Date(), []);
  const adjustWindowDates: PlanWindowDates = {
    startDate: plan.intent.startDate,
    startTime: plan.intent.startTime,
    endDate: plan.intent.endDate,
    endTime: plan.intent.endTime,
  };
  const adjustValidity = planWindowValidity(adjustWindowDates, selectedEvent, {
    now: adjustClock,
    createdAt: plan.createdAt,
  });
  const adjustHandles = planWindowHandles(
    adjustValidity.ok ? adjustWindowDates : planDefaultWindow(selectedEvent, adjustClock),
    selectedEvent,
    adjustClock,
  );
  const dailyBudget =
    plan.intent.budget.metaDaily + plan.intent.budget.tiktokDaily + plan.intent.budget.googleDaily;
  const launchedAt = planLaunchedAt(plan.launches);
  const sinceLaunch = launchedAt ? new Date(launchedAt) : adjustHandles.start;
  const readingUnit = launchReadingUnit({
    now: adjustClock,
    generalSaleAt: selectedEvent?.generalSaleAt,
    presaleAt: selectedEvent?.presaleAt,
    kind: selectedEvent?.kind,
  });
  const adjustReadingUnit = adjustPrimaryReadingUnit({
    now: adjustClock,
    generalSaleAt: selectedEvent?.generalSaleAt,
    presaleAt: selectedEvent?.presaleAt,
    launchedAt,
    kind: selectedEvent?.kind,
  });
  const adjustBenchmark =
    selectedEvent?.clientId && selectedEvent.venueKey
      ? planBenchmark({
          rows: benchmarkRows,
          clientId: selectedEvent.clientId,
          venueKey: selectedEvent.venueKey,
          venueLabel: selectedEvent.venueName ?? selectedEvent.venueKey,
          unit: adjustReadingUnit === "reg" ? "signup" : adjustReadingUnit,
          excludeEventId: selectedEvent.id,
        })
      : undefined;
  const ticketStage = funnel?.stages.find((stage) => stage.key === "purchases");
  const ticketSourceRaw = ticketStage?.provenanceDetail.match(
    /Winning snapshot source is (\w+)/,
  )?.[1];
  const ticketSource =
    ticketSourceRaw === "manual" ||
    ticketSourceRaw === "xlsx_import" ||
    ticketSourceRaw === "eventbrite" ||
    ticketSourceRaw === "fourthefans"
      ? ticketSourceRaw
      : (adjustReads?.tickets ?? ticketStage?.value)
        ? "unknown"
        : "none";
  const lpvStage = funnel?.stages.find((stage) => stage.key === "lpv");

  const today = todayIsoDate();
  /**
   * The past-events checkbox is gone with the rest of the form furniture:
   * `Combobox` is a typeahead and `sortPlanEvents` already ranks past
   * events last, so including them costs nothing to read.
   */
  const pickerOptions = useMemo(
    () =>
      planEventPickerRows(
        visiblePlanEvents(events, {
          today,
          showPast: true,
          selectedId: plan.intent.eventId,
        }),
      ).map((row) => ({
        value: row.id,
        label: row.label,
        sublabel: row.sublabel || undefined,
        keywords: row.keywords || undefined,
      })),
    [events, plan.intent.eventId, today],
  );

  const menuItems: OverflowMenuItem[] = readOnly
    ? []
    : planCanvasMenuItemSpecs({
    status: plan.status,
    disposal: planDisposalAction(plan.launches),
    hasMetaDraft,
    unregisteredAssets,
  }).map((spec) => ({
    id: spec.id,
    icon: <span aria-hidden="true">·</span>,
    label: spec.label,
    hidden: spec.hidden,
    destructive: spec.destructive,
    onSelect: () => {
      if (spec.id === "from-existing") setLibraryOpen(true);
      if (spec.id === "register-assets") void registerAssets();
      if (spec.id === "duplicate") void duplicate();
      if (spec.id === "template") void saveAsTemplate();
      if (spec.id === "unarchive") void unarchive();
      if (spec.id === "delete") setDeleteOpen(true);
    },
  }));

  async function registerAssets() {
    await fetch(`/api/plan/${encodeURIComponent(plan.id)}/asset-backfill`, { method: "POST" });
    setUnregisteredAssets(0);
    void refreshMirror();
  }

  async function duplicate() {
    const res = await fetch(`/api/plan/${encodeURIComponent(plan.id)}/duplicate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId: plan.intent.eventId }),
    });
    const json = (await res.json()) as { ok?: boolean; plan?: { id: string } };
    if (res.ok && json.ok && json.plan) router.push(`/plan/${json.plan.id}`);
  }

  async function saveAsTemplate() {
    await fetch("/api/plan/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: plan.id, name: headerName, description: "", tags: [] }),
    });
  }

  async function unarchive() {
    await fetch(`/api/plan/${encodeURIComponent(plan.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "draft" }),
    });
    router.refresh();
  }

  const headerName = planHeaderName(plan.name, selectedEvent);
  const days = scheduledDayCount(plan.intent.startDate, plan.intent.endDate);
  const launchStamp = planLaunchStamp(plan.launches);
  const usual = selectedEvent?.clientId && selectedEvent.venueKey
    ? planBenchmark({
        rows: benchmarkRows,
        clientId: selectedEvent.clientId,
        venueKey: selectedEvent.venueKey,
        venueLabel: selectedEvent.venueName ?? selectedEvent.venueKey,
        unit: readingUnit === "reg" ? "signup" : readingUnit,
        excludeEventId: selectedEvent.id,
      })?.value ?? null
    : null;
  const isLearnFace = planIsClosed({
    status: plan.status,
    eventDate: selectedEvent?.eventDate,
  });
  const learnEventName = selectedEvent?.name ?? headerName;
  const learnPrediction =
    predictions.find((row) => row.metric === "cost_per_unit") ?? null;
  const learnActual = learnPrediction?.actual ?? null;
  const learnUnit =
    plan.intent.target.unit === "reg" || !plan.intent.target.unit
      ? "signup"
      : plan.intent.target.unit === "click" ||
          plan.intent.target.unit === "lpv" ||
          plan.intent.target.unit === "purchase" ||
          plan.intent.target.unit === "view"
        ? plan.intent.target.unit
        : "signup";
  const learnNext =
    selectedEvent?.clientId && selectedEvent.venueKey && learnActual != null
      ? learnNextTime({
          priorRuns: selectBenchmarkRows(benchmarkRows, {
            clientId: selectedEvent.clientId,
            venueKey: selectedEvent.venueKey,
            unit: learnUnit === "signup" ? "signup" : learnUnit,
          }).map(runFromViewRow),
          closed: {
            eventId: selectedEvent.id,
            eventCode: selectedEvent.eventCode ?? selectedEvent.id,
            eventDate: selectedEvent.eventDate ?? null,
            cost: learnActual,
          },
          excludeEventId: selectedEvent.id,
          venueLabel: selectedEvent.venueName ?? selectedEvent.venueKey,
        })
      : undefined;
  const metaAccountId = planIdentityMetaId({
    launchedMeta: plan.launches.meta,
    draftAdAccountId: plan.launches.meta.draftAdAccountId,
    resolvedMetaId:
      resolved?.metaAdAccount.value ??
      selectedEvent?.eventMetaAdAccountId ??
      selectedEvent?.metaAdAccountId ??
      null,
  });
  const learnMetaName = metaAccountId
    ? identityAccountLabel(metaAccountId, identityNames) || metaAccountId
    : null;

  return (
    <div>
      <CanvasHeader
        name={headerName}
        planTitle={plan.name}
        clientName={selectedEvent?.clientName ?? null}
        venueName={selectedEvent?.venueName ?? null}
        eventDate={selectedEvent?.eventDate ?? null}
        eventCode={selectedEvent?.eventCode ?? null}
        launchedMeta={plan.launches.meta}
        clientDefaultMetaId={selectedEvent?.metaAdAccountId ?? null}
        launchedAt={launchStamp?.at ?? null}
        launchedWord={launchStamp?.word}
        launchedAtSource={launchStamp?.source}
        thumbUrl={thumbUrl}
        destination={
          readOnly ? { ...destination, overridable: false } : destination
        }
        onDestination={(url) => {
          if (readOnly) return;
          patchIntent({ destinationUrl: url });
        }}
        decisionCount={readOnly ? 0 : decisionCount}
        decisionsRef={decisionsOpenRef}
        onDecisionsOpen={() => {
          window.localStorage.setItem(planLastOpenedKey(plan.id), new Date().toISOString());
          setDecisionCount(0);
          setDrawer(null);
          setDecisionsOpen(true);
        }}
        menuItems={menuItems}
        resolved={resolved}
        identityNames={identityNames}
        shareAction={
          role === "operator" && persisted ? (
            <PlanShareAction
              planId={plan.id}
              initialToken={initialShareToken}
              initialEnabled={initialShareEnabled}
            />
          ) : null
        }
      />

      {!plan.intent.eventId && share.switcher ? (
        <div className={`max-w-md ${VIZ_ZONE_GUTTER.normal}`}>
          <Combobox
            label="Event"
            value={plan.intent.eventId}
            onChange={(eventId) => patchIntent({ eventId, ...planDefaultWindow(events.find((e) => e.id === eventId) ?? null) })}
            options={pickerOptions}
            placeholder="Select an event"
            emptyText="No matching events"
          />
        </div>
      ) : null}

      {isLearnFace ? (
        <CanvasLearn
          role={role}
          eventName={learnEventName}
          venueLabel={selectedEvent?.venueName ?? null}
          unitWord={
            plan.intent.target.unit === "reg" ||
            plan.intent.target.unit === "click" ||
            plan.intent.target.unit === "lpv" ||
            plan.intent.target.unit === "purchase" ||
            plan.intent.target.unit === "view"
              ? VIZ_UNIT_WORD[plan.intent.target.unit]
              : "signup"
          }
          prediction={learnPrediction}
          actual={learnActual}
          nextTime={learnNext?.value ?? null}
          nextN={learnNext?.n ?? 0}
          nextBand={learnNext?.band ?? null}
          paceDaily={plan.intent.budget.totalDaily}
          pacePlanSaid={
            days
              ? plan.intent.budget.totalDaily * days
              : plan.intent.budget.totalDaily
          }
          paceSpent={liveSpend}
          archivedAt={plan.status === "archived" ? plan.updatedAt : null}
          identity={{
            metaName: learnMetaName,
            tiktokRan: plan.launches.tiktok.platformCampaignId != null,
            googleRan: plan.launches.google.platformCampaignId != null,
          }}
        />
      ) : isAdjustFace ? (
        <CanvasAdjust
          role={role}
          spent={adjustReads?.spend ?? liveSpend ?? 0}
          planned={plannedSpendByToday(dailyBudget, sinceLaunch, adjustClock)}
          kind={selectedEvent?.kind}
          benchmark={adjustBenchmark}
          writeGates={adjustGates}
          channels={(adjustReads?.channels ?? []).map((channel) => ({
            ...channel,
            connected:
              channel.name === "TikTok"
                ? Boolean(resolved?.tiktokAdvertiser.value)
                : channel.name === "Google"
                  ? Boolean(resolved?.googleAdsCustomer.value)
                  : true,
          }))}
          metaSignups={adjustReads ? adjustReads.metaRegs : null}
          metaPurchases={adjustReads ? adjustReads.metaPurchases : null}
          tagDomain={domainFromUrl(destination.url)}
          tickets={ticketSource === "none" ? null : (adjustReads?.tickets ?? ticketStage?.value ?? null)}
          ticketSource={ticketSource}
          decisions={adjustDecisions}
          moments={planWindowMoments(selectedEvent, adjustClock)}
          start={sinceLaunch}
          end={adjustHandles.end}
          endSet={adjustValidity.ok}
          launchedAt={launchedAt}
          venueName={selectedEvent?.venueName ?? null}
          generalSaleAt={selectedEvent?.generalSaleAt ?? null}
          presaleAt={selectedEvent?.presaleAt ?? null}
          lastCreativeSnapshotAt={adjustReads?.lastCreativeSnapshotAt ?? null}
          trend={adjustReads?.dailyCostPerSignup ?? null}
          reach={adjustReads?.reach ?? null}
          clicks={adjustReads?.clicks ?? null}
          pageViews={adjustReads?.firstPartyLpv ?? lpvStage?.value ?? null}
          now={adjustClock}
          onWindowChange={(next) => setWindow(planWindowFromHandles(next))}
        />
      ) : null}

      {isLearnFace || isAdjustFace ? null : (
      <div className={VIZ_ZONE_GUTTER.normal}>
        <CanvasWindow
          event={selectedEvent}
          dates={{
            startDate: plan.intent.startDate,
            startTime: plan.intent.startTime,
            endDate: plan.intent.endDate,
            endTime: plan.intent.endTime,
          }}
          createdAt={plan.createdAt}
          onChange={setWindow}
          readOnly={readOnly}
          googleBudgeted={plan.intent.budget.googleDaily > 0}
        />
      </div>
      )}

      {isLearnFace || isAdjustFace ? null : (
      <div className={VIZ_ZONE_GUTTER.tight}>
        <CanvasBudget
          budget={plan.intent.budget}
          mode={budgetMode}
          lifetime={lifetimeTotal}
          startDate={plan.intent.startDate}
          endDate={plan.intent.endDate}
          hasUserEdit={hasUserEdit}
          clientName={selectedEvent?.clientName ?? null}
          onBudget={(budget) => patchIntent({ budget })}
          onMode={(mode) => {
            setBudgetMode(mode);
            if (mode === "lifetime" && days) {
              setLifetimeTotal(
                Math.round(
                  (plan.intent.budget.metaDaily +
                    plan.intent.budget.tiktokDaily +
                    plan.intent.budget.googleDaily) *
                    days,
                ),
              );
            }
          }}
          onLifetime={setLifetimeTotal}
          readOnly={readOnly}
        />
      </div>
      )}

      {isLearnFace || isAdjustFace ? null : (
      <div className={VIZ_ZONE_GUTTER.tight}>
        <CanvasTarget
          value={plan.intent.target.value}
          unit={plan.intent.target.unit}
          objectiveIntent={plan.intent.objectiveIntent}
          presetHref={selectedEvent?.clientId ? `/clients/${selectedEvent.clientId}?tab=optimisation` : null}
          onTarget={(value) => patchIntent({ target: { value, unit: plan.intent.target.unit } })}
          onUnit={setTargetUnit}
          onObjective={(objectiveIntent) => patchIntent({ objectiveIntent })}
          generalSaleAt={selectedEvent?.generalSaleAt}
          presaleAt={selectedEvent?.presaleAt}
          kind={selectedEvent?.kind}
          venueName={selectedEvent?.venueName}
          venueKey={selectedEvent?.venueKey}
          clientId={selectedEvent?.clientId}
          excludeEventId={selectedEvent?.id}
          launched={launchStamp != null}
          benchmarkRows={benchmarkRows}
          unitPicker={share.unitPicker}
        />
      </div>
      )}

      {/* The wizard's PlanLinkBanner still lands here. */}
      <div id={PLAN_STEP2_HASH} />
      <div className={VIZ_ZONE_GUTTER.loose}>
      <CanvasChannels
        rows={rows}
        sharedBlockerCount={planPreflightBlockerCount(issues)}
        readingUnit={readingUnit}
        running={
          launchStamp
            ? launchChannelRunning(rollupDays, readingUnit, usual)
            : undefined
        }
        onOpen={(row) => void openChannel(row)}
        onOpenAnchor={(row, anchor) => void openChannel(row, undefined, anchor)}
        drawerEdit={share.drawerEdit}
        openRefs={{
          meta: metaOpenRef,
          tiktok: tiktokOpenRef,
          google: googleOpenRef,
        }}
        onResume={(row) => void resume([row.adapter])}
        onRederive={(row) => void rederive(row.adapter)}
        busy={busy}
      />
      </div>

      <div className={VIZ_ZONE_GUTTER.normal}>
      <CanvasAssets
        planId={plan.id}
        hasMetaDraft={hasMetaDraft}
        onUpload={() => {
          if (metaDraftId) openDrawerOrWizard("meta", metaDraftId);
        }}
        onUnregistered={setUnregisteredAssets}
        readOnly={readOnly}
      />
      </div>

      {share.drawerEdit && drawer?.adapter === "meta" ? (
        <MetaDrawerMount
          open
          draftId={drawer.draftId}
          initialAnchor={drawer.anchor}
          triggerRef={metaOpenRef}
          onTabChange={(tab) =>
            setDrawer((current) => (current ? { ...current, tab } : current))
          }
          planId={plan.id}
          destinationUrl={destination.url}
          channelDefaults={resolved}
          onClose={() => {
            dismissBlockerBadges();
            setDrawer(null);
          }}
        />
      ) : null}

      {share.drawerEdit && drawer?.adapter === "tiktok" ? (
        <TikTokDrawerMount
          open
          draftId={drawer.draftId}
          initialAnchor={drawer.anchor}
          triggerRef={tiktokOpenRef}
          onTabChange={(tab) =>
            setDrawer((current) => (current ? { ...current, tab } : current))
          }
          planId={plan.id}
          destinationUrl={destination.url}
          channelDefaults={resolved}
          onClose={() => {
            dismissBlockerBadges();
            setDrawer(null);
          }}
        />
      ) : null}

      {share.drawerEdit && drawer?.adapter === "google" ? (
        <GoogleDrawerMount
          open
          draftId={drawer.draftId}
          initialAnchor={drawer.anchor}
          triggerRef={googleOpenRef}
          onTabChange={(tab) =>
            setDrawer((current) => (current ? { ...current, tab } : current))
          }
          planId={plan.id}
          wizardContext={googleWizardContext}
          destinationUrl={destination.url}
          channelDefaults={resolved}
          onClose={() => {
            dismissBlockerBadges();
            setDrawer(null);
          }}
        />
      ) : null}

      {share.drawerEdit && metaDraftId ? (
        <DecisionsSheet
          draftId={metaDraftId}
          clientId={selectedEvent?.clientId ?? null}
          objective={plan.intent.objectiveIntent}
          variant="sheet"
          open={decisionsOpen}
          triggerRef={decisionsOpenRef}
          onDone={() => setDecisionsOpen(false)}
        />
      ) : null}

      <div className={VIZ_ZONE_GUTTER.loose}>
      <CanvasLaunch
        role={role}
        button={launchButton}
        stages={undefined}
        error={error}
        onLaunch={() => void launchAll()}
        onResumeAll={() =>
          void resume(rows.filter((row) => !row.skipped && row.status === "paused").map((row) => row.adapter))
        }
        readyAdapters={readyLaunchAdapters(rows)}
        preflightSettled={preflightOk !== null}
        blockerSentence={launchBlockedLine({
          hasEvent: Boolean(plan.intent.eventId),
          busy,
          windowOk,
          issues,
          blockerCount: planPreflightBlockerCount(issues),
        })}
      />
      </div>

      {readOnly ? null : (
        <>
          <CampaignLibraryPicker
            open={libraryOpen}
            onClose={() => setLibraryOpen(false)}
            busy={busy}
            onPick={(pick) => {
              const meta = rows.find((row) => row.adapter === "meta");
              if (meta) void openChannel(meta, pick);
            }}
          />
          <PlanDeleteAction
            planId={plan.id}
            launches={plan.launches}
            persisted={persisted}
            trigger="none"
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            onDeleted={() => router.push("/plans")}
          />
        </>
      )}

      {events.length === 0 ? <InfoTip label="No events yet." /> : null}
    </div>
  );
}
