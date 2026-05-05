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

type Source =
  | "partner_allocation"
  | "complimentary"
  | "offline_sale"
  | "sponsor_pass"
  | "group_booking"
  | "reseller"
  | "other";

type Entry = {
  id: string;
  event_id: string;
  scope: "event" | "tier";
  tier_name: string | null;
  tickets_count: number;
  revenue_amount: number;
  date: string | null;
  source: Source | null;
  label: string;
  notes: string | null;
};

export type AdditionalTicketEntriesEventOption = {
  id: string;
  name: string;
  ticketTiers?: string[];
};

const SOURCES: Array<{ value: Source; label: string }> = [
  { value: "partner_allocation", label: "Partner allocation" },
  { value: "complimentary", label: "Complimentary" },
  { value: "offline_sale", label: "Offline sale" },
  { value: "sponsor_pass", label: "Sponsor pass" },
  { value: "group_booking", label: "Group booking" },
  { value: "reseller", label: "Reseller" },
  { value: "other", label: "Other" },
];

const NUM = new Intl.NumberFormat("en-GB");
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

export function AdditionalTicketEntriesCard({
  eventId,
  events,
  tiers = [],
  className = "",
  onAfterMutate,
  readOnly = false,
}: {
  eventId?: string;
  events?: AdditionalTicketEntriesEventOption[];
  tiers?: string[];
  className?: string;
  onAfterMutate?: () => void;
  readOnly?: boolean;
}) {
  const eventOptions = useMemo<AdditionalTicketEntriesEventOption[]>(() => {
    if (events && events.length > 0) return events;
    return eventId ? [{ id: eventId, name: "Event", ticketTiers: tiers }] : [];
  }, [eventId, events, tiers]);
  const defaultEventId = eventOptions[0]?.id ?? "";
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState(defaultEventId);
  const [scope, setScope] = useState<"event" | "tier">("event");
  const [tierName, setTierName] = useState("");
  const [ticketsCount, setTicketsCount] = useState("");
  const [revenueAmount, setRevenueAmount] = useState("");
  const [date, setDate] = useState("");
  const [source, setSource] = useState<Source>("partner_allocation");
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{
    tickets?: string;
    revenue?: string;
    date?: string;
    label?: string;
    tier?: string;
  }>({});

  const eventById = useMemo(
    () => new Map(eventOptions.map((event) => [event.id, event])),
    [eventOptions],
  );
  const selectedTiers = eventById.get(selectedEventId)?.ticketTiers ?? [];

  const load = useCallback(async () => {
    setError(null);
    if (eventOptions.length === 0) {
      setEntries([]);
      return;
    }
    const loaded = await Promise.all(
      eventOptions.map(async (event) => {
        const res = await fetch(
          `/api/events/${encodeURIComponent(event.id)}/additional-ticket-entries`,
          { cache: "no-store" },
        );
        const json = await safeJson<{
          ok?: boolean;
          entries?: Entry[];
          error?: string;
        }>(res);
        if (!res.ok || !json.ok || !json.entries) {
          throw new Error(json.error ?? "Could not load additional ticket sales.");
        }
        return json.entries.map((entry) => ({
          ...entry,
          event_id: entry.event_id ?? event.id,
        }));
      }),
    );
    setEntries(loaded.flat());
  }, [eventOptions]);

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
    setScope("event");
    setTierName("");
    setTicketsCount("");
    setRevenueAmount("");
    setDate("");
    setSource("partner_allocation");
    setLabel("");
    setNotes("");
    setFieldErrors({});
  };

  const openCreate = () => {
    reset();
    setSelectedEventId(defaultEventId);
    setDate(new Date().toISOString().slice(0, 10));
    setDialogOpen(true);
  };

  const startEdit = (entry: Entry) => {
    setEditingId(entry.id);
    setSelectedEventId(entry.event_id);
    setScope(entry.scope);
    setTierName(entry.tier_name ?? "");
    setTicketsCount(String(entry.tickets_count));
    setRevenueAmount(entry.revenue_amount ? String(entry.revenue_amount) : "");
    setDate(entry.date ?? "");
    setSource(entry.source ?? "other");
    setLabel(entry.label);
    setNotes(entry.notes ?? "");
    setFieldErrors({});
    setDialogOpen(true);
  };

  const validate = () => {
    const nextErrors: typeof fieldErrors = {};
    const tickets = Number(ticketsCount);
    if (!Number.isInteger(tickets) || tickets < 0) {
      nextErrors.tickets = "Tickets count must be a non-negative whole number.";
    }
    const revenue =
      revenueAmount.trim() === ""
        ? { ok: true as const, value: 0 }
        : parseMoneyAmountInput(revenueAmount);
    if (!revenue.ok) nextErrors.revenue = revenue.message;
    const dateResult =
      date.trim() === ""
        ? { ok: true as const, isoDate: null }
        : parseSpendDateToIso(date);
    if (!dateResult.ok) nextErrors.date = dateResult.message;
    if (scope === "tier" && !tierName) nextErrors.tier = "Tier is required.";
    if (!label.trim()) nextErrors.label = "Label is required.";
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || !revenue.ok || !dateResult.ok) {
      return null;
    }
    return {
      eventId: selectedEventId,
      payload: {
        scope,
        tier_name: scope === "tier" ? tierName : null,
        tickets_count: tickets,
        revenue_amount: revenue.value,
        date: dateResult.isoDate,
        source,
        label: label.trim(),
        notes: notes.trim() || null,
      },
    };
  };

  const submit = async () => {
    const parsed = validate();
    if (!parsed) return;
    const previousEntries = entries;
    setSaving(true);
    setError(null);
    const optimisticId = editingId ?? `optimistic-${Date.now()}`;
    const optimisticEntry: Entry = {
      id: optimisticId,
      event_id: parsed.eventId,
      scope: parsed.payload.scope,
      tier_name: parsed.payload.tier_name,
      tickets_count: parsed.payload.tickets_count,
      revenue_amount: parsed.payload.revenue_amount,
      date: parsed.payload.date,
      source: parsed.payload.source,
      label: parsed.payload.label,
      notes: parsed.payload.notes,
    };
    setEntries((current) =>
      editingId
        ? current.map((entry) => (entry.id === editingId ? optimisticEntry : entry))
        : [optimisticEntry, ...current],
    );
    try {
      const url = `/api/events/${encodeURIComponent(parsed.eventId)}/additional-ticket-entries${
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
    if (!confirm("Delete this ticket entry?")) return;
    const previousEntries = entries;
    setEntries((current) => current.filter((item) => item.id !== entry.id));
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(entry.event_id)}/additional-ticket-entries/${encodeURIComponent(entry.id)}`,
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
    () =>
      eventOptions.map((event) => ({
        event,
        entries: entries.filter((entry) => entry.event_id === event.id),
      })),
    [entries, eventOptions],
  );
  const total = entries.reduce((sum, entry) => sum + entry.tickets_count, 0);

  return (
    <div className={className}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium tracking-wide">Additional ticket sales</h3>
        {!readOnly ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={saving || eventOptions.length === 0}
            onClick={openCreate}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add entry
          </Button>
        ) : null}
      </div>
      <p className="mb-2 text-xs tabular-nums text-foreground">
        Total: {NUM.format(total)} tickets across {entries.length}{" "}
        {entries.length === 1 ? "entry" : "entries"}
      </p>
      <p className="mb-3 text-xs text-muted-foreground">
        Partner allocations, comps, and offline sales roll into Tickets Sold
        and tier totals at read time.
      </p>
      {error ? <p className="mb-2 text-xs text-destructive">{error}</p> : null}
      {loading ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading entries...
        </p>
      ) : entries.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
          No additional ticket sales logged.
        </p>
      ) : (
        <div className="space-y-3">
          {groupedEntries.map(({ event, entries: eventEntries }) =>
            eventEntries.length === 0 ? null : (
              <div key={event.id} className="overflow-hidden rounded-md border border-border">
                <div className="bg-muted/50 px-3 py-2 text-xs font-medium text-foreground">
                  {event.name}
                </div>
                <table className="w-full min-w-[720px] border-collapse text-xs">
                  <thead className="bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Label</th>
                      <th className="px-3 py-2 text-left">Scope</th>
                      <th className="px-3 py-2 text-left">Source</th>
                      <th className="px-3 py-2 text-right">Tickets</th>
                      <th className="px-3 py-2 text-right">Revenue</th>
                      <th className="px-3 py-2 text-right"> </th>
                    </tr>
                  </thead>
                  <tbody>
                    {eventEntries.map((entry) => (
                      <tr key={entry.id} className="border-t border-border">
                        <td className="px-3 py-2">
                          <span className="font-medium text-foreground">{entry.label}</span>
                          <span className="mt-0.5 block text-[10px] text-muted-foreground">
                            {entry.date ?? "No date"}
                            {entry.notes ? ` - ${entry.notes}` : ""}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {entry.scope === "tier" ? entry.tier_name : "Event"}
                        </td>
                        <td className="px-3 py-2">{sourceLabel(entry.source)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {NUM.format(entry.tickets_count)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {GBP.format(entry.revenue_amount ?? 0)}
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
              <DialogTitle>{editingId ? "Edit ticket entry" : "Add ticket entry"}</DialogTitle>
              <DialogDescription>
                Choose the event, scope, ticket count, and optional revenue.
              </DialogDescription>
            </div>
          </DialogHeader>
          <div className="grid gap-3 text-sm md:grid-cols-2">
            <label className="space-y-1 md:col-span-2">
              <span className="text-xs text-muted-foreground">Event</span>
              <select
                value={selectedEventId}
                disabled={!!editingId}
                onChange={(event) => {
                  setSelectedEventId(event.target.value);
                  setTierName("");
                }}
                className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
              >
                {eventOptions.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Scope</span>
              <select
                value={scope}
                onChange={(event) => {
                  setScope(event.target.value === "tier" ? "tier" : "event");
                  setTierName("");
                }}
                className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
              >
                <option value="event">Event</option>
                <option value="tier">Tier</option>
              </select>
            </label>
            {scope === "tier" ? (
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">Tier</span>
                <select
                  value={tierName}
                  onChange={(event) => {
                    setTierName(event.target.value);
                    setFieldErrors((current) => ({ ...current, tier: undefined }));
                  }}
                  className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                >
                  <option value="">Select tier</option>
                  {selectedTiers.map((tier) => (
                    <option key={tier} value={tier}>
                      {tier}
                    </option>
                  ))}
                </select>
                {fieldErrors.tier ? (
                  <span className="text-[11px] text-destructive">{fieldErrors.tier}</span>
                ) : null}
              </label>
            ) : null}
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Tickets</span>
              <Input
                value={ticketsCount}
                onChange={(event) => {
                  setTicketsCount(event.target.value);
                  setFieldErrors((current) => ({ ...current, tickets: undefined }));
                }}
                inputMode="numeric"
                error={fieldErrors.tickets}
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Revenue</span>
              <Input
                value={revenueAmount}
                onChange={(event) => {
                  setRevenueAmount(event.target.value);
                  setFieldErrors((current) => ({ ...current, revenue: undefined }));
                }}
                inputMode="decimal"
                placeholder="Optional"
                error={fieldErrors.revenue}
              />
              <span className="text-[10px] text-muted-foreground">{AMOUNT_PARSE_HINT}</span>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Date</span>
              <Input
                type="date"
                value={date}
                onChange={(event) => {
                  setDate(event.target.value);
                  setFieldErrors((current) => ({ ...current, date: undefined }));
                }}
                error={fieldErrors.date}
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Source</span>
              <select
                value={source}
                onChange={(event) => setSource(event.target.value as Source)}
                className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
              >
                {SOURCES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 md:col-span-2">
              <span className="text-xs text-muted-foreground">Label</span>
              <Input
                value={label}
                onChange={(event) => {
                  setLabel(event.target.value);
                  setFieldErrors((current) => ({ ...current, label: undefined }));
                }}
                error={fieldErrors.label}
              />
            </label>
            <label className="space-y-1 md:col-span-2">
              <span className="text-xs text-muted-foreground">Notes</span>
              <Input value={notes} onChange={(event) => setNotes(event.target.value)} />
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

function sourceLabel(source: Source | null): string {
  return SOURCES.find((item) => item.value === source)?.label ?? "Other";
}
