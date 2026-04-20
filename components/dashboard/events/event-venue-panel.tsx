"use client";

import { useEffect, useState } from "react";
import { Loader2, MapPin, Plus, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { VenueRow } from "@/lib/types/intelligence";

/**
 * Collapsible venue panel for the event detail page. Two modes:
 *   1. Linked    — show the venue card with an "Unlink" action.
 *   2. Unlinked  — show "Link venue" button which opens a searchable modal.
 *
 * The flat venue_name / venue_city columns on `events` stay editable
 * elsewhere (event edit page); this panel only owns the FK.
 */
export function EventVenuePanel({
  eventId,
  initialVenueId,
  fallbackName,
  fallbackCity,
}: {
  eventId: string;
  initialVenueId: string | null;
  fallbackName: string | null;
  fallbackCity: string | null;
}) {
  const [venueId, setVenueId] = useState<string | null>(initialVenueId);
  const [venue, setVenue] = useState<VenueRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!venueId) {
      setVenue(null);
      return;
    }
    setLoading(true);
    fetch(`/api/venues/${venueId}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = (await res.json()) as { venue: VenueRow };
        if (!cancelled) setVenue(j.venue);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load venue",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [venueId]);

  const link = async (id: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ venue_id: id }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setVenueId(id);
      setModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to link venue");
    }
  };

  const unlink = async () => {
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ venue_id: null }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setVenueId(null);
      setVenue(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unlink venue");
    }
  };

  return (
    <section className="rounded-md border border-border bg-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-heading text-base tracking-wide">Venue record</h2>
        {!venueId && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setModalOpen(true)}
          >
            <MapPin className="h-3.5 w-3.5" />
            Link venue
          </Button>
        )}
      </div>

      {error && (
        <div className="mb-3 rounded border border-destructive bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {!venueId ? (
        <p className="text-xs text-muted-foreground">
          {fallbackName
            ? `Currently using flat text: ${fallbackName}${
                fallbackCity ? `, ${fallbackCity}` : ""
              }. Link a venue record to unlock cross-event analytics.`
            : "No venue linked. Link a venue record so this event flows into venue rollups."}
        </p>
      ) : loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading venue…
        </div>
      ) : venue ? (
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1 text-sm">
            <p className="font-medium">{venue.name}</p>
            <p className="text-xs text-muted-foreground">
              {venue.city}
              {venue.country ? `, ${venue.country}` : ""}
              {venue.capacity != null
                ? ` · ${venue.capacity.toLocaleString()} cap`
                : ""}
            </p>
            {venue.meta_page_name && (
              <p className="text-[11px] text-muted-foreground">
                Meta page: {venue.meta_page_name}
              </p>
            )}
            {venue.website && (
              <a
                href={venue.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                {venue.website}
              </a>
            )}
          </div>
          <Button size="sm" variant="ghost" onClick={() => void unlink()}>
            <X className="h-3.5 w-3.5" />
            Unlink
          </Button>
        </div>
      ) : null}

      {modalOpen && (
        <VenuePickerModal
          onClose={() => setModalOpen(false)}
          onPick={(id) => void link(id)}
        />
      )}
    </section>
  );
}

// ─── Modal ─────────────────────────────────────────────────────────────────

function VenuePickerModal({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  const [venues, setVenues] = useState<VenueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createCity, setCreateCity] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/venues", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return;
        const j = (await res.json()) as { venues: VenueRow[] };
        setVenues(j.venues ?? []);
      })
      .finally(() => setLoading(false));
  }, []);

  const filtered = venues.filter((v) => {
    if (!query.trim()) return true;
    const needle = query.trim().toLowerCase();
    return (
      v.name.toLowerCase().includes(needle) ||
      v.city.toLowerCase().includes(needle)
    );
  });

  const submitCreate = async () => {
    const name = createName.trim();
    const city = createCity.trim();
    if (!name || !city) return;
    setSaving(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/venues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, city }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      const j = (await res.json()) as { venue: VenueRow };
      onPick(j.venue.id);
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : "Failed to create venue",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-md border border-border bg-card p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-heading text-sm tracking-wide">Link venue</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {!creating ? (
          <>
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                placeholder="Search venues…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-9 w-full rounded border border-border-strong bg-background pl-8 pr-2 text-sm focus:border-primary focus:outline-none"
                autoFocus
              />
            </div>

            <div className="max-h-80 overflow-y-auto rounded border border-border">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading…
                </div>
              ) : filtered.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  No venues match.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {filtered.map((v) => (
                    <li key={v.id}>
                      <button
                        type="button"
                        onClick={() => onPick(v.id)}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-muted"
                      >
                        <span className="truncate font-medium">{v.name}</span>
                        <span className="truncate text-muted-foreground">
                          {v.city}
                          {v.capacity != null ? ` · ${v.capacity.toLocaleString()}` : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="mt-3 flex justify-end">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setCreating(true)}
              >
                <Plus className="h-3.5 w-3.5" />
                Create new venue
              </Button>
            </div>
          </>
        ) : (
          <div className="space-y-2">
            <Input
              label="Name"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
            />
            <Input
              label="City"
              value={createCity}
              onChange={(e) => setCreateCity(e.target.value)}
            />
            {createError && (
              <p className="text-xs text-destructive">{createError}</p>
            )}
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setCreating(false)}
                disabled={saving}
              >
                Back
              </Button>
              <Button
                size="sm"
                onClick={() => void submitCreate()}
                disabled={saving || !createName.trim() || !createCity.trim()}
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Create + link
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
