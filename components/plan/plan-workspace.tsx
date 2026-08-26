"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { CampaignLibraryPicker, type LibraryPick } from "@/components/library/campaign-library-picker";
import { AssetRoutingMatrix } from "@/components/plan/asset-routing-matrix";
import { PlanDateTimeField } from "@/components/plan/plan-datetime-field";
import { PlanDeleteAction } from "@/components/plan/plan-delete-action";
import { Combobox } from "@/components/ui/combobox";
import { Button } from "@/components/ui/button";
import { planAdsManagerLinks } from "@/lib/plan/ads-manager-links";
import { splitPlanBlockers } from "@/lib/plan/blockers";
import { planLaunchStatusIsIdle } from "@/lib/plan/from-existing";
import { PLAN_OBJECTIVE_OPTIONS } from "@/lib/plan/empty-plan";
import { shouldPersistPlanOnChange } from "@/lib/plan/persist-policy";
import {
  planEventPickerRows,
  todayIsoDate,
  visiblePlanEvents,
  type PlanEventOption,
} from "@/lib/plan/event-picker";
import { GOOGLE_PREPARE_REASON, wizardHrefForDraft } from "@/lib/plan/prepare-draft";
import type { PlanPreflightIssue } from "@/lib/plan/preflight";
import {
  GOOGLE_DATE_ONLY_NOTE,
  PLAN_STEP2_HASH,
  WIZARD_ACTIVE_VS_PLAN_PAUSED,
} from "@/lib/plan/schedule";
import type { CampaignPlan, CampaignPlanObjectiveIntent, PlanAdapterName } from "@/lib/plan/types";

export type { PlanEventOption };

/**
 * One platform card. Blockers are split by where they are actually fixed:
 * wizard-owned bindings (accounts, identities, creatives, keywords) sit next
 * to the Prepare/Continue button so they read as the next step, while the
 * shared inputs this page owns are called out separately. A single flat red
 * list reads as a dead end.
 */
function PlatformCard({
  adapter,
  heading,
  preview,
  issues,
  draftId,
  prepareLabel,
  fromExistingLabel,
  busy,
  disabled,
  disabledReason,
  note,
  warning,
  onPrepare,
  onPrepareFromExisting,
  onRederive,
  staleChip,
}: {
  adapter: PlanAdapterName;
  heading: string;
  preview?: Preview;
  issues: PlanPreflightIssue[];
  draftId: string | null;
  prepareLabel: string;
  fromExistingLabel?: string;
  busy: boolean;
  disabled: boolean;
  disabledReason?: string | null;
  note?: string;
  warning?: string;
  onPrepare: () => void;
  onPrepareFromExisting?: () => void;
  onRederive?: () => void;
  staleChip?: string | null;
}) {
  const split = splitPlanBlockers(issues, adapter);
  const href = draftId ? wizardHrefForDraft(adapter, draftId) : null;

  return (
    <article className="rounded-lg border border-border bg-card p-4 text-sm shadow-sm">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          {heading}
        </p>
        <p className="text-xs text-muted-foreground">
          {draftId
            ? split.wizard.length === 0
              ? "Complete"
              : `${split.wizard.length} to finish in the wizard`
            : "Not started"}
        </p>
      </div>

      {preview ? (
        <dl className="mt-2 space-y-1">
          <div>
            <dt className="text-muted-foreground">Name</dt>
            <dd>{preview.name || "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Objective</dt>
            <dd>{preview.objective || "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Daily budget</dt>
            <dd>{preview.dailyBudget ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Destination</dt>
            <dd className="break-all">{preview.destinationUrl || "—"}</dd>
          </div>
        </dl>
      ) : null}

      <div className="mt-3 space-y-3">
        {warning ? (
          <p className="text-xs text-muted-foreground">{warning}</p>
        ) : null}

        <div className="rounded-md border border-border bg-muted/30 p-3">
          {!draftId && split.wizard.some((issue) => issue.href) ? (
            <ul className="mb-2 space-y-1 text-xs text-muted-foreground">
              {split.wizard
                .filter((issue) => issue.href)
                .map((issue) => (
                  <li key={issue.id}>
                    <Link href={issue.href!} className="underline">
                      {issue.message}
                    </Link>
                  </li>
                ))}
            </ul>
          ) : null}
          {draftId ? (
            <>
              <p className="text-xs font-medium">Complete in the wizard</p>
              {split.wizard.length === 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">Nothing outstanding.</p>
              ) : (
                <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                  {split.wizard.map((issue) => (
                    <li key={issue.id}>
                      {issue.href ? (
                        <Link href={issue.href} className="underline">
                          {issue.message}
                        </Link>
                      ) : (
                        issue.message
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : null}
          <div className={`${draftId ? "mt-2" : ""} flex flex-wrap gap-2`}>
            {href ? (
              <Link
                href={href}
                className="inline-flex h-8 items-center justify-center rounded-md bg-surface px-3 text-xs font-medium text-foreground transition-colors hover:bg-card"
              >
                Continue in wizard
              </Link>
            ) : (
              <>
                <Button
                  type="button"
                  size="sm"
                  disabled={busy || disabled}
                  onClick={onPrepare}
                >
                  {prepareLabel}
                </Button>
                {onPrepareFromExisting && fromExistingLabel ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy || disabled}
                    onClick={onPrepareFromExisting}
                  >
                    {fromExistingLabel}
                  </Button>
                ) : null}
              </>
            )}
            {href && onRederive ? (
              <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onRederive}>
                Re-derive from Meta
              </Button>
            ) : null}
          </div>
          {staleChip && onRederive ? (
            <button
              type="button"
              className="mt-2 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-left text-xs text-foreground"
              disabled={busy}
              onClick={onRederive}
            >
              {staleChip}
            </button>
          ) : null}
          {!href && disabled && disabledReason ? (
            <p className="mt-2 text-xs text-muted-foreground">{disabledReason}</p>
          ) : null}
        </div>

        {split.plan.length > 0 ? (
          <div className="rounded-md border border-destructive/40 p-3">
            <p className="text-xs font-medium text-destructive">Fix on this page</p>
            <ul className="mt-1 space-y-1 text-xs text-destructive">
              {split.plan.map((issue) => (
                <li key={issue.id}>{issue.message}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {split.notes.length > 0 ? (
          <ul className="space-y-1 text-xs text-muted-foreground">
            {split.notes.map((issue) => (
              <li key={issue.id}>{issue.message}</li>
            ))}
          </ul>
        ) : null}

        {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      </div>
    </article>
  );
}

interface GateState {
  enabled: boolean;
  skippedReason: string | null;
}

interface Preview {
  name: string;
  objective: string | null;
  dailyBudget: number | null;
  destinationUrl: string | null;
}

export function PlanWorkspace({
  initialPlan,
  events,
  tiktokAdvertiserId,
  isNew = false,
}: {
  initialPlan: CampaignPlan;
  events: PlanEventOption[];
  tiktokAdvertiserId?: string | null;
  isNew?: boolean;
}) {
  const [plan, setPlan] = useState(initialPlan);
  const [hasUserEdit, setHasUserEdit] = useState(false);
  const [persisted, setPersisted] = useState(!isNew);
  const [staleChips, setStaleChips] = useState<{ tiktok: string | null; google: string | null }>({
    tiktok: null,
    google: null,
  });
  const [gate, setGate] = useState<GateState | null>(null);
  const [issues, setIssues] = useState<PlanPreflightIssue[]>([]);
  const [previews, setPreviews] = useState<Record<"meta" | "tiktok" | "google", Preview> | null>(
    null,
  );
  const [preflightOk, setPreflightOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [persistState, setPersistState] = useState<string>(
    isNew ? "Not saved yet" : "Saved to campaign_plans",
  );
  const [preparing, setPreparing] = useState<PlanAdapterName | null>(null);
  const [deriving, setDeriving] = useState<PlanAdapterName | null>(null);
  const [notes, setNotes] = useState<Partial<Record<PlanAdapterName, string>>>({});
  const [showPastEvents, setShowPastEvents] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const router = useRouter();

  const hasMetaDraft = plan.launches.meta.draftId != null;
  /**
   * The audience cluster is no longer an authored input — Meta owns targeting.
   * Existing plans keep the value, and it only means anything while there is
   * no Meta draft to read the real vocabulary from.
   */
  const metaFallbackHint =
    !hasMetaDraft && plan.intent.audienceClusterRef
      ? `Fallback hint from this plan: audience cluster "${plan.intent.audienceClusterRef}". Once a Meta draft exists, its page groups and interests replace it.`
      : null;

  function markPlan(updater: (current: CampaignPlan) => CampaignPlan) {
    setHasUserEdit(true);
    setPlan(updater);
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

  const refreshMirror = useCallback(async () => {
    if (!persisted) return;
    const res = await fetch(`/api/plan/${encodeURIComponent(plan.id)}/mirror`);
    const json = (await res.json()) as {
      ok?: boolean;
      tiktok?: { chip?: string | null };
      google?: { chip?: string | null };
    };
    if (!res.ok || !json.ok) return;
    setStaleChips({
      tiktok: json.tiktok?.chip ?? null,
      google: json.google?.chip ?? null,
    });
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

  useEffect(() => {
    if (!shouldPersistPlanOnChange({ hasUserEdit, eventId: plan.intent.eventId })) return;
    const handle = window.setTimeout(() => {
      void fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      })
        .then((res) => res.json())
        .then((json: { ok?: boolean; tableMissing?: boolean; error?: string }) => {
          if (json.ok) {
            setPersistState("Saved to campaign_plans");
            setPersisted(true);
            if (window.location.pathname === "/plan/new") {
              router.replace(`/plan/${plan.id}`);
            }
            return;
          }
          if (json.tableMissing) {
            setPersistState("campaign_plans is missing (migration 157)");
            return;
          }
          setPersistState(json.error ?? "Save failed");
        })
        .catch((err: unknown) => {
          setPersistState(err instanceof Error ? err.message : "Save failed");
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
            previews?: Record<"meta" | "tiktok" | "google", Preview>;
          }) => {
            setIssues(json.issues ?? []);
            setPreviews(json.previews ?? null);
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

  const launchDisabledReason = useMemo(() => {
    if (!gate) return "Checking fan-out gate…";
    if (!gate.enabled) {
      return `Launch all (paused) is disabled — ${gate.skippedReason ?? "killswitch"} (ENABLE_PLAN_FANOUT is not \"1\")`;
    }
    if (!plan.intent.eventId) return "Choose an event first";
    if (!plan.intent.destinationUrl.trim()) return "Destination URL is required";
    if (!preflightOk) return "Launch all (paused) is disabled — preflight still has blockers";
    if (busy) return "Launch in progress";
    return null;
  }, [busy, gate, plan.intent.destinationUrl, plan.intent.eventId, preflightOk]);

  async function prepareDraft(
    adapter: PlanAdapterName,
    source?: LibraryPick,
  ) {
    setPreparing(adapter);
    setError(null);
    try {
      const persistRes = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const persistJson = (await persistRes.json()) as { ok?: boolean; error?: string };
      if (!persistRes.ok || !persistJson.ok) {
        setError(persistJson.error ?? "Save the plan before preparing a draft");
        return;
      }
      setHasUserEdit(true);
      setPersisted(true);
      setPersistState("Saved to campaign_plans");
      if (window.location.pathname === "/plan/new") {
        router.replace(`/plan/${plan.id}`);
      }
      const res = await fetch(`/api/plan/${encodeURIComponent(plan.id)}/prepare-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adapter,
          clientId: selectedEvent?.clientId ?? null,
          source: source ?? { kind: "plan" },
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        draftId?: string;
        launches?: CampaignPlan["launches"];
        derived?: { added: number; skippedReason?: string | null; negatives?: number };
      };
      if (!res.ok || !json.ok || !json.launches) {
        setError(json.error ?? "Could not prepare draft");
        return;
      }
      setPlan((current) => ({ ...current, launches: json.launches! }));
      setLibraryOpen(false);
      if (json.derived) {
        setNotes((current) => ({
          ...current,
          [adapter]: json.derived!.skippedReason
            ? `Derivation skipped: ${json.derived!.skippedReason}`
            : `Derived ${json.derived!.added} term${json.derived!.added === 1 ? "" : "s"} from Meta.`,
        }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not prepare draft");
    } finally {
      setPreparing(null);
    }
  }

  async function rederive(adapter: PlanAdapterName) {
    setDeriving(adapter);
    setError(null);
    try {
      const res = await fetch(`/api/plan/${encodeURIComponent(plan.id)}/derive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adapter }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        added?: number;
        keptOperatorItems?: number;
      };
      if (!res.ok || !json.ok) {
        setNotes((current) => ({
          ...current,
          [adapter]: json.error ?? "Could not re-derive from Meta",
        }));
        return;
      }
      setNotes((current) => ({
        ...current,
        [adapter]: `Re-derived ${json.added ?? 0} term${json.added === 1 ? "" : "s"} from Meta; kept ${json.keptOperatorItems ?? 0} you edited in the wizard.`,
      }));
      setStaleChips((current) => ({ ...current, [adapter]: null }));
      void refreshMirror();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not re-derive from Meta");
    } finally {
      setDeriving(null);
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
        setError(`Fan-out skipped: ${json.skippedReason}`);
        return;
      }
      if (!res.ok || !json.plan) {
        setError(json.error ?? "Launch failed");
        return;
      }
      setPlan(json.plan);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Launch failed");
    } finally {
      setBusy(false);
    }
  }

  const today = todayIsoDate();
  const pickerEvents = useMemo(
    () =>
      visiblePlanEvents(events, {
        today,
        showPast: showPastEvents,
        selectedId: plan.intent.eventId,
      }),
    [events, plan.intent.eventId, showPastEvents, today],
  );
  const pickerOptions = useMemo(
    () =>
      planEventPickerRows(pickerEvents).map((row) => ({
        value: row.id,
        label: row.label,
        sublabel: row.sublabel || undefined,
        keywords: row.keywords || undefined,
      })),
    [pickerEvents],
  );
  const selectedEvent = events.find((event) => event.id === plan.intent.eventId);
  const links = planAdsManagerLinks(plan, {
    metaAdAccountId: selectedEvent?.metaAdAccountId,
    googleCustomerId: selectedEvent?.googleCustomerId,
    tiktokAdvertiserId,
  });
  const noEvents = events.length === 0;
  const launchIdle = planLaunchStatusIsIdle(plan);

  return (
    <div className="space-y-6">
      {noEvents ? (
        <p className="rounded-lg border border-dashed border-border bg-muted/40 px-4 py-6 text-sm text-muted-foreground">
          No events yet. Create an event first — a plan is scoped to one event and
          will not invent one.
        </p>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2">
        <div className="block text-sm">
          <Combobox
            label="Event"
            value={plan.intent.eventId}
            onChange={(eventId) => patchIntent({ eventId })}
            options={pickerOptions}
            placeholder="Select an event"
            emptyText="No matching events"
          />
          <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={showPastEvents}
              onChange={(e) => setShowPastEvents(e.target.checked)}
            />
            Show past events
          </label>
        </div>
        <label className="block text-sm">
          <span className="text-muted-foreground">Plan name</span>
          <input
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
            value={plan.name ?? ""}
            onChange={(e) =>
              markPlan((current) => ({ ...current, name: e.target.value || null }))
            }
          />
        </label>
        <label className="block text-sm">
          <span className="text-muted-foreground">Objective intent</span>
          <select
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
            value={plan.intent.objectiveIntent}
            onChange={(e) =>
              patchIntent({
                objectiveIntent: e.target.value as CampaignPlanObjectiveIntent,
              })
            }
          >
            {PLAN_OBJECTIVE_OPTIONS.map((objective) => (
              <option key={objective} value={objective}>
                {objective}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-muted-foreground">Destination URL</span>
          <input
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
            placeholder="https://"
            value={plan.intent.destinationUrl}
            onChange={(e) => patchIntent({ destinationUrl: e.target.value })}
          />
        </label>
        <div className="grid grid-cols-3 gap-2 text-sm">
          {(["metaDaily", "tiktokDaily", "googleDaily"] as const).map((key) => (
            <label key={key} className="block">
              <span className="text-muted-foreground">{key.replace("Daily", "")} £/day</span>
              <input
                type="number"
                min={0}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
                value={plan.intent.budget[key]}
                onChange={(e) => {
                  const value = Number(e.target.value) || 0;
                  const budget = { ...plan.intent.budget, [key]: value };
                  budget.totalDaily =
                    budget.metaDaily + budget.tiktokDaily + budget.googleDaily;
                  patchIntent({ budget });
                }}
              />
            </label>
          ))}
        </div>
        <PlanDateTimeField
          label="Start"
          date={plan.intent.startDate}
          time={plan.intent.startTime}
          onChange={({ date, time }) => patchIntent({ startDate: date, startTime: time })}
        />
        <PlanDateTimeField
          label="End"
          date={plan.intent.endDate}
          time={plan.intent.endTime}
          onChange={({ date, time }) => patchIntent({ endDate: date, endTime: time })}
        />
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="font-heading text-lg tracking-wide">
            Step 1 — Build the Meta campaign
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Meta is the authoring surface. Artist pages, similar-page groups, custom
            audiences and lookalikes are built in the full Meta wizard; TikTok and
            Google then derive their targeting vocabulary from it.
          </p>
        </div>
        <PlatformCard
          adapter="meta"
          heading="Meta"
          preview={previews?.meta}
          issues={issues}
          draftId={plan.launches.meta.draftId}
          prepareLabel="New from plan"
          fromExistingLabel="From existing campaign…"
          busy={preparing != null || deriving != null}
          disabled={!plan.intent.eventId}
          note={notes.meta}
          warning={WIZARD_ACTIVE_VS_PLAN_PAUSED}
          onPrepare={() => void prepareDraft("meta")}
          onPrepareFromExisting={() => setLibraryOpen(true)}
        />
        {metaFallbackHint ? (
          <p className="text-xs text-muted-foreground">{metaFallbackHint}</p>
        ) : null}
        {plan.launches.meta.draftId ? (
          <p className="text-xs text-muted-foreground">
            <Link
              href={`/campaign/${plan.launches.meta.draftId}`}
              className="underline underline-offset-2"
            >
              Automation decisions
            </Link>
            {" "}live on the linked Meta campaign — the same Optimisation
            Strategy shadows TikTok and Google. No separate rules editor here.
          </p>
        ) : null}
      </section>

      <AssetRoutingMatrix planId={plan.id} hasMetaDraft={hasMetaDraft} />

      <section id={PLAN_STEP2_HASH} className="space-y-3">
        <div>
          <h2 className="font-heading text-lg tracking-wide">
            Step 2 — Derive TikTok and Google from Meta
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {hasMetaDraft
              ? "Preparing a draft runs derivation automatically. Re-derive after Meta edits — terms you changed in the TikTok or Google wizard are never overwritten."
              : "Locked until a Meta draft exists — there is no targeting vocabulary to derive from yet."}
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {(["tiktok", "google"] as const).map((adapter) => (
            <PlatformCard
              key={adapter}
              adapter={adapter}
              heading={adapter === "tiktok" ? "TikTok" : "Google Search"}
              preview={previews?.[adapter]}
              issues={issues}
              draftId={plan.launches[adapter].draftId}
              prepareLabel={
                adapter === "tiktok" ? "Prepare TikTok draft" : "Prepare Google plan"
              }
              busy={preparing != null || deriving != null}
              disabled={!plan.intent.eventId || !hasMetaDraft}
              disabledReason={hasMetaDraft ? null : GOOGLE_PREPARE_REASON}
              note={notes[adapter]}
              warning={adapter === "google" ? GOOGLE_DATE_ONLY_NOTE : undefined}
              staleChip={staleChips[adapter]}
              onPrepare={() => void prepareDraft(adapter)}
              onRederive={hasMetaDraft ? () => void rederive(adapter) : undefined}
            />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <Button
          type="button"
          disabled={launchDisabledReason != null}
          onClick={() => void launchAll()}
        >
          Launch all (paused)
        </Button>
        {launchDisabledReason ? (
          <p className="text-sm text-muted-foreground">{launchDisabledReason}</p>
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </section>

      <section>
        <h2 className="font-heading text-lg tracking-wide">Launch status</h2>
        {launchIdle ? (
          <p className="mt-2 text-sm text-muted-foreground">Nothing prepared yet.</p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {(["meta", "tiktok", "google"] as const).map((adapter) => {
              const record = plan.launches[adapter];
              const link = links.find((item) => item.adapter === adapter);
              return (
                <li key={adapter} className="rounded-md border border-border px-3 py-2">
                  <span className="font-medium capitalize">{adapter}</span>
                  {": "}
                  {record.status}
                  {record.error ? ` — ${record.error}` : ""}
                  {link?.href ? (
                    <>
                      {" · "}
                      <a
                        href={link.href}
                        className="underline"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open in Ads Manager
                      </a>
                    </>
                  ) : (
                    <span className="text-muted-foreground">
                      {" · "}
                      {link?.unavailableReason}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <CampaignLibraryPicker
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        busy={preparing === "meta"}
        onPick={(pick) => void prepareDraft("meta", pick)}
      />

      <p className="text-xs text-muted-foreground">
        <Link href="/plans" className="underline">
          Back to plans
        </Link>
        . {persistState}.{" "}
        <PlanDeleteAction planId={plan.id} launches={plan.launches} persisted={persisted} />
      </p>
    </div>
  );
}
