"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

import { addClusterFromInsights } from "@/components/insights-rail/add-cluster";
import { useAddedClusters } from "@/components/insights-rail/use-added-clusters";
import { useInsightsRail } from "@/components/insights-rail/rail-context";
import { dispatchUseAngle } from "@/components/insights-rail/use-angle";
import {
  LOCK_LINE,
  SCOPE_LABELS,
  STAGE_LABELS,
  thinLine,
  type InsightSection,
  type RailContext,
  type RailData,
  type RailScope,
  type RailStage,
} from "@/lib/insights-rail/model";

const RAIL_WIDTH = 360;
const TAB_WIDTH = 34;
const PUSH_AT = 1200;
const DRAWER_AT = 768;

type Layout = "push" | "drawer" | "sheet";

function subscribeLayout(listener: () => void): () => void {
  const queries = [window.matchMedia(`(min-width: ${PUSH_AT}px)`), window.matchMedia(`(min-width: ${DRAWER_AT}px)`)];
  for (const query of queries) query.addEventListener("change", listener);
  return () => {
    for (const query of queries) query.removeEventListener("change", listener);
  };
}

function readLayout(): Layout {
  if (window.matchMedia(`(min-width: ${PUSH_AT}px)`).matches) return "push";
  return window.matchMedia(`(min-width: ${DRAWER_AT}px)`).matches ? "drawer" : "sheet";
}

const serverLayout = (): Layout => "push";

/** Push at ≥1200, a drawer at 768–1199, a sheet below (R1). The server paints the push layout. */
function useLayout(): Layout {
  return useSyncExternalStore(subscribeLayout, readLayout, serverLayout);
}

/** A page with no declared context reads as "this page" over everyone's data (R4). */
const PAGE_CONTEXT: RailContext = {
  surface: "page",
  title: "This page",
  clientId: null,
  clientName: null,
  verticalId: null,
  eventId: null,
  stage: "registration",
  objective: null,
  lab: null,
};

function query(context: RailContext, scope: RailScope, stage: RailStage): string {
  const q = new URLSearchParams();
  q.set("surface", context.surface);
  q.set("scope", scope);
  q.set("stage", stage);
  q.set("title", context.title);
  if (context.clientId) q.set("clientId", context.clientId);
  if (context.clientName) q.set("clientName", context.clientName);
  if (context.verticalId) q.set("verticalId", context.verticalId);
  if (context.eventId) q.set("eventId", context.eventId);
  if (context.objective) q.set("objective", context.objective);
  if (context.lab) q.set("lab", JSON.stringify(context.lab));
  return q.toString();
}

/**
 * The Insights rail (R1–R11). Mounted once, by the operator layout. At
 * ≥1200 it is a column beside the page and pushes it; at 768–1199 a
 * drawer below the page header; below 768 a bottom sheet opened from the
 * header pill. Everything it draws comes from lib/insights-rail/model.
 */
export function InsightsRail() {
  const { operator, context: declared, open, setOpen, fixture } = useInsightsRail();
  const layout = useLayout();
  const context = declared ?? PAGE_CONTEXT;
  const contextKey = JSON.stringify(context);

  // The toggles belong to the page they were set on: a new page resets them.
  const [pick, setPick] = useState<{ key: string; scope: RailScope; stage: RailStage } | null>(null);
  // The audience builder opens on the client's vertical (IR5): cluster verticals are the clusters' own column.
  const restScope: RailScope = context.surface === "audience_builder" && context.verticalId ? "vertical" : context.clientId ? "client" : "all";
  const scope = pick?.key === contextKey ? pick.scope : restScope;
  const stage = pick?.key === contextKey ? pick.stage : context.stage;
  const setScope = (next: RailScope) => setPick({ key: contextKey, scope: next, stage });
  const setStage = (next: RailStage) => setPick({ key: contextKey, scope, stage: next });

  // One request per (page, scope, stage). The last answer stays on screen
  // while the next one loads.
  const requestKey = `${contextKey}|${scope}|${stage}`;
  const [answer, setAnswer] = useState<{ key: string; data: RailData | null; error: string | null } | null>(null);
  useEffect(() => {
    if (fixture || !operator || !open) return;
    const controller = new AbortController();
    fetch(`/api/insights-rail?${query(JSON.parse(contextKey) as RailContext, scope, stage)}`, { signal: controller.signal })
      .then(async (res) => {
        const json = (await res.json()) as RailData & { error?: string };
        if (!res.ok) throw new Error(json.error || "Could not read the insights.");
        setAnswer({ key: requestKey, data: json, error: null });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setAnswer({ key: requestKey, data: null, error: err instanceof Error ? err.message : "Could not read the insights." });
      });
    return () => controller.abort();
  }, [fixture, operator, open, contextKey, scope, stage, requestKey]);

  if (!operator) return null;

  const data = fixture ?? answer?.data ?? null;
  const error = !fixture && answer?.key === requestKey ? answer.error : null;
  const loading = !fixture && open && answer?.key !== requestKey;

  const panel = (
    <Panel
      context={context}
      scope={scope}
      stage={stage}
      data={data}
      error={error}
      loading={loading}
      onScope={setScope}
      onStage={setStage}
      onClose={() => setOpen(false)}
      sheet={layout === "sheet"}
    />
  );

  if (layout === "sheet") {
    if (!open) return <aside data-insights-rail data-layout="sheet" className="hidden" />;
    return (
      <aside data-insights-rail data-layout="sheet" className="fixed inset-0 z-40">
        <button type="button" aria-label="Close insights" className="absolute inset-0 bg-foreground/35" onClick={() => setOpen(false)} />
        <div className="absolute inset-x-0 bottom-0 flex h-[86%] flex-col rounded-t-2xl border-t border-border-strong bg-card shadow-md">
          <span aria-hidden className="mx-auto mt-2 mb-0.5 h-1 w-9 rounded-full bg-border-strong" />
          {panel}
        </div>
      </aside>
    );
  }

  const tab = (
    <button
      type="button"
      className="flex h-full w-full flex-col items-center gap-2.5 pt-3.5 text-foreground/80"
      aria-label="Open insights"
      aria-expanded={false}
      onClick={() => setOpen(true)}
    >
      <span aria-hidden className="text-[13px]">‹</span>
      <span className="text-xs font-semibold tracking-wide [writing-mode:vertical-rl]">Insights</span>
    </button>
  );

  if (layout === "drawer") {
    return (
      <aside data-insights-rail data-layout="drawer" className={`relative shrink-0 bg-card ${open ? "" : "border-l border-border-strong"}`} style={{ width: TAB_WIDTH }}>
        {open ? null : tab}
        {open ? <Drawer onClose={() => setOpen(false)}>{panel}</Drawer> : null}
      </aside>
    );
  }

  return (
    <aside
      data-insights-rail
      data-layout="push"
      data-open={open ? "true" : "false"}
      className="flex shrink-0 flex-col border-l border-border-strong bg-card"
      style={{ width: open ? RAIL_WIDTH : TAB_WIDTH }}
    >
      {open ? panel : tab}
    </aside>
  );
}

/** 768–1199: over the content, below the page header, so its buttons stay reachable (R1). */
function Drawer({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  // Mounted only when open, on the client, so the header is there to measure.
  const [top] = useState(() => {
    const header = document.querySelector("main header, header");
    return header ? Math.ceil(header.getBoundingClientRect().bottom) : 0;
  });
  return (
    <>
      <button type="button" aria-label="Close insights" className="fixed right-0 bottom-0 left-0 z-20 bg-foreground/25" style={{ top }} onClick={onClose} />
      <div className="fixed right-0 bottom-0 z-30 flex flex-col border-l border-border-strong bg-card shadow-md" style={{ top, width: RAIL_WIDTH }}>
        {children}
      </div>
    </>
  );
}

function Seg<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string; disabled?: boolean; title?: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <span className="inline-flex overflow-hidden rounded-full border border-border-strong text-[11.5px]">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={option.id === value}
          disabled={option.disabled}
          title={option.title}
          className={`px-2.5 py-0.5 ${option.id === value ? "bg-foreground text-background" : "text-foreground"} disabled:text-muted-foreground disabled:opacity-60`}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </span>
  );
}

function contextLine(context: RailContext, stage: RailStage, scope: RailScope): string {
  if (context.surface === "page") {
    const scopeWord = scope === "all" ? "All clients" : scope === "client" ? (context.clientName ?? "This client") : "Vertical";
    return [context.title, scopeWord, STAGE_LABELS[stage]].filter(Boolean).join(" · ");
  }
  if (context.surface === "campaign" || context.surface === "tiktok_campaign" || context.surface === "audience_builder") {
    return [context.title, context.clientName, STAGE_LABELS[stage], context.objective].filter(Boolean).join(" · ");
  }
  const state = context.stage === "ticket_sale" ? "on sale" : STAGE_LABELS[stage];
  return [context.title, stage === context.stage ? state : STAGE_LABELS[stage]].filter(Boolean).join(" · ");
}

function Panel({
  context,
  scope,
  stage,
  data,
  error,
  loading,
  onScope,
  onStage,
  onClose,
  sheet,
}: {
  context: RailContext;
  scope: RailScope;
  stage: RailStage;
  data: RailData | null;
  error: string | null;
  loading: boolean;
  onScope: (scope: RailScope) => void;
  onStage: (stage: RailStage) => void;
  onClose: () => void;
  sheet: boolean;
}) {
  const verticalOff = data?.verticalDisabledReason ?? null;
  return (
    <div className="flex min-h-0 flex-1 flex-col text-[12.5px]">
      <div className="border-b border-border px-3.5 pt-3 pb-2.5">
        <div className="flex items-center justify-between">
          <b className="text-sm">Insights</b>
          <button type="button" aria-label="Close insights" className="px-1 text-sm text-muted-foreground" onClick={onClose}>
            {sheet ? "✕" : "›"}
          </button>
        </div>
        <p className="mt-0.5 mb-2 text-[11.5px] text-muted-foreground">{contextLine(context, stage, scope)}</p>
        <div className="flex flex-wrap gap-1.5">
          <Seg
            value={scope}
            options={[
              { id: "client" as RailScope, label: SCOPE_LABELS.client, disabled: !context.clientId, title: context.clientId ? undefined : "This page has no client" },
              {
                id: "vertical" as RailScope,
                label: !verticalOff && context.verticalId && !sheet ? `${SCOPE_LABELS.vertical} · ${context.verticalId}` : SCOPE_LABELS.vertical,
                disabled: Boolean(verticalOff),
                title: verticalOff ?? undefined,
              },
              { id: "all" as RailScope, label: sheet ? "All" : SCOPE_LABELS.all },
            ]}
            onChange={onScope}
          />
          <Seg value={stage} options={[{ id: "registration" as RailStage, label: "Signup" }, { id: "ticket_sale" as RailStage, label: "Ticket sale" }]} onChange={onStage} />
        </div>
        {scope !== "client" ? <p className="mt-1.5 text-[11px] text-muted-foreground">{LOCK_LINE}</p> : null}
        {verticalOff ? <p className="mt-1.5 text-[11px] text-muted-foreground">{verticalOff}</p> : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pt-1 pb-3.5">
        {error ? <p className="py-3 text-destructive">{error}</p> : null}
        {!data && loading ? <p className="py-3 text-muted-foreground">Reading the last 90 days…</p> : null}
        {data?.sections.map((section) => <Section key={section.id} section={section} />)}
      </div>
    </div>
  );
}

const TONE = { olive: "bg-success", brick: "bg-destructive", ink: "bg-foreground/70" } as const;

function Section({ section }: { section: InsightSection }) {
  const [showUntried, setShowUntried] = useState(false);
  const addedClusters = useAddedClusters();
  return (
    <section data-insight-section={section.id} className="border-b border-border py-3 last:border-b-0">
      {section.borrowed ? <p data-borrowed-line className="mb-2.5 text-[11.5px] text-warning-foreground">{section.borrowed}</p> : null}
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[9px] font-bold tracking-[.16em] text-foreground/80 uppercase">{section.kicker}</span>
        {section.scopeLabel ? (
          <span className="text-[9px] font-bold tracking-[.16em] text-muted-foreground uppercase">{section.scopeLabel}</span>
        ) : null}
      </div>
      {section.fallback ? <p className="mb-1.5 text-[11.5px] text-warning-foreground">{section.fallback}</p> : null}
      {section.empty ? <p className="rounded-md bg-muted px-2.5 py-2 text-xs text-foreground/80">{section.empty}</p> : null}
      {section.result ? <p className={`mb-1.5 ${section.result.winner ? "font-semibold" : "text-foreground/80"}`}>{section.result.text}</p> : null}
      {section.chips?.map((chip) => (
        <p key={chip.text} className="mt-1.5 flex items-center justify-between gap-2 text-[12px]">
          <span className="min-w-0">{chip.text}</span>
          <button type="button" className="h-6 shrink-0 rounded-md border border-border-strong px-2 text-[11.5px] font-semibold whitespace-nowrap">
            {chip.action}
          </button>
        </p>
      ))}
      {section.bars.length ? (
        <ul className="flex flex-col gap-1.5">
          {section.bars.map((bar) => (
            <li key={bar.key} className="grid grid-cols-[1fr_122px] items-center gap-x-2.5 gap-y-0.5 text-[11.5px]">
              <span className={bar.facets ? "col-span-2" : "col-span-2 truncate"}>
                {bar.label}
                {bar.facets ? <span className="text-muted-foreground"> · {bar.facets}</span> : null}
              </span>
              <span className="relative h-2 rounded bg-muted">
                <i className={`absolute inset-y-0 left-0 rounded ${TONE[bar.tone]}`} style={{ width: `${Math.min(100, bar.width * 100)}%` }} />
                {section.baselineAt != null ? (
                  <s aria-hidden className="absolute -top-0.5 -bottom-0.5 border-l border-dashed border-muted-foreground" style={{ left: `${Math.min(100, section.baselineAt * 100)}%` }} />
                ) : null}
              </span>
              <span className="text-right font-mono text-[10.5px] whitespace-nowrap tabular-nums">
                {bar.valueText} <small className="text-muted-foreground">· {bar.note}</small>
              </span>
              {bar.detail ? (
                <span className="col-span-2 font-mono text-[10.5px] text-muted-foreground">
                  <span className="max-[700px]:hidden">{bar.detail}</span>
                  {bar.detailNarrow ? <span className="min-[701px]:hidden">{bar.detailNarrow}</span> : null}
                </span>
              ) : null}
            </li>
          ))}
          {section.thin.map((row) => (
            <li key={row.key} className="text-[11px] text-muted-foreground">
              <span className="block">{row.label}</span>
              <span className="block">{row.line ?? thinLine(row.fundedAds)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {section.clusters.length ? (
        <ul className="flex flex-col">
          {section.clusters.map((cluster) => {
            const added = addedClusters.some((entry) => entry.id === cluster.id);
            return (
              <li key={cluster.id} data-cluster-row className="grid grid-cols-[1fr_auto] items-center gap-x-2.5 gap-y-0.5 border-t border-border py-1.5 text-xs first:border-t-0">
                <span className="min-w-0 truncate">{cluster.name}</span>
                <button
                  type="button"
                  disabled={added}
                  className="row-span-2 h-6 shrink-0 rounded-md border border-border-strong px-2 text-[11.5px] font-semibold whitespace-nowrap disabled:text-muted-foreground"
                  onClick={() => void addClusterFromInsights(cluster)}
                >
                  {added ? "Added" : "Add cluster"}
                </button>
                <span className="col-start-1 font-mono text-[10.5px] text-muted-foreground">{cluster.line}</span>
              </li>
            );
          })}
          {section.clusterThin ? (
            <li className="grid grid-cols-[1fr_auto] gap-y-0.5 border-t border-border py-1.5 text-xs text-muted-foreground">
              <span className="min-w-0">{section.clusterThin.names}</span>
              <span />
              <span className="col-start-1 font-mono text-[10.5px]">{section.clusterThin.note}</span>
            </li>
          ) : null}
        </ul>
      ) : null}
      {section.untried ? (
        <p className="mt-1.5 font-mono text-[10.5px] text-muted-foreground">
          {section.untried.count} clusters not tried yet ·{" "}
          <button type="button" className="underline-offset-2 hover:underline" aria-expanded={showUntried} onClick={() => setShowUntried((open) => !open)}>
            {showUntried ? "hide" : "show"}
          </button>
          {section.picked != null ? <span className="max-md:hidden"> · picked {section.picked} time{section.picked === 1 ? "" : "s"} so far</span> : null}
        </p>
      ) : null}
      {section.untried && showUntried ? (
        <ul className="mt-1 flex flex-col gap-0.5 text-[11.5px] text-foreground/80">
          {section.untried.names.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      ) : null}
      {section.labRows.map((row) => (
        <p key={row.name} className="mt-2 flex items-center gap-1.5 text-xs">
          {row.name}
          {row.verdict === "winner" ? <span className="rounded bg-success px-1.5 py-0.5 text-[10.5px] leading-none text-background">Winner</span> : null}
        </p>
      ))}
      {section.confidence ? <p className="mt-1.5 font-mono text-[10.5px] text-muted-foreground">{section.confidence}</p> : null}
      {section.lock ? <p className="mt-1.5 text-[11px] text-muted-foreground">{LOCK_LINE}</p> : null}
      {section.action ? (
        // The button never wraps; the note wraps beside it, or drops below (9a).
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          <button type="button" className="shrink-0 rounded-md bg-foreground px-3 py-1 text-xs font-semibold whitespace-nowrap text-background" onClick={() => dispatchUseAngle(section.action!.angle)}>
            {section.action.label}
          </button>
          {section.action.note ? <span className="min-w-0 text-[11px] text-muted-foreground">{section.action.note}</span> : null}
        </p>
      ) : null}
    </section>
  );
}
