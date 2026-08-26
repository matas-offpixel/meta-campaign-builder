"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Combobox } from "@/components/ui/combobox";
import { Button } from "@/components/ui/button";
import { CLUSTER_LABELS } from "@/lib/interest-suggestions";
import { planAdsManagerLinks } from "@/lib/plan/ads-manager-links";
import { PLAN_OBJECTIVE_OPTIONS } from "@/lib/plan/empty-plan";
import {
  planEventPickerRows,
  todayIsoDate,
  visiblePlanEvents,
  type PlanEventOption,
} from "@/lib/plan/event-picker";
import { GOOGLE_PREPARE_REASON, wizardHrefForDraft } from "@/lib/plan/prepare-draft";
import type { PlanPreflightIssue } from "@/lib/plan/preflight";
import type { CampaignPlan, CampaignPlanObjectiveIntent, PlanAdapterName } from "@/lib/plan/types";

export type { PlanEventOption };

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
}: {
  initialPlan: CampaignPlan;
  events: PlanEventOption[];
  tiktokAdvertiserId?: string | null;
}) {
  const [plan, setPlan] = useState(initialPlan);
  const [gate, setGate] = useState<GateState | null>(null);
  const [issues, setIssues] = useState<PlanPreflightIssue[]>([]);
  const [previews, setPreviews] = useState<Record<"meta" | "tiktok" | "google", Preview> | null>(
    null,
  );
  const [preflightOk, setPreflightOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [persistState, setPersistState] = useState<string>("Not saved yet");
  const [preparing, setPreparing] = useState<PlanAdapterName | null>(null);
  const [showPastEvents, setShowPastEvents] = useState(false);
  const router = useRouter();

  function patchIntent(patch: Partial<CampaignPlan["intent"]>) {
    setPlan((current) => ({
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

  useEffect(() => {
    if (!plan.intent.eventId) return;
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
  }, [plan, router]);

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

  async function prepareDraft(adapter: PlanAdapterName) {
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
      const res = await fetch(`/api/plan/${encodeURIComponent(plan.id)}/prepare-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adapter,
          clientId: selectedEvent?.clientId ?? null,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        draftId?: string;
        launches?: CampaignPlan["launches"];
      };
      if (!res.ok || !json.ok || !json.launches) {
        setError(json.error ?? "Could not prepare draft");
        return;
      }
      setPlan((current) => ({ ...current, launches: json.launches! }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not prepare draft");
    } finally {
      setPreparing(null);
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

  return (
    <div className="space-y-8">
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
              setPlan((current) => ({ ...current, name: e.target.value || null }))
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
        <label className="block text-sm">
          <span className="text-muted-foreground">Audience cluster</span>
          <select
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
            value={plan.intent.audienceClusterRef ?? ""}
            onChange={(e) =>
              patchIntent({ audienceClusterRef: e.target.value || null })
            }
          >
            <option value="">None</option>
            {CLUSTER_LABELS.map((cluster) => (
              <option key={cluster} value={cluster}>
                {cluster}
              </option>
            ))}
          </select>
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
        <label className="block text-sm">
          <span className="text-muted-foreground">Start date</span>
          <input
            type="date"
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
            value={plan.intent.startDate ?? ""}
            onChange={(e) => patchIntent({ startDate: e.target.value || null })}
          />
        </label>
        <label className="block text-sm">
          <span className="text-muted-foreground">End date</span>
          <input
            type="date"
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
            value={plan.intent.endDate ?? ""}
            onChange={(e) => patchIntent({ endDate: e.target.value || null })}
          />
        </label>
      </section>

      <section>
        <h2 className="font-heading text-lg tracking-wide">Adapter previews</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {(["meta", "tiktok", "google"] as const).map((adapter) => {
            const preview = previews?.[adapter];
            return (
              <article
                key={adapter}
                className="rounded-lg border border-border bg-card p-4 text-sm shadow-sm"
              >
                <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  {adapter}
                </p>
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
                ) : (
                  <p className="mt-2 text-muted-foreground">Preview not ready yet.</p>
                )}
                <ul className="mt-3 space-y-1 text-xs">
                  {issues
                    .filter((issue) => issue.adapter === adapter)
                    .map((issue) => (
                      <li
                        key={issue.id}
                        className={issue.blocking ? "text-destructive" : "text-muted-foreground"}
                      >
                        {issue.blocking ? "Blocker: " : ""}
                        {issue.message}
                      </li>
                    ))}
                </ul>
                {adapter === "google" ? (
                  <p className="mt-3 text-xs text-muted-foreground">{GOOGLE_PREPARE_REASON}</p>
                ) : plan.launches[adapter].draftId ? (
                  <p className="mt-3 text-xs">
                    Draft ready.{" "}
                    <Link
                      href={wizardHrefForDraft(adapter, plan.launches[adapter].draftId!) ?? "#"}
                      className="underline"
                    >
                      Complete in wizard
                    </Link>
                  </p>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    className="mt-3"
                    disabled={preparing != null || !plan.intent.eventId}
                    onClick={() => void prepareDraft(adapter)}
                  >
                    {adapter === "meta" ? "Prepare Meta draft" : "Prepare TikTok draft"}
                  </Button>
                )}
              </article>
            );
          })}
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
      </section>

      <p className="text-xs text-muted-foreground">
        <Link href="/plans" className="underline">
          Back to plans
        </Link>
        . {persistState}.
      </p>
    </div>
  );
}
