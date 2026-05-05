"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
  scope: "event" | "tier";
  tier_name: string | null;
  tickets_count: number;
  revenue_amount: number;
  date: string | null;
  source: Source | null;
  label: string;
  notes: string | null;
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

export function AdditionalTicketSalesCard({
  eventId,
  tiers = [],
  className = "",
  onAfterMutate,
}: {
  eventId: string;
  tiers?: string[];
  className?: string;
  onAfterMutate?: () => void;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [scope, setScope] = useState<"event" | "tier">("event");
  const [tierName, setTierName] = useState("");
  const [ticketsCount, setTicketsCount] = useState("");
  const [revenueAmount, setRevenueAmount] = useState("");
  const [date, setDate] = useState("");
  const [source, setSource] = useState<Source>("partner_allocation");
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");

  const url = `/api/events/${encodeURIComponent(eventId)}/additional-tickets`;

  const load = useCallback(async () => {
    const res = await fetch(url, { cache: "no-store" });
    const json = (await res.json()) as {
      ok?: boolean;
      entries?: Entry[];
      error?: string;
    };
    if (!res.ok || !json.ok || !json.entries) {
      throw new Error(json.error ?? "Could not load additional ticket sales.");
    }
    setEntries(json.entries);
  }, [url]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load()
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Load failed.");
        }
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
    setShowForm(false);
    setScope("event");
    setTierName("");
    setTicketsCount("");
    setRevenueAmount("");
    setDate("");
    setSource("partner_allocation");
    setLabel("");
    setNotes("");
  };

  const startEdit = (entry: Entry) => {
    setEditingId(entry.id);
    setShowForm(true);
    setScope(entry.scope);
    setTierName(entry.tier_name ?? "");
    setTicketsCount(String(entry.tickets_count));
    setRevenueAmount(String(entry.revenue_amount ?? 0));
    setDate(entry.date ?? "");
    setSource(entry.source ?? "other");
    setLabel(entry.label);
    setNotes(entry.notes ?? "");
  };

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        scope,
        tier_name: scope === "tier" ? tierName : null,
        tickets_count: ticketsCount,
        revenue_amount: revenueAmount || 0,
        date: date || null,
        source,
        label,
        notes: notes || null,
      };
      const res = await fetch(
        editingId ? `${url}/${encodeURIComponent(editingId)}` : url,
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Save failed.");
      await load();
      onAfterMutate?.();
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this ticket entry?")) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${url}/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Delete failed.");
      await load();
      onAfterMutate?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setSaving(false);
    }
  };

  const total = entries.reduce((sum, entry) => sum + entry.tickets_count, 0);

  return (
    <div className={className}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium tracking-wide">Additional ticket sales</h3>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={saving}
          onClick={() => {
            reset();
            setShowForm(true);
            setDate(new Date().toISOString().slice(0, 10));
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          Add entry
        </Button>
      </div>

      {loading ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Loading entries…
        </p>
      ) : entries.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
          No additional ticket sales logged.
        </p>
      ) : (
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/70 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Label</th>
                <th className="px-3 py-2">Scope</th>
                <th className="px-3 py-2 text-right">Tickets</th>
                <th className="px-3 py-2 text-right">Revenue</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <span className="font-medium text-foreground">{entry.label}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {sourceLabel(entry.source)}
                      {entry.date ? ` · ${entry.date}` : ""}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {entry.scope === "tier" ? entry.tier_name : "Event"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {NUM.format(entry.tickets_count)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {GBP.format(entry.revenue_amount ?? 0)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      className="mr-2 text-muted-foreground hover:text-foreground"
                      onClick={() => startEdit(entry)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => void remove(entry.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
              <tr className="border-t border-border bg-muted/40 font-medium">
                <td className="px-3 py-2" colSpan={2}>Total additional</td>
                <td className="px-3 py-2 text-right tabular-nums">{NUM.format(total)}</td>
                <td className="px-3 py-2" colSpan={2} />
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {showForm ? (
        <div className="mt-3 grid gap-3 rounded-md border border-border bg-muted/30 p-3 text-sm md:grid-cols-2">
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Scope</span>
            <select
              value={scope}
              onChange={(event) => setScope(event.target.value === "tier" ? "tier" : "event")}
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
                onChange={(event) => setTierName(event.target.value)}
                className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
              >
                <option value="">Select tier</option>
                {tiers.map((tier) => (
                  <option key={tier} value={tier}>{tier}</option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Tickets</span>
            <Input value={ticketsCount} onChange={(event) => setTicketsCount(event.target.value)} inputMode="numeric" />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Revenue</span>
            <Input value={revenueAmount} onChange={(event) => setRevenueAmount(event.target.value)} inputMode="decimal" />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Date</span>
            <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Source</span>
            <select
              value={source}
              onChange={(event) => setSource(event.target.value as Source)}
              className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
            >
              {SOURCES.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1 md:col-span-2">
            <span className="text-xs text-muted-foreground">Label</span>
            <Input value={label} onChange={(event) => setLabel(event.target.value)} />
          </label>
          <label className="space-y-1 md:col-span-2">
            <span className="text-xs text-muted-foreground">Notes</span>
            <Input value={notes} onChange={(event) => setNotes(event.target.value)} />
          </label>
          <div className="flex items-center gap-2 md:col-span-2">
            <Button type="button" size="sm" disabled={saving} onClick={() => void submit()}>
              {editingId ? "Update entry" : "Save entry"}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={reset}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function sourceLabel(source: Source | null): string {
  return SOURCES.find((item) => item.value === source)?.label ?? "Other";
}
