"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { VenueRow } from "@/lib/types/intelligence";

interface VenueEnrichmentCandidate {
  id: string;
  name: string;
  address_full: string | null;
  latitude: number | null;
  longitude: number | null;
  website: string | null;
  phone: string | null;
  rating: number | null;
  user_ratings_total: number | null;
  google_maps_url: string | null;
  photo_reference: string | null;
  raw: Record<string, unknown>;
}

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
  // Enrichment-derived (sticky-merged on save). Not user-editable
  // here — the candidate panel populates them; users tweak the
  // friendly fields above.
  google_place_id: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  address_full: string | null;
  google_maps_url: string | null;
  rating: number | null;
  user_ratings_total: number | null;
  photo_reference: string | null;
  profile_jsonb: Record<string, unknown> | null;
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
  google_place_id: null,
  latitude: null,
  longitude: null,
  phone: null,
  address_full: null,
  google_maps_url: null,
  rating: null,
  user_ratings_total: null,
  photo_reference: null,
  profile_jsonb: null,
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
    google_place_id: v.google_place_id ?? null,
    latitude: v.latitude ?? null,
    longitude: v.longitude ?? null,
    phone: v.phone ?? null,
    address_full: v.address_full ?? null,
    google_maps_url: v.google_maps_url ?? null,
    rating: v.rating ?? null,
    user_ratings_total: v.user_ratings_total ?? null,
    photo_reference: v.photo_reference ?? null,
    profile_jsonb:
      (v.profile_jsonb as Record<string, unknown> | null) ?? null,
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
    google_place_id: f.google_place_id,
    latitude: f.latitude,
    longitude: f.longitude,
    phone: f.phone,
    address_full: f.address_full,
    google_maps_url: f.google_maps_url,
    rating: f.rating,
    user_ratings_total: f.user_ratings_total,
    photo_reference: f.photo_reference,
    profile_jsonb: f.profile_jsonb ?? {},
  };
}

function applyCandidateToForm(
  prev: FormState,
  c: VenueEnrichmentCandidate,
): FormState {
  // Sticky merge — never overwrite a manually-typed value.
  return {
    ...prev,
    name: prev.name.trim() ? prev.name : c.name,
    address: prev.address.trim() ? prev.address : c.address_full ?? "",
    website: prev.website.trim() ? prev.website : c.website ?? "",
    google_place_id: prev.google_place_id ?? c.id,
    latitude: prev.latitude ?? c.latitude,
    longitude: prev.longitude ?? c.longitude,
    phone: prev.phone ?? c.phone,
    address_full: prev.address_full ?? c.address_full,
    google_maps_url: prev.google_maps_url ?? c.google_maps_url,
    rating: c.rating ?? prev.rating,
    user_ratings_total: c.user_ratings_total ?? prev.user_ratings_total,
    photo_reference: prev.photo_reference ?? c.photo_reference,
    profile_jsonb: c.raw,
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
  const [enrichmentEnabled, setEnrichmentEnabled] = useState<boolean>(false);
  const [reEnriching, setReEnriching] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/venues/enrichment-health", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const j = (await res.json()) as { enabled?: boolean };
        if (!cancelled) setEnrichmentEnabled(Boolean(j.enabled));
      } catch {
        if (!cancelled) setEnrichmentEnabled(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const reEnrichRow = async (id: string) => {
    setReEnriching(id);
    try {
      const res = await fetch(`/api/venues/${id}/enrich`, { method: "POST" });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      const j = (await res.json()) as { venue: VenueRow };
      setVenues((prev) => prev.map((v) => (v.id === id ? j.venue : v)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enrichment failed");
    } finally {
      setReEnriching(null);
    }
  };

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
                      {enrichmentEnabled &&
                        (v.enriched_at ? (
                          <span
                            className="inline-flex h-2 w-2 rounded-full bg-emerald-500"
                            title={`Enriched ${new Date(
                              v.enriched_at,
                            ).toLocaleDateString(undefined, {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })}`}
                            aria-label="Enriched"
                          />
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void reEnrichRow(v.id)}
                            disabled={reEnriching === v.id}
                            aria-label="Enrich"
                            title="Enrich from Google Places"
                          >
                            {reEnriching === v.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Sparkles className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        ))}
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
            {enrichmentEnabled && (
              <VenueEnrichmentSearch
                seed={[editing.name, editing.city].filter(Boolean).join(" ")}
                onPick={(c) =>
                  setEditing((prev) => (prev ? applyCandidateToForm(prev, c) : prev))
                }
              />
            )}
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

/**
 * Search Google Places (UK-biased) from inside the venue slide-over.
 * Renders up to 5 candidate cards; "Use" hands the picked candidate
 * back to the parent which sticky-merges it into the form (manual
 * values always win).
 */
function VenueEnrichmentSearch({
  seed,
  onPick,
}: {
  seed: string;
  onPick: (candidate: VenueEnrichmentCandidate) => void;
}) {
  const [q, setQ] = useState(seed);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<VenueEnrichmentCandidate[] | null>(
    null,
  );

  useEffect(() => {
    setQ(seed);
    setCandidates(null);
    setError(null);
  }, [seed]);

  const submit = async () => {
    const query = q.trim();
    if (!query) return;
    setLoading(true);
    setError(null);
    setCandidates(null);
    try {
      const res = await fetch("/api/venues/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: query }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        if (j?.error === "VENUE_ENRICHMENT_DISABLED") {
          throw new Error(
            "Enrichment is disabled. Ask the admin to add GOOGLE_PLACES_API_KEY.",
          );
        }
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      const j = (await res.json()) as { candidates: VenueEnrichmentCandidate[] };
      setCandidates(j.candidates ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-md border border-dashed border-border bg-muted/30 p-3">
      <p className="mb-2 inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Sparkles className="h-3 w-3" />
        Search Google Places (UK-biased)
      </p>
      <div className="flex items-center gap-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="e.g. FOLD London"
          className="h-8 flex-1 rounded border border-border-strong bg-background px-2 text-sm focus:border-primary focus:outline-none"
        />
        <Button size="sm" onClick={() => void submit()} disabled={loading || !q.trim()}>
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Search className="h-3.5 w-3.5" />
          )}
          Search
        </Button>
      </div>
      {error && <p className="mt-2 text-[11px] text-destructive">{error}</p>}
      {candidates && candidates.length === 0 && !error && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          No matches. Try a different spelling.
        </p>
      )}
      {candidates && candidates.length > 0 && (
        <ul className="mt-2 space-y-2">
          {candidates.map((c) => (
            <li
              key={c.id}
              className="flex items-start gap-3 rounded border border-border bg-card p-2"
            >
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{c.name}</p>
                {c.address_full && (
                  <p className="truncate text-[11px] text-muted-foreground">
                    {c.address_full}
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground/80">
                  {c.rating != null
                    ? `★ ${c.rating.toFixed(1)} (${(c.user_ratings_total ?? 0).toLocaleString()})`
                    : "no rating yet"}
                  {c.phone ? ` · ${c.phone}` : ""}
                </p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => onPick(c)}>
                <Check className="h-3.5 w-3.5" />
                Use
              </Button>
            </li>
          ))}
        </ul>
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
