"use client";

import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  ArrowDownToLine,
  ExternalLink,
  FileDown,
  FilePlus2,
  Loader2,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/dashboard/_shared/status-pill";
import { fmtCurrency, fmtDate } from "@/lib/dashboard/format";
import type { AdPlan, AdPlanPatch } from "@/lib/db/ad-plans";

const DEBOUNCE_MS = 500;

const MONEY_INPUT_RE = /^\d*\.?\d{0,2}$/;
const INTEGER_INPUT_RE = /^\d*$/;

/**
 * Header strip for a marketing plan.
 *
 * Owns:
 *  - local UI state for the "Even spread" suggestion (idle → confirming
 *    → working) but delegates the actual bulk write to the parent via
 *    onApplyEvenSpread, since the parent owns the days mirror + the grid
 *    ref needed to flush pending per-cell saves first.
 *  - debounced inline edit of total_budget, ticket_target, landing_page_url.
 *    Local string state is the canonical UI value; we only reseed from
 *    the prop when no pending timer is in flight for that field, so a
 *    keystroke is never stomped by the persisted echo.
 */
export function PlanHeader({
  plan,
  daysCount,
  eventBudget,
  onApplyEvenSpread,
  onPatch,
}: {
  plan: AdPlan;
  daysCount: number;
  /**
   * The parent event's marketing budget. Used by the "Pull budget from
   * event" affordance shown when the plan has no budget but the event
   * does — covers plans created before auto-populate was introduced.
   */
  eventBudget: number | null;
  /** Resolves once the bulk save (and any quiesce wait) has settled. */
  onApplyEvenSpread: () => Promise<void>;
  /** Called by the inline-edit fields. Parent persists via updatePlan. */
  onPatch: (patch: AdPlanPatch) => Promise<void>;
}) {
  const [phase, setPhase] = useState<"idle" | "confirming" | "working">("idle");
  const [pulling, setPulling] = useState(false);

  const hasBudget = plan.total_budget != null && plan.total_budget > 0;
  const hasDays = daysCount > 0;
  const canSuggest = hasBudget && hasDays;
  // Surface the pull affordance only when the plan actually lacks a
  // budget AND the event has one to copy. Both prerequisites required.
  const canPullBudget =
    plan.total_budget == null && eventBudget != null && eventBudget > 0;

  const suggestTitle = !hasBudget
    ? "Set a total budget first"
    : !hasDays
      ? "No days to populate"
      : undefined;

  const handlePullBudget = async () => {
    if (!canPullBudget || pulling) return;
    setPulling(true);
    try {
      await onPatch({ total_budget: eventBudget });
    } finally {
      setPulling(false);
    }
  };

  const handleApply = async () => {
    setPhase("working");
    try {
      await onApplyEvenSpread();
      setPhase("idle");
    } catch {
      // Parent surfaces the error banner; just return to idle.
      setPhase("idle");
    }
  };

  return (
    <section className="rounded-md border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-2">
            <h2 className="font-heading text-lg tracking-wide truncate">
              {plan.name}
            </h2>
            <StatusPill status={plan.status} kind="plan" />
          </div>
          <p className="text-xs text-muted-foreground">
            {fmtDate(plan.start_date)} → {fmtDate(plan.end_date)}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {canPullBudget && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handlePullBudget}
              disabled={pulling}
              title="Copy the event's marketing budget into this plan"
            >
              {pulling ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ArrowDownToLine className="h-3.5 w-3.5" />
              )}
              Pull budget from event ({fmtCurrency(eventBudget!)})
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setPhase("confirming")}
            disabled={!canSuggest || phase !== "idle"}
            title={suggestTitle}
          >
            <Wand2 className="h-3.5 w-3.5" />
            Suggest: even spread
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled
            title="Coming soon"
          >
            <FileDown className="h-3.5 w-3.5" />
            Open template
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled
            title="Coming soon"
          >
            <FilePlus2 className="h-3.5 w-3.5" />
            Save as template
          </Button>
        </div>
      </div>

      {phase !== "idle" && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2 text-xs">
          <span className="min-w-0 flex-1 text-muted-foreground">
            This will overwrite Conversion values on all{" "}
            <span className="font-medium text-foreground">{daysCount}</span>{" "}
            day{daysCount === 1 ? "" : "s"}. Continue?
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setPhase("idle")}
              disabled={phase === "working"}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleApply}
              disabled={phase === "working"}
            >
              {phase === "working" && (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              )}
              Apply
            </Button>
          </div>
        </div>
      )}

      <dl className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-3 text-sm">
        <NumericField
          label="Total budget"
          prefix="£"
          value={plan.total_budget}
          inputRe={MONEY_INPUT_RE}
          onCommit={(n) => onPatch({ total_budget: n })}
        />
        <NumericField
          label="Ticket target"
          value={plan.ticket_target}
          inputRe={INTEGER_INPUT_RE}
          onCommit={(n) => onPatch({ ticket_target: n })}
        />
        <UrlField
          label="Landing page"
          value={plan.landing_page_url}
          onCommit={(v) => onPatch({ landing_page_url: v })}
        />
      </dl>
    </section>
  );
}

// ─── Inline edit fields ─────────────────────────────────────────────────────

/**
 * Shared debounced-commit hook. Keeps a local string mirror of the
 * persisted value; reseeds from prop only when no pending edit is in
 * flight (so a keystroke isn't stomped by the persisted echo).
 *
 * Backed by useReducer (not useState) so the in-effect reseed below
 * sidesteps react-hooks/set-state-in-effect — same idiom the grid uses
 * for its days mirror.
 *
 * Returns the current draft string + a setter + a force-flush blur
 * handler. Callers parse + validate the string and decide what to send
 * via onCommit.
 */
function useDebouncedDraft<T>(
  persisted: T,
  serialise: (v: T) => string,
  commit: (raw: string) => void | Promise<void>,
) {
  const [draft, setDraft] = useReducer(
    (prev: string, next: string | ((p: string) => string)) =>
      typeof next === "function" ? next(prev) : next,
    "",
    () => serialise(persisted),
  );
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);
  const lastSeenPersistedRef = useRef<T>(persisted);

  // Reseed from prop only when (a) the prop's persisted value actually
  // changed since we last saw it, AND (b) we don't have an in-flight
  // edit. The first guard prevents a parent re-render that didn't
  // touch this field from clobbering local state; the second prevents
  // the persisted echo from a previous commit racing with new typing.
  useEffect(() => {
    if (
      persisted !== lastSeenPersistedRef.current &&
      !dirtyRef.current
    ) {
      setDraft(serialise(persisted));
    }
    lastSeenPersistedRef.current = persisted;
  }, [persisted, serialise]);

  // Cleanup pending timer on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const onChange = useCallback(
    (next: string) => {
      setDraft(next);
      dirtyRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        dirtyRef.current = false;
        void commit(next);
      }, DEBOUNCE_MS);
    },
    [commit],
  );

  const onBlur = useCallback(() => {
    if (!timerRef.current) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
    dirtyRef.current = false;
    void commit(draft);
  }, [commit, draft]);

  return { draft, onChange, onBlur };
}

function NumericField({
  label,
  prefix,
  value,
  inputRe,
  onCommit,
}: {
  label: string;
  prefix?: string;
  value: number | null;
  inputRe: RegExp;
  onCommit: (n: number | null) => Promise<void> | void;
}) {
  const serialise = useCallback(
    (v: number | null) => (v == null ? "" : String(v)),
    [],
  );

  const commitRaw = useCallback(
    (raw: string) => {
      const trimmed = raw.trim();
      if (trimmed === "") return onCommit(null);
      const n = Number(trimmed);
      if (!Number.isFinite(n) || n < 0) return;
      void onCommit(n);
    },
    [onCommit],
  );

  const { draft, onChange, onBlur } = useDebouncedDraft<number | null>(
    value,
    serialise,
    commitRaw,
  );

  return (
    <Field label={label}>
      <div className="flex items-center gap-1">
        {prefix && (
          <span className="text-muted-foreground">{prefix}</span>
        )}
        <input
          type="text"
          inputMode="decimal"
          value={draft}
          placeholder="—"
          onChange={(e) => {
            const next = e.target.value;
            // Silently drop invalid keystrokes — same UX as the grid cells.
            if (next !== "" && !inputRe.test(next)) return;
            onChange(next);
          }}
          onBlur={onBlur}
          className="w-full min-w-0 rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-sm outline-none hover:border-border focus:border-foreground focus:bg-background"
        />
      </div>
    </Field>
  );
}

function UrlField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string | null;
  onCommit: (v: string | null) => Promise<void> | void;
}) {
  const serialise = useCallback((v: string | null) => v ?? "", []);

  const commitRaw = useCallback(
    (raw: string) => {
      const trimmed = raw.trim();
      void onCommit(trimmed === "" ? null : trimmed);
    },
    [onCommit],
  );

  const { draft, onChange, onBlur } = useDebouncedDraft<string | null>(
    value,
    serialise,
    commitRaw,
  );

  return (
    <Field label={label}>
      <div className="flex min-w-0 items-center gap-1">
        <input
          type="url"
          value={draft}
          placeholder="https://…"
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          className="w-full min-w-0 rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-sm outline-none hover:border-border focus:border-foreground focus:bg-background"
        />
        {value && (
          <a
            href={value}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-muted-foreground hover:text-foreground"
            title="Open in new tab"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    </Field>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 min-w-0 break-words">{children}</dd>
    </div>
  );
}
