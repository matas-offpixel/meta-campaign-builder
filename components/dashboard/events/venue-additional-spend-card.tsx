"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  AMOUNT_PARSE_HINT,
  parseMoneyAmountInput,
  parseSpendDateToIso,
} from "@/lib/additional-spend-parse";

type Category = "PR" | "INFLUENCER" | "PRINT" | "RADIO" | "OTHER";

type Entry = {
  id: string;
  origin: "event" | "venue";
  event_id: string;
  date: string;
  amount: number;
  category: Category;
  label: string;
  notes: string | null;
};

export type VenueAdditionalSpendEventOption = {
  id: string;
  name: string;
};

const CATEGORIES: readonly Category[] = [
  "PR",
  "INFLUENCER",
  "PRINT",
  "RADIO",
  "OTHER",
] as const;

const GBP = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});

async function safeJson<T = unknown>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text.trim()) throw new Error(`HTTP ${res.status}: empty response body`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `HTTP ${res.status}: non-JSON response - ${text.slice(0, 120)}`,
    );
  }
}

export function VenueAdditionalSpendCard({
  events,
  venueScope,
  shareToken,
  className = "",
  onAfterMutate,
  readOnly = false,
}: {
  events: VenueAdditionalSpendEventOption[];
  venueScope?: { clientId: string; eventCode: string };
  /**
   * When set, the card switches every read/write to the venue
   * share-token routes (`/api/venues/by-share-token/{token}/...`).
   * In this mode the per-event additional-spend rows are hidden —
   * the share-token contract scopes to venue-only entries.
   */
  shareToken?: string;
  className?: string;
  onAfterMutate?: () => void;
  readOnly?: boolean;
}) {
  const defaultEventId = events[0]?.id ?? "";
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState(defaultEventId);
  const [draftDate, setDraftDate] = useState("");
  const [draftAmount, setDraftAmount] = useState("");
  const [draftCategory, setDraftCategory] = useState<Category>("OTHER");
  const [draftLabel, setDraftLabel] = useState("");
  const [draftNotes, setDraftNotes] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{
    date?: string;
    amount?: string;
    label?: string;
  }>({});

  const eventById = useMemo(
    () => new Map(events.map((event) => [event.id, event])),
    [events],
  );

  const load = useCallback(async () => {
    setError(null);
    if (events.length === 0) {
      setEntries([]);
      return;
    }
    // Share-token mode: the venue share token only authorises the
    // venue-scope route. Per-event entries aren't accessible here, so
    // we skip that fanout entirely. Internal mode keeps the existing
    // per-event + venue load.
    if (shareToken) {
      const res = await fetch(
        `/api/venues/by-share-token/${encodeURIComponent(shareToken)}/additional-spend`,
        { cache: "no-store" },
      );
      const json = await safeJson<{
        ok?: boolean;
        entries?: Entry[];
        error?: string;
      }>(res);
      if (!res.ok || !json.ok || !json.entries) {
        throw new Error(json.error ?? "Could not load venue additional spend.");
      }
      setEntries(
        json.entries.map((entry) => ({
          ...entry,
          origin: "venue" as const,
          event_id: "__venue__",
        })),
      );
      return;
    }
    const loaded = await Promise.all(
      events.map(async (event) => {
        const res = await fetch(
          `/api/events/${encodeURIComponent(event.id)}/additional-spend`,
          { cache: "no-store" },
        );
        const json = await safeJson<{
          ok?: boolean;
          entries?: Entry[];
          error?: string;
        }>(res);
        if (!res.ok || !json.ok || !json.entries) {
          throw new Error(json.error ?? "Could not load additional spend.");
        }
        return json.entries.map((entry) => ({
          ...entry,
          origin: "event" as const,
          event_id: entry.event_id ?? event.id,
        }));
      }),
    );
    const venueEntries =
      venueScope == null
        ? []
        : await (async () => {
            const res = await fetch(
              `/api/clients/${encodeURIComponent(venueScope.clientId)}/venues/${encodeURIComponent(venueScope.eventCode)}/additional-spend`,
              { cache: "no-store" },
            );
            const json = await safeJson<{
              ok?: boolean;
              entries?: Entry[];
              error?: string;
            }>(res);
            if (!res.ok || !json.ok || !json.entries) {
              throw new Error(json.error ?? "Could not load venue additional spend.");
            }
            return json.entries.map((entry) => ({
              ...entry,
              origin: "venue" as const,
              event_id: "__venue__",
            }));
          })();
    setEntries([...venueEntries, ...loaded.flat()]);
  }, [events, venueScope, shareToken]);

  useEffect(() => {
    setSelectedEventId((current) =>
      current && eventById.has(current) ? current : defaultEventId,
    );
  }, [defaultEventId, eventById]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load()
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Load failed.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const reset = () => {
    setEditingId(null);
    setDialogOpen(false);
    setSelectedEventId(defaultEventId);
    setDraftDate("");
    setDraftAmount("");
    setDraftCategory("OTHER");
    setDraftLabel("");
    setDraftNotes("");
    setFieldErrors({});
  };

  const openCreate = () => {
    reset();
    setSelectedEventId(defaultEventId);
    setDraftDate(new Date().toISOString().slice(0, 10));
    setDialogOpen(true);
  };

  const startEdit = (entry: Entry) => {
    setEditingId(entry.id);
    setSelectedEventId(entry.event_id);
    setDraftDate(entry.date);
    setDraftAmount(String(entry.amount));
    setDraftCategory(entry.category);
    setDraftLabel(entry.label);
    setDraftNotes(entry.notes ?? "");
    setFieldErrors({});
    setDialogOpen(true);
  };

  const validate = () => {
    const dateResult = parseSpendDateToIso(draftDate);
    const amountResult = parseMoneyAmountInput(draftAmount);
    const nextErrors = {
      ...(!dateResult.ok ? { date: dateResult.message } : {}),
      ...(!amountResult.ok ? { amount: amountResult.message } : {}),
      ...(!draftLabel.trim() ? { label: "Label is required." } : {}),
    };
    setFieldErrors(nextErrors);
    if (!dateResult.ok || !amountResult.ok || !draftLabel.trim()) return null;
    return {
      eventId: selectedEventId,
      payload: {
        date: dateResult.isoDate,
        amount: amountResult.value,
        category: draftCategory,
        label: draftLabel.trim(),
        notes: draftNotes.trim() || null,
      },
    };
  };

  const submit = async () => {
    const parsed = validate();
    if (!parsed) return;
    const previousEntries = entries;
    const optimisticId = editingId ?? `optimistic-${Date.now()}`;
    const optimisticEntry: Entry = {
      id: optimisticId,
      origin:
        editingId && entries.find((entry) => entry.id === editingId)?.origin === "venue"
          ? "venue"
          : "event",
      event_id: parsed.eventId,
      date: parsed.payload.date,
      amount: parsed.payload.amount,
      category: parsed.payload.category,
      label: parsed.payload.label,
      notes: parsed.payload.notes,
    };
    setEntries((current) =>
      editingId
        ? current.map((entry) => (entry.id === editingId ? optimisticEntry : entry))
        : [optimisticEntry, ...current],
    );
    setSaving(true);
    setError(null);
    try {
      const existing = editingId
        ? entries.find((entry) => entry.id === editingId)
        : null;
      // URL routing has three branches:
      //   1) shareToken set → always use the venue share-token route.
      //   2) editing a venue-scope row → use the cookie-auth venue
      //      route so the same row stays venue-scope.
      //   3) otherwise → per-event cookie-auth route.
      const url = shareToken
        ? `/api/venues/by-share-token/${encodeURIComponent(shareToken)}/additional-spend${
            editingId ? `/${encodeURIComponent(editingId)}` : ""
          }`
        : existing?.origin === "venue" && venueScope
          ? `/api/clients/${encodeURIComponent(venueScope.clientId)}/venues/${encodeURIComponent(venueScope.eventCode)}/additional-spend/${encodeURIComponent(editingId!)}`
          : `/api/events/${encodeURIComponent(parsed.eventId)}/additional-spend${
              editingId ? `/${encodeURIComponent(editingId)}` : ""
            }`;
      const res = await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.payload),
      });
      const json = await safeJson<{ ok?: boolean; error?: string }>(res);
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Save failed.");
      await load();
      onAfterMutate?.();
      reset();
    } catch (err) {
      setEntries(previousEntries);
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (entry: Entry) => {
    if (!confirm("Delete this spend entry?")) return;
    const previousEntries = entries;
    setEntries((current) => current.filter((item) => item.id !== entry.id));
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        shareToken
          ? `/api/venues/by-share-token/${encodeURIComponent(shareToken)}/additional-spend/${encodeURIComponent(entry.id)}`
          : entry.origin === "venue" && venueScope
            ? `/api/clients/${encodeURIComponent(venueScope.clientId)}/venues/${encodeURIComponent(venueScope.eventCode)}/additional-spend/${encodeURIComponent(entry.id)}`
            : `/api/events/${encodeURIComponent(entry.event_id)}/additional-spend/${encodeURIComponent(entry.id)}`,
        { method: "DELETE" },
      );
      const json = await safeJson<{ ok?: boolean; error?: string }>(res);
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Delete failed.");
      await load();
      onAfterMutate?.();
      if (editingId === entry.id) reset();
    } catch (err) {
      setEntries(previousEntries);
      setError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setSaving(false);
    }
  };

  const groupedEntries = useMemo(
    () => [
      {
        event: { id: "__venue__", name: "Venue-wide" },
        entries: entries.filter((entry) => entry.origin === "venue"),
      },
      ...events.map((event) => ({
        event,
        entries: entries.filter(
          (entry) => entry.origin === "event" && entry.event_id === event.id,
        ),
      })),
    ],
    [entries, events],
  );
  const total = entries.reduce((sum, entry) => sum + entry.amount, 0);

  return (
    <div className={className}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium tracking-wide">Additional spend</h3>
        {!readOnly ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={saving || events.length === 0}
            onClick={openCreate}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add entry
          </Button>
        ) : null}
      </div>
      <p className="mb-2 text-xs tabular-nums text-foreground">
        Total: {GBP.format(total)} across {entries.length}{" "}
        {entries.length === 1 ? "entry" : "entries"}
      </p>
      <p className="mb-3 text-xs text-muted-foreground">
        Event-level PR, influencer, print, and OOH costs roll into Marketing
        Spend and the Daily Tracker at read time.
      </p>
      {error ? <p className="mb-2 text-xs text-destructive">{error}</p> : null}
      {loading ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading entries...
        </p>
      ) : entries.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
          No additional spend logged.
        </p>
      ) : (
        <div className="space-y-3">
          {groupedEntries.map(({ event, entries: eventEntries }) =>
            eventEntries.length === 0 ? null : (
              <div key={event.id} className="overflow-hidden rounded-md border border-border">
                <div className="bg-muted/50 px-3 py-2 text-xs font-medium text-foreground">
                  {event.name}
                </div>
                <table className="w-full min-w-[640px] border-collapse text-xs">
                  <thead className="bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Date</th>
                      <th className="px-3 py-2 text-left">Category</th>
                      <th className="px-3 py-2 text-left">Label</th>
                      <th className="px-3 py-2 text-right">Amount</th>
                      <th className="px-3 py-2 text-right"> </th>
                    </tr>
                  </thead>
                  <tbody>
                    {eventEntries.map((entry) => (
                      <tr key={entry.id} className="border-t border-border">
                        <td className="px-3 py-2 tabular-nums text-muted-foreground">
                          {entry.date}
                        </td>
                        <td className="px-3 py-2">{entry.category}</td>
                        <td className="px-3 py-2">
                          <span className="font-medium text-foreground">{entry.label}</span>
                          {entry.notes ? (
                            <span className="mt-0.5 block text-[10px] text-muted-foreground">
                              {entry.notes}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-right font-medium tabular-nums">
                          {GBP.format(entry.amount)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {readOnly ? null : (
                            <>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-8 w-8 p-0"
                                disabled={saving}
                                onClick={() => startEdit(entry)}
                                aria-label="Edit entry"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                                disabled={saving}
                                onClick={() => void remove(entry)}
                                aria-label="Delete entry"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ),
          )}
        </div>
      )}
      <Dialog open={dialogOpen && !readOnly} onClose={reset}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader onClose={reset}>
            <div>
              <DialogTitle>{editingId ? "Edit spend entry" : "Add spend entry"}</DialogTitle>
              <DialogDescription>
                Choose the event this cost belongs to so the venue breakdown can
                update the right row.
              </DialogDescription>
            </div>
          </DialogHeader>
          <div className="grid gap-3 text-sm md:grid-cols-2">
            <label className="space-y-1 md:col-span-2">
              <span className="text-xs text-muted-foreground">Event</span>
              <select
                value={selectedEventId}
                disabled={!!editingId}
                onChange={(event) => setSelectedEventId(event.target.value)}
                className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
              >
                {selectedEventId === "__venue__" ? (
                  <option value="__venue__">Venue-wide</option>
                ) : null}
                {events.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Date</span>
              <Input
                type="date"
                value={draftDate}
                onChange={(event) => {
                  setDraftDate(event.target.value);
                  setFieldErrors((current) => ({ ...current, date: undefined }));
                }}
                error={fieldErrors.date}
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Category</span>
              <select
                value={draftCategory}
                onChange={(event) => setDraftCategory(event.target.value as Category)}
                className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
              >
                {CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 md:col-span-2">
              <span className="text-xs text-muted-foreground">Label</span>
              <Input
                value={draftLabel}
                onChange={(event) => {
                  setDraftLabel(event.target.value);
                  setFieldErrors((current) => ({ ...current, label: undefined }));
                }}
                error={fieldErrors.label}
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Amount</span>
              <Input
                value={draftAmount}
                onChange={(event) => {
                  setDraftAmount(event.target.value);
                  setFieldErrors((current) => ({ ...current, amount: undefined }));
                }}
                inputMode="decimal"
                placeholder="e.g. 200 or £200"
                error={fieldErrors.amount}
              />
              <span className="text-[10px] text-muted-foreground">{AMOUNT_PARSE_HINT}</span>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Notes</span>
              <Input value={draftNotes} onChange={(event) => setDraftNotes(event.target.value)} />
            </label>
          </div>
          <DialogFooter>
            <Button type="button" size="sm" variant="outline" onClick={reset}>
              Cancel
            </Button>
            <Button type="button" size="sm" disabled={saving} onClick={() => void submit()}>
              {editingId ? "Update entry" : "Save entry"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
