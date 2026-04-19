"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useReducer,
  useRef,
} from "react";
import { fmtCurrency, fmtDay } from "@/lib/dashboard/format";
import {
  OBJECTIVE_KEYS,
  OBJECTIVE_LABEL,
  readObjectiveBudget,
  writeObjectiveBudget,
  type ObjectiveBudgets,
  type ObjectiveKey,
} from "@/lib/dashboard/objectives";
import type {
  AdPlan,
  AdPlanDay,
  AdPlanDayBulkPatch,
  AdPlanDayPatch,
} from "@/lib/db/ad-plans";

// ─────────────────────────────────────────────────────────────────────────────
// Column model
//
// Two orthogonal axes:
//   - role: "editable" | "computed". Editable columns participate in the
//     edit / paste / fill / clear paths. Computed columns are derived from
//     the days array (and their own index in it), are read-only, and are
//     visually distinguishable. Both roles participate in selection + copy.
//   - kind (editable only): the input/display sub-type used to pick an
//     input regex, format the cell, and decide whether the footer's
//     numeric stats include it. "readonly" preserves the Day column —
//     non-editable but not derived.
//
// Centralising this keeps the reducer + paste + fill logic agnostic of
// column identity: every callsite that used to ask `col.kind === "readonly"`
// now asks `canEdit(col)` instead, and only ever calls applyString /
// inputRegexFor on a narrowed EditableColumn.
// ─────────────────────────────────────────────────────────────────────────────

type EditableKind = "readonly" | "text" | "percent" | "money" | "integer";

interface EditableColumn {
  role: "editable";
  key: string;
  label: string;
  kind: EditableKind;
  /** TSV-safe string. Numeric → e.g. "150" or "1.5"; text → as-is. */
  readRaw: (day: AdPlanDay) => string;
  /** Display string for the cell (£ prefix, %, etc). */
  readDisplay: (day: AdPlanDay) => string;
  /** Build a patch from a string input. Returns null for invalid input. */
  applyString: (day: AdPlanDay, raw: string) => AdPlanDayPatch | null;
}

interface ComputedColumn {
  role: "computed";
  key: string;
  label: string;
  /** Numeric value used for arithmetic + the TSV serialisation below. */
  compute: (day: AdPlanDay, index: number, allDays: AdPlanDay[]) => number;
  /** TSV-safe string — numeric, no currency prefix. */
  readRaw: (day: AdPlanDay, index: number, allDays: AdPlanDay[]) => string;
  /** Display string — currency-formatted via fmtCurrency. */
  readDisplay: (day: AdPlanDay, index: number, allDays: AdPlanDay[]) => string;
}

type PlanColumn = EditableColumn | ComputedColumn;

/**
 * True if the column accepts user input (excludes both computed columns
 * and the editable+readonly Day column). Single source of truth for
 * every "skip this column when editing / pasting / clearing" branch.
 */
function canEdit(col: PlanColumn): col is EditableColumn & {
  kind: Exclude<EditableKind, "readonly">;
} {
  return col.role === "editable" && col.kind !== "readonly";
}

const NUMERIC_PARTIAL_RE = /^\d*\.?\d{0,2}$/;
const INTEGER_PARTIAL_RE = /^\d*$/;

function parseNumber(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function parseInteger(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.trunc(n);
}

function makeMoneyColumn(label: string, key: ObjectiveKey): EditableColumn {
  return {
    role: "editable",
    key: `obj:${key}`,
    label,
    kind: "money",
    readRaw: (day) => {
      const v = readObjectiveBudget(day.objective_budgets, key);
      return v === 0 ? "" : String(v);
    },
    readDisplay: (day) => {
      const v = readObjectiveBudget(day.objective_budgets, key);
      return v === 0 ? "" : `£${v.toLocaleString()}`;
    },
    applyString: (day, raw) => {
      if (raw.trim() === "") {
        return {
          objective_budgets: writeObjectiveBudget(
            day.objective_budgets,
            key,
            0,
          ),
        };
      }
      const n = parseNumber(raw);
      if (n == null) return null;
      return {
        objective_budgets: writeObjectiveBudget(
          day.objective_budgets,
          key,
          n,
        ),
      };
    },
  };
}

/** Sum every objective bucket on a single day. */
function sumObjectiveBudgets(day: AdPlanDay): number {
  let total = 0;
  for (const k of OBJECTIVE_KEYS) {
    total += readObjectiveBudget(day.objective_budgets, k);
  }
  return total;
}

/** Cumulative spend from day index 0 through `index` inclusive. */
function cumulativeSpend(allDays: AdPlanDay[], index: number): number {
  let total = 0;
  for (let i = 0; i <= index; i += 1) {
    const r = allDays[i];
    if (!r) continue;
    total += sumObjectiveBudgets(r);
  }
  return total;
}

const COLUMNS: PlanColumn[] = [
  {
    role: "editable",
    key: "day",
    label: "Day",
    kind: "readonly",
    readRaw: (day) => day.day,
    readDisplay: (day) => fmtDay(new Date(day.day + "T00:00:00")),
    applyString: () => null,
  },
  {
    role: "editable",
    key: "phase_marker",
    label: "Phase",
    kind: "text",
    readRaw: (day) => day.phase_marker ?? "",
    readDisplay: (day) => day.phase_marker ?? "",
    applyString: (_day, raw) => ({
      phase_marker: raw.trim() === "" ? null : raw.trim(),
    }),
  },
  {
    role: "editable",
    key: "allocation_pct",
    label: "Alloc %",
    kind: "percent",
    readRaw: (day) =>
      day.allocation_pct == null ? "" : String(day.allocation_pct),
    readDisplay: (day) =>
      day.allocation_pct == null ? "" : `${day.allocation_pct}%`,
    applyString: (_day, raw) => {
      if (raw.trim() === "") return { allocation_pct: null };
      const n = parseNumber(raw);
      if (n == null || n > 100) return null;
      return { allocation_pct: n };
    },
  },
  makeMoneyColumn("Traffic", "traffic"),
  makeMoneyColumn("Conversion", "conversion"),
  makeMoneyColumn("Reach", "reach"),
  makeMoneyColumn(OBJECTIVE_LABEL.post_engagement, "post_engagement"),
  makeMoneyColumn("TikTok", "tiktok"),
  makeMoneyColumn("Google", "google"),
  makeMoneyColumn("Snap", "snap"),
  {
    role: "computed",
    key: "daily_spend",
    label: "Daily spend",
    compute: (day) => sumObjectiveBudgets(day),
    readRaw: (day) => String(sumObjectiveBudgets(day)),
    readDisplay: (day) => fmtCurrency(sumObjectiveBudgets(day)),
  },
  {
    role: "computed",
    key: "total_spend",
    label: "Total spend",
    compute: (_day, idx, all) => cumulativeSpend(all, idx),
    readRaw: (_day, idx, all) => String(cumulativeSpend(all, idx)),
    readDisplay: (_day, idx, all) => fmtCurrency(cumulativeSpend(all, idx)),
  },
  {
    role: "editable",
    key: "tickets_sold",
    label: "Tickets sold",
    kind: "integer",
    readRaw: (day) =>
      day.tickets_sold_cumulative == null
        ? ""
        : String(day.tickets_sold_cumulative),
    readDisplay: (day) =>
      day.tickets_sold_cumulative == null
        ? ""
        : day.tickets_sold_cumulative.toLocaleString(),
    applyString: (_day, raw) => {
      if (raw.trim() === "") return { tickets_sold_cumulative: null };
      const n = parseInteger(raw);
      if (n == null) return null;
      return { tickets_sold_cumulative: n };
    },
  },
  {
    role: "editable",
    key: "notes",
    label: "Notes",
    kind: "text",
    readRaw: (day) => day.notes ?? "",
    readDisplay: (day) => day.notes ?? "",
    applyString: (_day, raw) => ({ notes: raw === "" ? null : raw }),
  },
];

const NUMERIC_KINDS: ReadonlySet<EditableKind> = new Set([
  "money",
  "percent",
  "integer",
]);

/**
 * True if the column contributes to the footer's sum/avg/count strip.
 * Computed columns are derived from money columns already in the
 * selection — including them would double-count.
 */
function isNumericColumn(col: PlanColumn): boolean {
  return col.role === "editable" && NUMERIC_KINDS.has(col.kind);
}

function inputRegexFor(kind: EditableKind): RegExp {
  return kind === "integer" ? INTEGER_PARTIAL_RE : NUMERIC_PARTIAL_RE;
}

/** Adapter: TSV serialisation needs (day, idx, all) for computed columns
 *  and (day) for editable. Centralised so callers stay simple. */
function readRawAt(
  col: PlanColumn,
  rows: AdPlanDay[],
  idx: number,
): string {
  const day = rows[idx];
  if (!day) return "";
  return col.role === "computed" ? col.readRaw(day, idx, rows) : col.readRaw(day);
}

// ─── Selection state / reducer ───────────────────────────────────────────────

type Cell = { row: number; col: number };

type Mode =
  | { kind: "idle" }
  | { kind: "selecting" }
  | { kind: "filling"; toRow: number };

interface State {
  anchor: Cell;
  focus: Cell;
  mode: Mode;
  editing: Cell | null;
  editValue: string;
}

type Action =
  | { type: "SELECT_CELL"; cell: Cell }
  | { type: "EXTEND_TO"; cell: Cell }
  | { type: "BEGIN_SELECT_DRAG" }
  | { type: "BEGIN_FILL" }
  | { type: "EXTEND_FILL"; row: number }
  | { type: "RESET_MODE" }
  | { type: "MOVE_FOCUS"; dRow: number; dCol: number; extend: boolean }
  | { type: "BEGIN_EDIT"; seed: string }
  | { type: "SET_EDIT_VALUE"; value: string }
  | { type: "CANCEL_EDIT" }
  | { type: "COMMIT_EDIT" };

const FIRST_EDITABLE_COL = COLUMNS.findIndex(canEdit);

const INITIAL_STATE: State = {
  anchor: { row: 0, col: FIRST_EDITABLE_COL },
  focus: { row: 0, col: FIRST_EDITABLE_COL },
  mode: { kind: "idle" },
  editing: null,
  editValue: "",
};

function clampCell(cell: Cell, rows: number): Cell {
  return {
    row: Math.max(0, Math.min(rows - 1, cell.row)),
    col: Math.max(0, Math.min(COLUMNS.length - 1, cell.col)),
  };
}

function reducer(rowCount: number) {
  return function step(s: State, a: Action): State {
    switch (a.type) {
      case "SELECT_CELL": {
        const c = clampCell(a.cell, rowCount);
        return {
          ...s,
          anchor: c,
          focus: c,
          editing: null,
          editValue: "",
          mode: { kind: "idle" },
        };
      }
      case "EXTEND_TO": {
        const c = clampCell(a.cell, rowCount);
        return { ...s, focus: c, editing: null };
      }
      case "BEGIN_SELECT_DRAG":
        return { ...s, mode: { kind: "selecting" } };
      case "BEGIN_FILL": {
        const maxRow = Math.max(s.anchor.row, s.focus.row);
        return { ...s, mode: { kind: "filling", toRow: maxRow } };
      }
      case "EXTEND_FILL": {
        if (s.mode.kind !== "filling") return s;
        const maxRow = Math.max(s.anchor.row, s.focus.row);
        const next = Math.max(maxRow, Math.min(rowCount - 1, a.row));
        return { ...s, mode: { kind: "filling", toRow: next } };
      }
      case "RESET_MODE":
        return { ...s, mode: { kind: "idle" } };
      case "MOVE_FOCUS": {
        const next = clampCell(
          { row: s.focus.row + a.dRow, col: s.focus.col + a.dCol },
          rowCount,
        );
        return {
          ...s,
          focus: next,
          anchor: a.extend ? s.anchor : next,
          editing: null,
          editValue: "",
        };
      }
      case "BEGIN_EDIT":
        return { ...s, editing: s.focus, editValue: a.seed };
      case "SET_EDIT_VALUE":
        return { ...s, editValue: a.value };
      case "CANCEL_EDIT":
        return { ...s, editing: null, editValue: "" };
      case "COMMIT_EDIT":
        // Side effect handled by the dispatcher caller; reducer just exits edit.
        return { ...s, editing: null, editValue: "" };
      default:
        return s;
    }
  };
}

function selectionBounds(s: State) {
  return {
    minRow: Math.min(s.anchor.row, s.focus.row),
    maxRow: Math.max(s.anchor.row, s.focus.row),
    minCol: Math.min(s.anchor.col, s.focus.col),
    maxCol: Math.max(s.anchor.col, s.focus.col),
  };
}

function isAnchor(s: State, row: number, col: number): boolean {
  return s.anchor.row === row && s.anchor.col === col;
}

function isFocus(s: State, row: number, col: number): boolean {
  return s.focus.row === row && s.focus.col === col;
}

function isInSelection(s: State, row: number, col: number): boolean {
  const b = selectionBounds(s);
  return row >= b.minRow && row <= b.maxRow && col >= b.minCol && col <= b.maxCol;
}

function isInFillPreview(s: State, row: number, col: number): boolean {
  if (s.mode.kind !== "filling") return false;
  const b = selectionBounds(s);
  return row > b.maxRow && row <= s.mode.toRow && col >= b.minCol && col <= b.maxCol;
}

// ─── Component ───────────────────────────────────────────────────────────────

export interface PlanDailyGridProps {
  plan: AdPlan;
  days: AdPlanDay[];
  /** Replace one day's row in the parent's local mirror (after a successful save). */
  onDaySaved: (day: AdPlanDay) => void;
  /** Surface a save error to the parent's banner. */
  onError: (msg: string) => void;
  /** Save a single day patch. Caller resolves with the persisted row. */
  saveDay: (dayId: string, patch: AdPlanDayPatch) => Promise<AdPlanDay>;
  /** Bulk save many days at once. Caller resolves with all persisted rows. */
  saveDaysBulk: (patches: AdPlanDayBulkPatch[]) => Promise<AdPlanDay[]>;
}

/**
 * Imperative handle exposed via `ref`. Lets parents quiesce the grid's
 * local debounce + queue state before firing their own bulk writes
 * (e.g. the "Even spread" suggestion in the plan header). Without this
 * a per-cell debounce that's pending when the parent's bulk fires can
 * win the race and overwrite the parent's values 300ms later.
 */
export interface PlanGridHandle {
  /**
   * Resolves once every pending per-cell save has either flushed or been
   * queued + drained behind any in-flight bulk. Safe to call repeatedly.
   */
  flushPendingSaves: () => Promise<void>;
}

export const PlanDailyGrid = forwardRef<PlanGridHandle, PlanDailyGridProps>(
  function PlanDailyGrid(
    { days, onDaySaved, onError, saveDay, saveDaysBulk }: PlanDailyGridProps,
    ref,
  ) {
  // Local optimistic mirror. Cells render from this in preference to the
  // upstream `days` prop. On successful save we also call onDaySaved so
  // the parent's mirror catches up — keeps the two in sync after a
  // router.refresh() or external reload.
  const [localMap, setLocalMap] = useReducer(
    (
      prev: Map<string, AdPlanDay>,
      next: Map<string, AdPlanDay> | ((p: Map<string, AdPlanDay>) => Map<string, AdPlanDay>),
    ) => (typeof next === "function" ? next(prev) : next),
    new Map<string, AdPlanDay>(),
  );

  // Re-seed the local mirror whenever the parent re-passes days.
  //
  // Newer-updated_at wins. The local mirror holds optimistic edits the
  // parent may not have seen yet, but the parent can also push fresher
  // values from outside the grid (e.g. an "Even spread" bulk write or
  // a router.refresh() after a server-side change). Whichever side has
  // the strictly greater updated_at takes precedence; ties keep the
  // local value so an in-flight optimistic edit isn't clobbered by the
  // unchanged prop snapshot.
  useEffect(() => {
    setLocalMap((prev) => {
      const next = new Map<string, AdPlanDay>();
      for (const d of days) {
        const local = prev.get(d.id);
        if (!local) {
          next.set(d.id, d);
          continue;
        }
        const incomingTs = Date.parse(d.updated_at);
        const localTs = Date.parse(local.updated_at);
        next.set(
          d.id,
          Number.isFinite(incomingTs) && incomingTs > localTs ? d : local,
        );
      }
      return next;
    });
  }, [days]);

  const rows = useMemo(
    () =>
      days.map((d) => localMap.get(d.id) ?? d),
    [days, localMap],
  );
  const rowCount = rows.length;

  const reduce = useMemo(() => reducer(rowCount), [rowCount]);
  const [state, dispatch] = useReducer(reduce, INITIAL_STATE);

  // Refs --------------------------------------------------------------------
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cellRefs = useRef<Map<string, HTMLElement>>(new Map());
  const editInputRef = useRef<HTMLInputElement | null>(null);

  // Debounce + concurrency coordination ------------------------------------
  // pendingTimeouts: per dayId per field. We keep one timeout per dayId
  // (typing in different cells of the same day coalesces — last write wins
  // for that day on the next save). When a bulk write fires we clear any
  // pending timeouts for the affected ids so the bulk values don't get
  // overwritten by a stale per-cell debounce.
  const pendingTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const pendingPatchesRef = useRef<Map<string, AdPlanDayPatch>>(new Map());
  const bulkInFlightRef = useRef(false);
  const queuedAfterBulkRef = useRef<Array<() => Promise<void>>>([]);
  // Stable error reporter — captures the latest onError without forcing
  // every dependent useCallback to re-create on each parent render.
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const reportError = useCallback((msg: string) => {
    onErrorRef.current(msg);
  }, []);

  // Cell registration -------------------------------------------------------
  const cellRefKey = (row: number, col: number) => `${row}:${col}`;
  const registerCell =
    (row: number, col: number) => (el: HTMLElement | null) => {
      const k = cellRefKey(row, col);
      if (el) cellRefs.current.set(k, el);
      else cellRefs.current.delete(k);
    };

  // Auto-scroll focus into view (correction C) -----------------------------
  const scrolledOnce = useRef(false);
  useEffect(() => {
    if (!scrolledOnce.current) {
      scrolledOnce.current = true;
      return;
    }
    const el = cellRefs.current.get(cellRefKey(state.focus.row, state.focus.col));
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [state.focus]);

  // Edit-input focus on transition ----------------------------------------
  useEffect(() => {
    if (state.editing && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [state.editing]);

  // Window mouseup — close selection / commit fill -------------------------
  const stateRef = useRef(state);
  stateRef.current = state;
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  // Save coordination ------------------------------------------------------
  // (defined before mouseup handler since fill calls it)
  const persistPendingForId = useCallback(
    async (dayId: string) => {
      const patch = pendingPatchesRef.current.get(dayId);
      if (!patch) return;
      pendingPatchesRef.current.delete(dayId);
      const run = async () => {
        try {
          const saved = await saveDay(dayId, patch);
          // Replace local mirror with the canonical persisted row so any
          // server-side defaulting (e.g. updated_at) catches up.
          setLocalMap((prev) => {
            const next = new Map(prev);
            next.set(saved.id, saved);
            return next;
          });
          onDaySaved(saved);
        } catch (err) {
          // Revert: drop the optimistic patch by re-reading from the
          // upstream `days` prop.
          const original = days.find((d) => d.id === dayId);
          if (original) {
            setLocalMap((prev) => {
              const next = new Map(prev);
              next.set(dayId, original);
              return next;
            });
          }
          reportError(
            err instanceof Error ? err.message : "Failed to save cell.",
          );
        }
      };
      if (bulkInFlightRef.current) {
        queuedAfterBulkRef.current.push(run);
      } else {
        await run();
      }
    },
    [saveDay, onDaySaved, days, reportError],
  );

  const schedulePerCellSave = useCallback(
    (dayId: string, patch: AdPlanDayPatch) => {
      // Merge with any in-flight patch for this day so multiple cell edits
      // on the same row collapse into one save.
      const existing = pendingPatchesRef.current.get(dayId);
      const merged: AdPlanDayPatch = { ...(existing ?? {}), ...patch };
      // objective_budgets must merge by key, not be overwritten.
      if (
        existing?.objective_budgets &&
        patch.objective_budgets
      ) {
        merged.objective_budgets = {
          ...existing.objective_budgets,
          ...patch.objective_budgets,
        };
      }
      pendingPatchesRef.current.set(dayId, merged);

      // Reset the timeout each keystroke / commit.
      const old = pendingTimeoutsRef.current.get(dayId);
      if (old) clearTimeout(old);
      const t = setTimeout(() => {
        pendingTimeoutsRef.current.delete(dayId);
        void persistPendingForId(dayId);
      }, 300);
      pendingTimeoutsRef.current.set(dayId, t);
    },
    [persistPendingForId],
  );

  // Imperative handle ------------------------------------------------------
  // Exposed so parents (e.g. the "Even spread" suggestion) can quiesce the
  // grid before firing their own bulk write. Without this, a per-cell
  // debounce that's pending when the parent's bulk fires can win the race
  // and overwrite the parent's values 300ms later — trivially reproducible
  // by tabbing out of a cell and immediately clicking Apply.
  useImperativeHandle(
    ref,
    () => ({
      flushPendingSaves: async () => {
        // Snapshot pending ids first so we don't iterate-while-mutating.
        const pendingIds = Array.from(pendingTimeoutsRef.current.keys());
        for (const id of pendingIds) {
          const t = pendingTimeoutsRef.current.get(id);
          if (t) {
            clearTimeout(t);
            pendingTimeoutsRef.current.delete(id);
          }
        }
        // Convert each pending debounce into an immediate save. If a bulk
        // is currently in flight, persistPendingForId queues the per-cell
        // save into queuedAfterBulkRef and returns immediately — so we
        // also wait below for any in-flight bulk to drain.
        await Promise.all(pendingIds.map((id) => persistPendingForId(id)));
        // Wait for any in-flight bulk + its drained queue. runBulk's
        // finally{} flips bulkInFlightRef back to false only after the
        // queue has fully sequentially drained, so this loop exit point
        // is the all-quiet signal.
        while (bulkInFlightRef.current) {
          await new Promise((r) => setTimeout(r, 50));
        }
      },
    }),
    [persistPendingForId],
  );

  // Bulk save (paste / fill) — clears affected per-cell timeouts first
  // (correction A) and queues per-cell saves that fire mid-flight.
  const runBulk = useCallback(
    async (patches: AdPlanDayBulkPatch[]) => {
      if (patches.length === 0) return;
      // Clear pending per-cell timeouts for affected ids so a stale 300ms
      // debounce doesn't overwrite the bulk values.
      for (const p of patches) {
        const t = pendingTimeoutsRef.current.get(p.id);
        if (t) {
          clearTimeout(t);
          pendingTimeoutsRef.current.delete(p.id);
        }
        pendingPatchesRef.current.delete(p.id);
      }
      bulkInFlightRef.current = true;
      try {
        const saved = await saveDaysBulk(patches);
        setLocalMap((prev) => {
          const next = new Map(prev);
          for (const row of saved) next.set(row.id, row);
          return next;
        });
        for (const row of saved) onDaySaved(row);
      } catch (err) {
        // Revert all affected ids to the upstream prop value.
        setLocalMap((prev) => {
          const next = new Map(prev);
          for (const p of patches) {
            const original = days.find((d) => d.id === p.id);
            if (original) next.set(p.id, original);
          }
          return next;
        });
        reportError(
          err instanceof Error ? err.message : "Failed to save range.",
        );
      } finally {
        bulkInFlightRef.current = false;
        // Drain queued per-cell saves now that the bulk has resolved.
        const queue = queuedAfterBulkRef.current.slice();
        queuedAfterBulkRef.current = [];
        for (const fn of queue) {
          await fn();
        }
      }
    },
    [saveDaysBulk, onDaySaved, days, reportError],
  );

  // Optimistic local apply — used by edit commits, paste, fill before save.
  const applyLocalPatch = useCallback(
    (dayId: string, patch: AdPlanDayPatch) => {
      setLocalMap((prev) => {
        const next = new Map(prev);
        const current = next.get(dayId);
        if (!current) return prev;
        const merged: AdPlanDay = {
          ...current,
          ...patch,
          objective_budgets:
            patch.objective_budgets ?? current.objective_budgets,
        };
        next.set(dayId, merged);
        return next;
      });
    },
    [],
  );

  // Mouseup handler --------------------------------------------------------
  useEffect(() => {
    const onMouseUp = () => {
      const s = stateRef.current;
      if (s.mode.kind === "filling") {
        const sel = selectionBounds(s);
        const targetRows = rowsRef.current;
        const sourceRow = targetRows[sel.maxRow];
        if (!sourceRow) {
          dispatch({ type: "RESET_MODE" });
          return;
        }
        // Build patches: copy the source row's value for each column in
        // [minCol..maxCol] across every row in [maxRow + 1 .. toRow].
        const patches: AdPlanDayBulkPatch[] = [];
        for (let r = sel.maxRow + 1; r <= s.mode.toRow; r += 1) {
          const targetRow = targetRows[r];
          if (!targetRow) continue;
          let merged: AdPlanDayPatch = {};
          for (let c = sel.minCol; c <= sel.maxCol; c += 1) {
            const col = COLUMNS[c];
            if (!canEdit(col)) continue;
            const raw = col.readRaw(sourceRow);
            const next = col.applyString(targetRow, raw);
            if (!next) continue;
            merged = mergePatch(merged, next);
          }
          if (Object.keys(merged).length > 0) {
            applyLocalPatch(targetRow.id, merged);
            patches.push({ id: targetRow.id, ...merged });
          }
        }
        dispatch({ type: "RESET_MODE" });
        if (patches.length > 0) void runBulk(patches);
        return;
      }
      if (s.mode.kind === "selecting") {
        dispatch({ type: "RESET_MODE" });
      }
    };
    window.addEventListener("mouseup", onMouseUp);
    return () => window.removeEventListener("mouseup", onMouseUp);
  }, [runBulk, applyLocalPatch]);

  // Keyboard handling ------------------------------------------------------
  const commitEdit = useCallback(() => {
    if (!state.editing) return;
    const { row, col } = state.editing;
    const targetRow = rows[row];
    const column = COLUMNS[col];
    if (!targetRow || !column || !canEdit(column)) {
      dispatch({ type: "CANCEL_EDIT" });
      return;
    }
    const patch = column.applyString(targetRow, state.editValue);
    dispatch({ type: "COMMIT_EDIT" });
    if (!patch) return;
    applyLocalPatch(targetRow.id, patch);
    schedulePerCellSave(targetRow.id, patch);
  }, [state.editing, state.editValue, rows, applyLocalPatch, schedulePerCellSave]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Edit-mode keys are handled inside the input's own onKeyDown.
      if (state.editing) return;

      const meta = e.ctrlKey || e.metaKey;

      if (meta && e.key.toLowerCase() === "c") {
        e.preventDefault();
        const sel = selectionBounds(state);
        const tsv = serialiseSelectionTsv(rows, sel);
        void navigator.clipboard.writeText(tsv).catch(() => {
          reportError("Couldn't write to clipboard.");
        });
        return;
      }

      if (meta && e.key.toLowerCase() === "v") {
        e.preventDefault();
        navigator.clipboard
          .readText()
          .then((text) => {
            const patches = buildPastePatches(rows, state.anchor, text, applyLocalPatch);
            if (patches.length > 0) void runBulk(patches);
          })
          .catch(() => {
            reportError("Couldn't read from clipboard.");
          });
        return;
      }

      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          dispatch({ type: "MOVE_FOCUS", dRow: -1, dCol: 0, extend: e.shiftKey });
          return;
        case "ArrowDown":
          e.preventDefault();
          dispatch({ type: "MOVE_FOCUS", dRow: 1, dCol: 0, extend: e.shiftKey });
          return;
        case "ArrowLeft":
          e.preventDefault();
          dispatch({ type: "MOVE_FOCUS", dRow: 0, dCol: -1, extend: e.shiftKey });
          return;
        case "ArrowRight":
          e.preventDefault();
          dispatch({ type: "MOVE_FOCUS", dRow: 0, dCol: 1, extend: e.shiftKey });
          return;
        case "Tab":
          e.preventDefault();
          dispatch({
            type: "MOVE_FOCUS",
            dRow: 0,
            dCol: e.shiftKey ? -1 : 1,
            extend: false,
          });
          return;
        case "Enter": {
          e.preventDefault();
          const col = COLUMNS[state.focus.col];
          const row = rows[state.focus.row];
          if (!col || !row || !canEdit(col)) return;
          dispatch({ type: "BEGIN_EDIT", seed: col.readRaw(row) });
          return;
        }
        case "Backspace":
        case "Delete": {
          e.preventDefault();
          const sel = selectionBounds(state);
          const patches: AdPlanDayBulkPatch[] = [];
          for (let r = sel.minRow; r <= sel.maxRow; r += 1) {
            const dayRow = rows[r];
            if (!dayRow) continue;
            let merged: AdPlanDayPatch = {};
            for (let c = sel.minCol; c <= sel.maxCol; c += 1) {
              const col = COLUMNS[c];
              if (!canEdit(col)) continue;
              const next = col.applyString(dayRow, "");
              if (!next) continue;
              merged = mergePatch(merged, next);
            }
            if (Object.keys(merged).length > 0) {
              applyLocalPatch(dayRow.id, merged);
              patches.push({ id: dayRow.id, ...merged });
            }
          }
          if (patches.length > 0) void runBulk(patches);
          return;
        }
        default: {
          // Printable single-character key → enter edit mode and seed
          // the input with that character.
          if (e.key.length === 1 && !meta && !e.altKey) {
            const col = COLUMNS[state.focus.col];
            if (!col || !canEdit(col)) return;
            // Filter the seed against the column's input regex when numeric
            // so a stray "p" doesn't open an empty edit on a money cell.
            if (col.kind !== "text" && !inputRegexFor(col.kind).test(e.key)) {
              return;
            }
            e.preventDefault();
            dispatch({ type: "BEGIN_EDIT", seed: e.key });
          }
        }
      }
    },
    [state, rows, runBulk, applyLocalPatch, reportError],
  );

  // Cleanup: flush + clear timeouts on unmount so we don't leave dangling
  // saves firing after the component is gone.
  useEffect(() => {
    const timeouts = pendingTimeoutsRef.current;
    return () => {
      for (const t of timeouts.values()) clearTimeout(t);
      timeouts.clear();
    };
  }, []);

  // Footer pill stats ------------------------------------------------------
  const stats = useMemo(() => {
    const sel = selectionBounds(state);
    let sum = 0;
    let count = 0;
    let numericCells = 0;
    for (let r = sel.minRow; r <= sel.maxRow; r += 1) {
      const row = rows[r];
      if (!row) continue;
      for (let c = sel.minCol; c <= sel.maxCol; c += 1) {
        const col = COLUMNS[c];
        if (!isNumericColumn(col) || col.role !== "editable") continue;
        numericCells += 1;
        const raw = col.readRaw(row);
        if (raw === "") continue;
        const n = parseNumber(raw);
        if (n != null) {
          sum += n;
          count += 1;
        }
      }
    }
    return {
      sum,
      count,
      numericCells,
      avg: count > 0 ? sum / count : 0,
    };
  }, [state, rows]);

  // ─── Render ────────────────────────────────────────────────────────────

  return (
    <section className="space-y-2">
      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onMouseDown={() => {
          containerRef.current?.focus({ preventScroll: true });
        }}
        className="overflow-x-auto rounded-md border border-border bg-card focus:outline-none"
      >
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-card">
            <tr>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className="border-b border-border px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((day, rowIdx) => (
              <tr key={day.id}>
                {COLUMNS.map((col, colIdx) => (
                  <PlanCell
                    key={col.key}
                    day={day}
                    rowIdx={rowIdx}
                    rows={rows}
                    column={col}
                    colIdx={colIdx}
                    state={state}
                    dispatch={dispatch}
                    registerCell={registerCell(rowIdx, colIdx)}
                    editInputRef={
                      state.editing &&
                      state.editing.row === rowIdx &&
                      state.editing.col === colIdx
                        ? editInputRef
                        : null
                    }
                    onCommitEdit={commitEdit}
                    showFillHandle={
                      state.mode.kind !== "filling" &&
                      rowIdx === Math.max(state.anchor.row, state.focus.row) &&
                      colIdx === Math.max(state.anchor.col, state.focus.col) &&
                      isInSelection(state, rowIdx, colIdx) &&
                      // Don't offer the fill handle on a computed column
                      // — there's nothing to fill from.
                      col.role === "editable"
                    }
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <PlanFooterSum
        sum={stats.sum}
        avg={stats.avg}
        count={stats.count}
        numericCells={stats.numericCells}
      />
    </section>
  );
  },
);

// ─── Cell ────────────────────────────────────────────────────────────────────

interface PlanCellProps {
  day: AdPlanDay;
  rowIdx: number;
  rows: AdPlanDay[];
  column: PlanColumn;
  colIdx: number;
  state: State;
  dispatch: React.Dispatch<Action>;
  registerCell: (el: HTMLElement | null) => void;
  editInputRef: React.RefObject<HTMLInputElement | null> | null;
  onCommitEdit: () => void;
  showFillHandle: boolean;
}

function PlanCell({
  day,
  rowIdx,
  rows,
  column,
  colIdx,
  state,
  dispatch,
  registerCell,
  editInputRef,
  onCommitEdit,
  showFillHandle,
}: PlanCellProps) {
  const selected = isInSelection(state, rowIdx, colIdx);
  const anchor = isAnchor(state, rowIdx, colIdx);
  const focused = isFocus(state, rowIdx, colIdx);
  const fillPreview = isInFillPreview(state, rowIdx, colIdx);
  const editing = !!editInputRef;

  const editable = canEdit(column);
  const isComputed = column.role === "computed";

  // Computed and editable+readonly (Day) both render as non-input cells
  // with the same muted background. Computed adds italic + a slightly
  // tinted text colour to mark it as derived rather than inert.
  const baseCls = [
    "relative border-b border-r border-border px-2 py-1.5 align-middle",
    !editable ? "bg-muted/30 cursor-default" : "cursor-cell",
    isComputed ? "italic text-foreground/80" : "",
    selected && !anchor ? "bg-primary-light/60" : "",
    anchor ? "ring-2 ring-inset ring-foreground" : "",
    focused && !anchor ? "ring-1 ring-inset ring-foreground/60" : "",
    fillPreview ? "ring-1 ring-inset ring-foreground/40 bg-foreground/[0.04]" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // Compute the display string once. Computed columns need (day, idx, all);
  // editable columns only see (day).
  const displayValue = isComputed
    ? column.readDisplay(day, rowIdx, rows)
    : column.readDisplay(day);

  return (
    <td
      ref={registerCell}
      className={baseCls}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        if (editing) return;
        if (e.shiftKey) {
          dispatch({ type: "EXTEND_TO", cell: { row: rowIdx, col: colIdx } });
        } else {
          dispatch({ type: "SELECT_CELL", cell: { row: rowIdx, col: colIdx } });
          dispatch({ type: "BEGIN_SELECT_DRAG" });
        }
      }}
      onMouseEnter={() => {
        if (state.mode.kind === "selecting") {
          dispatch({ type: "EXTEND_TO", cell: { row: rowIdx, col: colIdx } });
        } else if (state.mode.kind === "filling") {
          dispatch({ type: "EXTEND_FILL", row: rowIdx });
        }
      }}
      onDoubleClick={() => {
        if (!editable) return;
        dispatch({ type: "BEGIN_EDIT", seed: column.readRaw(day) });
      }}
    >
      {editing && editable ? (
        <CellInput
          column={column}
          value={state.editValue}
          inputRef={editInputRef}
          onChange={(v) => dispatch({ type: "SET_EDIT_VALUE", value: v })}
          onCommit={onCommitEdit}
          onCancel={() => dispatch({ type: "CANCEL_EDIT" })}
          onMoveAfterCommit={(dRow, dCol) => {
            onCommitEdit();
            dispatch({
              type: "MOVE_FOCUS",
              dRow,
              dCol,
              extend: false,
            });
          }}
        />
      ) : column.role === "editable" &&
        column.kind === "text" &&
        column.key === "phase_marker" ? (
        displayValue ? (
          <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {displayValue}
          </span>
        ) : (
          <span className="text-muted-foreground/40">—</span>
        )
      ) : (
        <span className={displayValue ? "" : "text-muted-foreground/40"}>
          {displayValue || "—"}
        </span>
      )}

      {showFillHandle && !editing && (
        <button
          type="button"
          aria-label="Fill down"
          onMouseDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            dispatch({ type: "BEGIN_FILL" });
          }}
          className="absolute -bottom-1 -right-1 h-2 w-2 rounded-sm bg-foreground hover:scale-125 cursor-crosshair"
        />
      )}
    </td>
  );
}

// ─── Input ──────────────────────────────────────────────────────────────────

interface CellInputProps {
  column: EditableColumn;
  value: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  onMoveAfterCommit: (dRow: number, dCol: number) => void;
}

function CellInput({
  column,
  value,
  inputRef,
  onChange,
  onCommit,
  onCancel,
  onMoveAfterCommit,
}: CellInputProps) {
  const filterRe =
    column.kind !== "text" && column.kind !== "readonly"
      ? inputRegexFor(column.kind)
      : null;

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onMouseDown={(e) => e.stopPropagation()}
      onChange={(e) => {
        const next = e.target.value;
        // Controlled-input filtering — invalid keystrokes silently
        // don't register (correction G).
        if (filterRe && next !== "" && !filterRe.test(next)) return;
        onChange(next);
      }}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onMoveAfterCommit(1, 0);
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        } else if (e.key === "Tab") {
          e.preventDefault();
          onMoveAfterCommit(0, e.shiftKey ? -1 : 1);
        }
      }}
      className="w-full bg-transparent outline-none text-xs"
    />
  );
}

// ─── Footer ─────────────────────────────────────────────────────────────────

function PlanFooterSum({
  sum,
  avg,
  count,
  numericCells,
}: {
  sum: number;
  avg: number;
  count: number;
  numericCells: number;
}) {
  if (numericCells <= 1) {
    return (
      <p className="text-[11px] text-muted-foreground">
        Click a cell to edit. Drag to select a range. Cmd/Ctrl-C / V to
        copy / paste. Drag the small dot to fill down.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card px-3 py-1.5 text-[11px] text-muted-foreground">
      <span>
        Sum:{" "}
        <span className="font-medium text-foreground">
          £{sum.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </span>
      </span>
      <span>
        Avg:{" "}
        <span className="font-medium text-foreground">
          £{avg.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </span>
      </span>
      <span>
        Count: <span className="font-medium text-foreground">{count}</span>
      </span>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function mergePatch(
  base: AdPlanDayPatch,
  next: AdPlanDayPatch,
): AdPlanDayPatch {
  const merged: AdPlanDayPatch = { ...base, ...next };
  if (base.objective_budgets || next.objective_budgets) {
    merged.objective_budgets = {
      ...(base.objective_budgets ?? {}),
      ...(next.objective_budgets ?? {}),
    } as ObjectiveBudgets;
  }
  return merged;
}

/**
 * Serialise the selected range as TSV. RAW values only (correction B) so
 * a paste into Sheets and back round-trips cleanly without £ prefixes or
 * thousand separators.
 */
function serialiseSelectionTsv(
  rows: AdPlanDay[],
  sel: { minRow: number; maxRow: number; minCol: number; maxCol: number },
): string {
  const lines: string[] = [];
  for (let r = sel.minRow; r <= sel.maxRow; r += 1) {
    const row = rows[r];
    if (!row) continue;
    const cells: string[] = [];
    for (let c = sel.minCol; c <= sel.maxCol; c += 1) {
      const col = COLUMNS[c];
      // Both editable and computed contribute their raw value to TSV
      // — computed values round-trip into Sheets as plain numbers.
      cells.push(readRawAt(col, rows, r));
    }
    lines.push(cells.join("\t"));
  }
  return lines.join("\n");
}

/**
 * Parse incoming TSV and build patches starting at `anchor`, clamped to
 * the grid bounds. Read-only columns (Day) are silently skipped — the
 * source column at that offset is dropped so columns to its right stay
 * aligned. Empty cells in the paste produce a clear (column.applyString("")).
 */
function buildPastePatches(
  rows: AdPlanDay[],
  anchor: Cell,
  text: string,
  applyLocalPatch: (dayId: string, patch: AdPlanDayPatch) => void,
): AdPlanDayBulkPatch[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  // Strip a trailing empty line (Excel/Sheets often add one).
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  const patches: AdPlanDayBulkPatch[] = [];
  for (let dr = 0; dr < lines.length; dr += 1) {
    const targetRowIdx = anchor.row + dr;
    if (targetRowIdx >= rows.length) break;
    const targetRow = rows[targetRowIdx];
    const cells = lines[dr].split("\t");

    let merged: AdPlanDayPatch = {};
    for (let dc = 0; dc < cells.length; dc += 1) {
      const targetColIdx = anchor.col + dc;
      if (targetColIdx >= COLUMNS.length) break;
      const col = COLUMNS[targetColIdx];
      // Skip computed + editable+readonly columns in paste targets so a
      // copy-paste round-trip doesn't try to write back the derived
      // Daily / Total spend totals.
      if (!canEdit(col)) continue;
      const next = col.applyString(targetRow, cells[dc]);
      if (!next) continue;
      merged = mergePatch(merged, next);
    }
    if (Object.keys(merged).length > 0) {
      applyLocalPatch(targetRow.id, merged);
      patches.push({ id: targetRow.id, ...merged });
    }
  }
  return patches;
}
