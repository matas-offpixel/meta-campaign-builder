"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type AdditionalSpendCategory =
  | "PR"
  | "INFLUENCER"
  | "PRINT"
  | "RADIO"
  | "OTHER";

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

function notifyAdditionalSpendChanged(eventId: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(ADDITIONAL_SPEND_CHANGED, { detail: { eventId } }),
  );
}

interface Props {
  eventId: string;
  className?: string;
}

export function AdditionalSpendCard({ eventId, className }: Props) {
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

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(
      `/api/events/${encodeURIComponent(eventId)}/additional-spend`,
      { cache: "no-store" },
    );
    const json = (await res.json()) as { ok?: boolean; entries?: Entry[] };
    if (!res.ok || !json.ok || !json.entries) {
      throw new Error("Could not load additional spend.");
    }
    setEntries(json.entries);
  }, [eventId]);

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

  const resetDraft = () => {
    setDraftDate("");
    setDraftAmount("");
    setDraftCategory("OTHER");
    setDraftLabel("");
    setDraftNotes("");
    setShowAdd(false);
    setEditingId(null);
  };

  const startEdit = (e: Entry) => {
    setEditingId(e.id);
    setDraftDate(e.date);
    setDraftAmount(String(e.amount));
    setDraftCategory(e.category);
    setDraftLabel(e.label);
    setDraftNotes(e.notes ?? "");
    setShowAdd(false);
  };

  const submitCreate = async () => {
    const amount = Number(draftAmount);
    if (!draftDate || !Number.isFinite(amount) || amount < 0) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(eventId)}/additional-spend`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date: draftDate,
            amount,
            category: draftCategory,
            label: draftLabel,
            notes: draftNotes || null,
          }),
        },
      );
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? "Save failed.");
      }
      await load();
      notifyAdditionalSpendChanged(eventId);
      resetDraft();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const submitEdit = async (id: string) => {
    const amount = Number(draftAmount);
    if (!draftDate || !Number.isFinite(amount) || amount < 0) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(eventId)}/additional-spend/${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date: draftDate,
            amount,
            category: draftCategory,
            label: draftLabel,
            notes: draftNotes || null,
          }),
        },
      );
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? "Update failed.");
      }
      await load();
      notifyAdditionalSpendChanged(eventId);
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
      const res = await fetch(
        `/api/events/${encodeURIComponent(eventId)}/additional-spend/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? "Delete failed.");
      }
      await load();
      notifyAdditionalSpendChanged(eventId);
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
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={saving || !!editingId}
          onClick={() => {
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
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Off-Meta costs (PR, influencers, print, etc.) roll into the event
        Performance summary and Daily Tracker.
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
              {showAdd ? (
                <tr className="border-t border-border bg-muted/20">
                  <td className="px-2 py-2 align-top">
                    <Input
                      type="date"
                      value={draftDate}
                      onChange={(ev) => setDraftDate(ev.target.value)}
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
                      type="number"
                      min={0}
                      step={0.01}
                      value={draftAmount}
                      onChange={(ev) => setDraftAmount(ev.target.value)}
                      placeholder="0"
                      className="h-8 text-xs"
                    />
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
                editingId === e.id ? (
                  <tr key={e.id} className="border-t border-border bg-muted/20">
                    <td className="px-2 py-2 align-top">
                      <Input
                        type="date"
                        value={draftDate}
                        onChange={(ev) => setDraftDate(ev.target.value)}
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
                        type="number"
                        min={0}
                        step={0.01}
                        value={draftAmount}
                        onChange={(ev) => setDraftAmount(ev.target.value)}
                        className="h-8 text-xs"
                      />
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
