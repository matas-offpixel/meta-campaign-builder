"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CampaignLibraryPicker, type LibraryPick } from "@/components/library/campaign-library-picker";
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
import { EMPTY_CHANNEL_FACTS } from "@/lib/plan/canvas-facts";
import { planDefaultWindow, type PlanWindowDates } from "@/lib/plan/canvas-inputs";
import { planDisposalAction } from "@/lib/plan/delete-policy";
import { drawerUrl, readDrawerUrl, tabForAnchor } from "@/lib/plan/drawer";
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
import { planAdsManagerLinks } from "@/lib/plan/ads-manager-links";
import type { ResolvedChannelDefaults } from "@/lib/clients/channel-defaults";
import type { EventFunnelView } from "@/lib/dashboard/event-funnel";
import type { PlanPreflightIssue } from "@/lib/plan/preflight";
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
  thumbUrl = null,
  targetBenchmark = null,
}: {
  initialPlan: CampaignPlan;
  events: PlanEventOption[];
  tiktokAdvertiserId?: string | null;
  googleAdsAccounts?: GoogleSearchWizardContext["googleAdsAccounts"];
  isNew?: boolean;
  /** LIVE state only — resolved on the server from event_daily_rollups. */
  funnel?: EventFunnelView | null;
  liveSpend?: number | null;
  thumbUrl?: string | null;
  /**
   * The client preset's benchmark for this plan's objective. Zone D shows
   * it with the seed badge when the plan has no target of its own, so the
   * field is never empty (§2 zone D).
   */
  targetBenchmark?: number | null;
}) {
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
  const [resolved, setResolved] = useState<ResolvedChannelDefaults | null>(null);
  const [preflightOk, setPreflightOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [budgetMode, setBudgetMode] = useState<"daily" | "lifetime">("daily");
  const [lifetimeTotal, setLifetimeTotal] = useState(0);
  const [decisionCount, setDecisionCount] = useState(0);
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
    if (!persisted) return;
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
  }, [persisted, plan.id]);

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
    if (!metaDraftId) return;
    let cancelled = false;
    const lastOpened =
      typeof window === "undefined"
        ? null
        : window.localStorage.getItem(planLastOpenedKey(plan.id));
    fetch(`/api/campaigns/${encodeURIComponent(metaDraftId)}/automation`)
      .then((res) => res.json())
      .then((json: { ok?: boolean; decisions?: { decidedAt?: string | null }[] }) => {
        if (cancelled || !json.ok) return;
        setDecisionCount(countDecisionsSince(json.decisions ?? [], lastOpened));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [metaDraftId, plan.id]);

  useEffect(() => {
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
  }, [plan, router, hasUserEdit]);

  useEffect(() => {
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
  }, [plan]);

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
    if (destination.source === "manual" || destination.source === "none") return;
    if (plan.intent.destinationUrl === destination.url) return;
    setPlan((current) => ({
      ...current,
      intent: { ...current.intent, destinationUrl: destination.url },
    }));
  }, [destination.source, destination.url, plan.intent.destinationUrl]);

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
          metaAdAccountId: selectedEvent?.metaAdAccountId,
          googleCustomerId: selectedEvent?.googleCustomerId,
          tiktokAdvertiserId,
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
      selectedEvent,
      staleChips,
      tiktokAdvertiserId,
    ],
  );

  const state = useMemo(
    () => planCanvasState({ plan, rows, liveSpend }),
    [liveSpend, plan, rows],
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
        preflightOk,
        busy,
      }),
    [busy, destination.url, gate, plan.intent.eventId, preflightOk, rows, state],
  );

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
      if (draftId) openDrawerOrWizard(row.adapter, draftId, row.anchor);
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

  const menuItems: OverflowMenuItem[] = planCanvasMenuItemSpecs({
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
  const defaults = planDefaultWindow(selectedEvent);

  return (
    <div className="space-y-5">
      <CanvasHeader
        name={headerName}
        clientName={selectedEvent?.clientName ?? null}
        eventDate={selectedEvent?.eventDate ?? null}
        eventCode={selectedEvent?.eventCode ?? null}
        thumbUrl={thumbUrl}
        destination={destination}
        onDestination={(url) => patchIntent({ destinationUrl: url })}
        decisionCount={decisionCount}
        decisionsRef={decisionsOpenRef}
        onDecisionsOpen={() => {
          window.localStorage.setItem(planLastOpenedKey(plan.id), new Date().toISOString());
          setDecisionCount(0);
          setDrawer(null);
          setDecisionsOpen(true);
        }}
        menuItems={menuItems}
        resolved={resolved}
      />

      {!plan.intent.eventId ? (
        <div className="max-w-md">
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

      <CanvasWindow
        event={selectedEvent}
        dates={{
          startDate: plan.intent.startDate ?? defaults.startDate,
          startTime: plan.intent.startTime ?? defaults.startTime,
          endDate: plan.intent.endDate ?? defaults.endDate,
          endTime: plan.intent.endTime ?? defaults.endTime,
        }}
        onChange={setWindow}
        googleBudgeted={plan.intent.budget.googleDaily > 0}
      />

      <CanvasBudget
        budget={plan.intent.budget}
        mode={budgetMode}
        lifetime={lifetimeTotal}
        startDate={plan.intent.startDate}
        endDate={plan.intent.endDate}
        hasUserEdit={hasUserEdit}
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
      />

      <CanvasTarget
        value={plan.intent.target.value}
        unit={plan.intent.target.unit}
        benchmark={targetBenchmark}
        objectiveIntent={plan.intent.objectiveIntent}
        presetHref={selectedEvent?.clientId ? `/clients/${selectedEvent.clientId}?tab=optimisation` : null}
        onTarget={(value) => patchIntent({ target: { value, unit: plan.intent.target.unit } })}
        onUnit={setTargetUnit}
        onObjective={(objectiveIntent) => patchIntent({ objectiveIntent })}
      />

      {/* The wizard's PlanLinkBanner still lands here. */}
      <div id={PLAN_STEP2_HASH} />
      <CanvasChannels
        rows={rows}
        costs={
          funnel
            ? {
                meta: funnel.costs.platforms.find((row) => row.platform === "meta"),
                tiktok: funnel.costs.platforms.find((row) => row.platform === "tiktok"),
                google: funnel.costs.platforms.find((row) => row.platform === "google"),
              }
            : undefined
        }
        onOpen={(row) => void openChannel(row)}
        onOpenAnchor={(row, anchor) => void openChannel(row, undefined, anchor)}
        openRefs={{
          meta: metaOpenRef,
          tiktok: tiktokOpenRef,
          google: googleOpenRef,
        }}
        onResume={(row) => void resume([row.adapter])}
        onRederive={(row) => void rederive(row.adapter)}
        busy={busy}
      />

      <CanvasAssets
        planId={plan.id}
        hasMetaDraft={hasMetaDraft}
        onUpload={() => {
          if (metaDraftId) openDrawerOrWizard("meta", metaDraftId);
        }}
        onUnregistered={setUnregisteredAssets}
      />

      {drawer?.adapter === "meta" ? (
        <MetaDrawerMount
          open
          draftId={drawer.draftId}
          initialAnchor={drawer.anchor}
          triggerRef={metaOpenRef}
          onTabChange={(tab) =>
            setDrawer((current) => (current ? { ...current, tab } : current))
          }
          planId={plan.id}
          onClose={() => setDrawer(null)}
        />
      ) : null}

      {drawer?.adapter === "tiktok" ? (
        <TikTokDrawerMount
          open
          draftId={drawer.draftId}
          initialAnchor={drawer.anchor}
          triggerRef={tiktokOpenRef}
          onTabChange={(tab) =>
            setDrawer((current) => (current ? { ...current, tab } : current))
          }
          planId={plan.id}
          onClose={() => setDrawer(null)}
        />
      ) : null}

      {drawer?.adapter === "google" ? (
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
          onClose={() => setDrawer(null)}
        />
      ) : null}

      {metaDraftId ? (
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

      <CanvasLaunch
        button={launchButton}
        stages={state === "live" ? funnel?.stages : undefined}
        error={error}
        onLaunch={() => void launchAll()}
        onResumeAll={() =>
          void resume(rows.filter((row) => !row.skipped && row.status === "paused").map((row) => row.adapter))
        }
      />

      {/* "From existing campaign…" only ever seeds the Meta draft. */}
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

      {events.length === 0 ? <InfoTip label="No events yet." /> : null}
    </div>
  );
}
