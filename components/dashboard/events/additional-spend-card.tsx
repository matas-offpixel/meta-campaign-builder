"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AMOUNT_PARSE_HINT,
  parseMoneyAmountInput,
  parseSpendDateToIso,
} from "@/lib/additional-spend-parse";

type AdditionalSpendCategory =
  | "PR"
  | "INFLUENCER"
  | "PRINT"
  | "RADIO"
  | "OTHER";

/**
 * Reads the response body safely: tries JSON first; on parse failure
 * (empty body, HTML redirect page, etc.) throws a descriptive error so
 * callers always see a message instead of a raw SyntaxError.
 */
async function safeJson<T = unknown>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text.trim()) {
    throw new Error(`HTTP ${res.status}: empty response body`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `HTTP ${res.status}: non-JSON response — ${text.slice(0, 120)}`,
    );
  }
}

/** Dispatched after mutating additional spend so reporting block can refetch. */
export const ADDITIONAL_SPEND_CHANGED = "opx-additional-spend-changed";

const CATEGORIES: readonly AdditionalSpendCategory[] = [
  "PR",
  "INFLUENCER",
  "PRINT",
  "RADIO",
  "OTHER",
] as const;

const GBP = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

type Entry = {
  id: string;
  date: string;
  amount: number;
  category: AdditionalSpendCategory;
  label: string;
  notes: string | null;
};

function notifyAdditionalSpendChanged(key: string) {
  if (typeof window === "undefined") return;
  // `eventId` is kept as the detail key for backwards compat even when
  // the card is venue-scoped — event-level listeners still fire for their
  // own id; venue listeners match on `eventId === venue:<code>`.
  window.dispatchEvent(
    new CustomEvent(ADDITIONAL_SPEND_CHANGED, { detail: { eventId: key } }),
  );
}

/**
 * Venue-scope card pivots on `(clientId, venueEventCode)` instead of a
 * single `eventId`. Writes hit the venue-scope collection routes added
 * in PR 4 (`/api/clients/[id]/venues/[event_code]/...` internally,
 * `/api/venues/by-share-token/[token]/...` externally). The response
 * shape is identical to the per-event surface, so the UI plumbing
 * below stays scope-agnostic past URL construction.
 */
export type AdditionalSpendCardScope =
  | { kind: "event"; eventId: string }
  | { kind: "venue"; clientId: string; venueEventCode: string };

interface Props {
  /**
   * Which dataset the card reads / writes against. Defaults to
   * `{ kind: "event", eventId }` when only `eventId` is passed so
   * existing call sites don't need to change.
   */
  scope?: AdditionalSpendCardScope;
  /** Back-compat shim for pre-PR4 callers. Ignored when `scope` is set. */
  eventId?: string;
  className?: string;
  /**
   * `dashboard` — cookie auth (internal `/api/...` routes).
   * `share` — share token (`/api/.../by-share-token/[token]/...`).
   */
  mode?: "dashboard" | "share";
  shareToken?: string;
  /** Share mode: e.g. `router.refresh()` so server props pick up new rows. */
  onAfterMutate?: () => void;
  /**
   * When true (e.g. share token has `can_edit=false`), list is read-only —
   * no add row, no edit/delete controls.
   */
  readOnly?: boolean;
}

export function AdditionalSpendCard({
  scope: scopeProp,
  eventId,
  className,
  mode = "dashboard",
  shareToken,
  onAfterMutate,
  readOnly = false,
}: Props) {
  const scope: AdditionalSpendCardScope = scopeProp
    ? scopeProp
    : { kind: "event", eventId: eventId ?? "" };
  // Stable key for the cross-component "spend changed" event. Venue rows
  // broadcast under `venue:<event_code>` so per-event listeners keyed by
  // an eventId don't spuriously refetch when a sibling venue mutates.
  const notifyKey =
    scope.kind === "event"
      ? scope.eventId
      : `venue:${scope.venueEventCode}`;
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [draftDate, setDraftDate] = useState("");
  const [draftAmount, setDraftAmount] = useState("");
  const [draftCategory, setDraftCategory] =
    useState<AdditionalSpendCategory>("OTHER");
  const [draftLabel, setDraftLabel] = useState("");
  const [draftNotes, setDraftNotes] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{
    date?: string;
    amount?: string;
  }>({});

  const spendListUrl = (() => {
    if (mode === "share" && shareToken) {
      if (scope.kind === "venue") {
        return `/api/venues/by-share-token/${encodeURIComponent(shareToken)}/additional-spend`;
      }
      return `/api/events/by-share-token/${encodeURIComponent(shareToken)}/additional-spend`;
    }
    if (scope.kind === "venue") {
      return `/api/clients/${encodeURIComponent(scope.clientId)}/venues/${encodeURIComponent(scope.venueEventCode)}/additional-spend`;
    }
    return `/api/events/${encodeURIComponent(scope.eventId)}/additional-spend`;
  })();

  const normalizeEntries = (raw: unknown[]): Entry[] =>
    raw.map((r) => {
      const o = r as Record<string, unknown>;
      return {
        id: String(o.id),
        date: String(o.date),
        amount: Number(o.amount),
        category: (o.category as AdditionalSpendCategory) ?? "OTHER",
        label: typeof o.label === "string" ? o.label : "",
        notes:
          o.notes === null || o.notes === undefined
            ? null
            : String(o.notes),
      };
    });

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(spendListUrl, { cache: "no-store" });
    const json = await safeJson<{
      ok?: boolean;
      entries?: unknown[];
      error?: string;
    }>(res);
    if (!res.ok || !json.ok || !json.entries) {
      throw new Error(json.error ?? "Could not load additional spend.");
    }
    setEntries(normalizeEntries(json.entries));
  }, [spendListUrl]);

  const afterMutate = () => {
    onAfterMutate?.();
    notifyAdditionalSpendChanged(notifyKey);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await load();
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Load failed.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  useEffect(() => {
    if (readOnly) {
      setShowAdd(false);
      setEditingId(null);
    }
  }, [readOnly]);

  const spentTotal = useMemo(
    () => entries.reduce((s, e) => s + e.amount, 0),
    [entries],
  );

  const resetDraft = () => {
    setDraftDate("");
    setDraftAmount("");
    setDraftCategory("OTHER");
    setDraftLabel("");
    setDraftNotes("");
    setShowAdd(false);
    setEditingId(null);
    setFieldErrors({});
  };

  const startEdit = (e: Entry) => {
    setFieldErrors({});
    setEditingId(e.id);
    setDraftDate(e.date);
    setDraftAmount(String(e.amount));
    setDraftCategory(e.category);
    setDraftLabel(e.label);
    setDraftNotes(e.notes ?? "");
    setShowAdd(false);
  };

  const submitCreate = async () => {
    setFieldErrors({});
    setError(null);

    const dateResult = parseSpendDateToIso(draftDate);
    const amountResult = parseMoneyAmountInput(draftAmount);
    if (!dateResult.ok || !amountResult.ok) {
      setFieldErrors({
        ...(!dateResult.ok ? { date: dateResult.message } : {}),
        ...(!amountResult.ok ? { amount: amountResult.message } : {}),
      });
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(spendListUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: dateResult.isoDate,
          amount: amountResult.value,
          category: draftCategory,
          label: draftLabel,
          notes: draftNotes || null,
        }),
      });
      const json = await safeJson<{
        ok?: boolean;
        error?: string;
        fieldErrors?: { date?: string; amount?: string };
      }>(res);
      if (!res.ok || !json.ok) {
        if (json.fieldErrors) setFieldErrors(json.fieldErrors);
        throw new Error(json.error ?? "Save failed.");
      }
      await load();
      afterMutate();
      resetDraft();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const submitEdit = async (id: string) => {
    setFieldErrors({});
    setError(null);

    const dateResult = parseSpendDateToIso(draftDate);
    const amountResult = parseMoneyAmountInput(draftAmount);
    if (!dateResult.ok || !amountResult.ok) {
      setFieldErrors({
        ...(!dateResult.ok ? { date: dateResult.message } : {}),
        ...(!amountResult.ok ? { amount: amountResult.message } : {}),
      });
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`${spendListUrl}/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: dateResult.isoDate,
          amount: amountResult.value,
          category: draftCategory,
          label: draftLabel,
          notes: draftNotes || null,
        }),
      });
      const json = await safeJson<{
        ok?: boolean;
        error?: string;
        fieldErrors?: { date?: string; amount?: string };
      }>(res);
      if (!res.ok || !json.ok) {
        if (json.fieldErrors) setFieldErrors(json.fieldErrors);
        throw new Error(json.error ?? "Update failed.");
      }
      await load();
      afterMutate();
      resetDraft();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this spend entry?")) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${spendListUrl}/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const json = await safeJson<{ ok?: boolean; error?: string }>(res);
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? "Delete failed.");
      }
      await load();
      afterMutate();
      if (editingId === id) resetDraft();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={className}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium tracking-wide">Additional spend</h3>
        {!readOnly ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={saving || !!editingId}
          onClick={() => {
            setFieldErrors({});
            setShowAdd(true);
            setEditingId(null);
            setDraftDate(new Date().toISOString().slice(0, 10));
            setDraftAmount("");
            setDraftCategory("OTHER");
            setDraftLabel("");
            setDraftNotes("");
          }}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add entry
        </Button>
        ) : null}
      </div>
      <p className="mb-2 text-xs tabular-nums text-foreground">
        Total: {GBP.format(spentTotal)} across {entries.length}{" "}
        {entries.length === 1 ? "entry" : "entries"}
      </p>
      <p className="mb-3 text-xs text-muted-foreground">
        Off-Meta costs (PR, influencers, print, etc.) roll into the event
        Performance summary and Daily Tracker.
        {mode === "share" ? (
          <>
            {" "}
            Entries you add here are visible to anyone with this report link.
          </>
        ) : null}
      </p>
      {error ? (
        <p className="mb-2 text-xs text-destructive">{error}</p>
      ) : null}
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading…
        </div>
      ) : entries.length === 0 && !showAdd ? (
        <p className="text-xs text-muted-foreground">No entries yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[640px] border-collapse text-xs">
            <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-2 py-2 text-left">Date</th>
                <th className="px-2 py-2 text-left">Category</th>
                <th className="px-2 py-2 text-left">Label</th>
                <th className="px-2 py-2 text-right">Amount</th>
                <th className="px-2 py-2 text-right"> </th>
              </tr>
            </thead>
            <tbody>
              {!readOnly && showAdd ? (
                <tr className="border-t border-border bg-muted/20">
                  <td className="px-2 py-2 align-top">
                    <Input
                      type="date"
                      value={draftDate}
                      error={fieldErrors.date}
                      onChange={(ev) => {
                        setDraftDate(ev.target.value);
                        setFieldErrors((fe) => ({ ...fe, date: undefined }));
                      }}
                      className="h-8 text-xs"
                    />
                  </td>
                  <td className="px-2 py-2 align-top">
                    <select
                      value={draftCategory}
                      onChange={(ev) =>
                        setDraftCategory(ev.target.value as AdditionalSpendCategory)
                      }
                      className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-2 align-top">
                    <Input
                      value={draftLabel}
                      onChange={(ev) => setDraftLabel(ev.target.value)}
                      placeholder="e.g. Print ad — Metro"
                      className="h-8 text-xs"
                    />
                    <Input
                      value={draftNotes}
                      onChange={(ev) => setDraftNotes(ev.target.value)}
                      placeholder="Notes (optional)"
                      className="mt-1 h-8 text-xs"
                    />
                  </td>
                  <td className="px-2 py-2 align-top">
                    <Input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={draftAmount}
                      error={fieldErrors.amount}
                      onChange={(ev) => {
                        setDraftAmount(ev.target.value);
                        setFieldErrors((fe) => ({ ...fe, amount: undefined }));
                      }}
                      placeholder="e.g. 1800 or £1,800"
                      className="h-8 text-xs"
                    />
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {AMOUNT_PARSE_HINT}
                    </p>
                  </td>
                  <td className="px-2 py-2 text-right align-top">
                    <Button
                      type="button"
                      size="sm"
                      disabled={saving}
                      onClick={() => void submitCreate()}
                    >
                      Save
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="ml-1"
                      onClick={resetDraft}
                    >
                      Cancel
                    </Button>
                  </td>
                </tr>
              ) : null}
              {entries.map((e) =>
                !readOnly && editingId === e.id ? (
                  <tr key={e.id} className="border-t border-border bg-muted/20">
                    <td className="px-2 py-2 align-top">
                      <Input
                        type="date"
                        value={draftDate}
                        error={fieldErrors.date}
                        onChange={(ev) => {
                          setDraftDate(ev.target.value);
                          setFieldErrors((fe) => ({ ...fe, date: undefined }));
                        }}
                        className="h-8 text-xs"
                      />
                    </td>
                    <td className="px-2 py-2 align-top">
                      <select
                        value={draftCategory}
                        onChange={(ev) =>
                          setDraftCategory(ev.target.value as AdditionalSpendCategory)
                        }
                        className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                      >
                        {CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-2 align-top">
                      <Input
                        value={draftLabel}
                        onChange={(ev) => setDraftLabel(ev.target.value)}
                        className="h-8 text-xs"
                      />
                      <Input
                        value={draftNotes}
                        onChange={(ev) => setDraftNotes(ev.target.value)}
                        placeholder="Notes"
                        className="mt-1 h-8 text-xs"
                      />
                    </td>
                    <td className="px-2 py-2 align-top">
                      <Input
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        value={draftAmount}
                        error={fieldErrors.amount}
                        onChange={(ev) => {
                          setDraftAmount(ev.target.value);
                          setFieldErrors((fe) => ({ ...fe, amount: undefined }));
                        }}
                        placeholder="e.g. 1800 or £1,800"
                        className="h-8 text-xs"
                      />
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {AMOUNT_PARSE_HINT}
                      </p>
                    </td>
                    <td className="px-2 py-2 text-right align-top">
                      <Button
                        type="button"
                        size="sm"
                        disabled={saving}
                        onClick={() => void submitEdit(e.id)}
                      >
                        Save
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={resetDraft}
                      >
                        Cancel
                      </Button>
                    </td>
                  </tr>
                ) : (
                  <tr
                    key={e.id}
                    className="border-t border-border odd:bg-background even:bg-card/40"
                  >
                    <td className="px-2 py-2 tabular-nums text-muted-foreground">
                      {e.date}
                    </td>
                    <td className="px-2 py-2">{e.category}</td>
                    <td className="px-2 py-2">
                      <span className="font-medium">{e.label || "—"}</span>
                      {e.notes ? (
                        <span className="mt-0.5 block text-[10px] text-muted-foreground">
                          {e.notes}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-2 py-2 text-right font-medium tabular-nums">
                      {GBP.format(e.amount)}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {readOnly ? null : (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0"
                            disabled={saving || showAdd}
                            onClick={() => startEdit(e)}
                            aria-label="Edit entry"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                            disabled={saving || showAdd}
                            onClick={() => void remove(e.id)}
                            aria-label="Delete entry"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
