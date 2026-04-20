"use client";

import { useMemo, useState } from "react";
import { Loader2, Pencil, Plus, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { VenueRow } from "@/lib/types/intelligence";

type FormState = {
  id?: string;
  name: string;
  city: string;
  country: string;
  capacity: string;
  address: string;
  website: string;
  meta_page_id: string;
  meta_page_name: string;
  notes: string;
};

const EMPTY: FormState = {
  name: "",
  city: "",
  country: "",
  capacity: "",
  address: "",
  website: "",
  meta_page_id: "",
  meta_page_name: "",
  notes: "",
};

function rowToForm(v: VenueRow): FormState {
  return {
    id: v.id,
    name: v.name,
    city: v.city,
    country: v.country ?? "",
    capacity: v.capacity != null ? String(v.capacity) : "",
    address: v.address ?? "",
    website: v.website ?? "",
    meta_page_id: v.meta_page_id ?? "",
    meta_page_name: v.meta_page_name ?? "",
    notes: v.notes ?? "",
  };
}

function formToPayload(f: FormState) {
  return {
    name: f.name.trim(),
    city: f.city.trim(),
    country: f.country.trim() || null,
    capacity: f.capacity.trim() ? Number(f.capacity) : null,
    address: f.address.trim() || null,
    website: f.website.trim() || null,
    meta_page_id: f.meta_page_id.trim() || null,
    meta_page_name: f.meta_page_name.trim() || null,
    notes: f.notes.trim() || null,
  };
}

export function VenuesList({
  initialVenues,
  eventCounts,
}: {
  initialVenues: VenueRow[];
  eventCounts: Record<string, number>;
}) {
  const [venues, setVenues] = useState<VenueRow[]>(initialVenues);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return venues;
    const needle = query.trim().toLowerCase();
    return venues.filter(
      (v) =>
        v.name.toLowerCase().includes(needle) ||
        v.city.toLowerCase().includes(needle),
    );
  }, [venues, query]);

  const refreshOne = async (id: string) => {
    const res = await fetch(`/api/venues/${id}`, { cache: "no-store" });
    if (!res.ok) return;
    const j = (await res.json()) as { venue: VenueRow };
    setVenues((prev) => prev.map((v) => (v.id === id ? j.venue : v)));
  };

  const submit = async () => {
    if (!editing) return;
    if (!editing.name.trim() || !editing.city.trim()) {
      setError("Name and city are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (editing.id) {
        const res = await fetch(`/api/venues/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formToPayload(editing)),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await refreshOne(editing.id);
      } else {
        const res = await fetch("/api/venues", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formToPayload(editing)),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(j?.error ?? `HTTP ${res.status}`);
        }
        const j = (await res.json()) as { venue: VenueRow };
        setVenues((prev) =>
          [...prev, j.venue].sort((a, b) => a.name.localeCompare(b.name)),
        );
      }
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    setPendingDelete(id);
    try {
      const res = await fetch(`/api/venues/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setVenues((prev) => prev.filter((v) => v.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setPendingDelete(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          type="search"
          placeholder="Search by name or city…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-9 w-64 rounded border border-border-strong bg-background px-3 text-sm focus:border-primary focus:outline-none"
        />
        <Button size="sm" onClick={() => setEditing({ ...EMPTY })}>
          <Plus className="h-3.5 w-3.5" />
          New venue
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive bg-destructive/10 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-md border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">City</th>
              <th className="px-3 py-2 text-right">Capacity</th>
              <th className="px-3 py-2 text-right">Events</th>
              <th className="px-3 py-2 text-left">Meta page</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-6 text-center text-xs text-muted-foreground"
                >
                  {venues.length === 0
                    ? "No venues yet. Click 'New venue' to add one."
                    : "No venues match your search."}
                </td>
              </tr>
            ) : (
              filtered.map((v) => (
                <tr key={v.id} className="hover:bg-muted/40">
                  <td className="px-3 py-2 font-medium">{v.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {v.city}
                    {v.country ? `, ${v.country}` : ""}
                  </td>
                  <td className="px-3 py-2 text-right text-muted-foreground">
                    {v.capacity != null ? v.capacity.toLocaleString() : "—"}
                  </td>
                  <td className="px-3 py-2 text-right text-muted-foreground">
                    {eventCounts[v.id] ?? 0}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {v.meta_page_name ? (
                      <span className="text-foreground">
                        {v.meta_page_name}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/60">
                        Not linked
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditing(rowToForm(v))}
                        aria-label="Edit"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void remove(v.id)}
                        disabled={pendingDelete === v.id}
                        aria-label="Delete"
                      >
                        {pendingDelete === v.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <SlideOver
          title={editing.id ? "Edit venue" : "New venue"}
          onClose={() => (saving ? null : setEditing(null))}
          footer={
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditing(null)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={() => void submit()} disabled={saving}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Save
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <Input
              label="Name *"
              value={editing.name}
              onChange={(e) =>
                setEditing({ ...editing, name: e.target.value })
              }
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="City *"
                value={editing.city}
                onChange={(e) =>
                  setEditing({ ...editing, city: e.target.value })
                }
              />
              <Input
                label="Country"
                value={editing.country}
                onChange={(e) =>
                  setEditing({ ...editing, country: e.target.value })
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Capacity"
                type="number"
                value={editing.capacity}
                onChange={(e) =>
                  setEditing({ ...editing, capacity: e.target.value })
                }
              />
              <Input
                label="Website"
                value={editing.website}
                onChange={(e) =>
                  setEditing({ ...editing, website: e.target.value })
                }
              />
            </div>
            <Input
              label="Address"
              value={editing.address}
              onChange={(e) =>
                setEditing({ ...editing, address: e.target.value })
              }
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Meta page ID"
                value={editing.meta_page_id}
                onChange={(e) =>
                  setEditing({ ...editing, meta_page_id: e.target.value })
                }
              />
              <Input
                label="Meta page name"
                value={editing.meta_page_name}
                onChange={(e) =>
                  setEditing({ ...editing, meta_page_name: e.target.value })
                }
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">
                Notes
              </label>
              <textarea
                value={editing.notes}
                onChange={(e) =>
                  setEditing({ ...editing, notes: e.target.value })
                }
                rows={3}
                className="w-full rounded border border-border-strong bg-background p-2 text-sm focus:border-primary focus:outline-none"
              />
            </div>
          </div>
        </SlideOver>
      )}
    </div>
  );
}

function SlideOver({
  title,
  children,
  footer,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  footer: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex">
      <button
        type="button"
        className="flex-1 bg-black/40"
        onClick={onClose}
        aria-label="Close panel"
      />
      <aside className="flex w-full max-w-md flex-col border-l border-border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h3 className="font-heading text-sm tracking-wide">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          {footer}
        </div>
      </aside>
    </div>
  );
}
