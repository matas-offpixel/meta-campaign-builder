"use client";

import { useEffect, useMemo, useState } from "react";
import { GripVertical, Loader2, Plus, Search, Star, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ArtistRow, EventArtistJoined } from "@/lib/types/intelligence";

const GENRES = [
  "Melodic Techno",
  "Afro House",
  "House",
  "Techno",
  "Drum & Bass",
  "Garage",
  "Disco",
  "Hip-Hop",
  "R&B",
];

export function EventArtistRosterPanel({ eventId }: { eventId: string }) {
  const [rows, setRows] = useState<EventArtistJoined[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/artists`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { artists: EventArtistJoined[] };
      setRows(
        (j.artists ?? []).slice().sort((a, b) => a.billing_order - b.billing_order),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load roster");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const linkedIds = useMemo(() => new Set(rows.map((r) => r.artist_id)), [rows]);

  const toggleHeadliner = async (row: EventArtistJoined) => {
    const next = !row.is_headliner;
    setRows((prev) =>
      prev.map((r) => (r.id === row.id ? { ...r, is_headliner: next } : r)),
    );
    try {
      const res = await fetch(`/api/events/${eventId}/artists`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          artistId: row.artist_id,
          isHeadliner: next,
          billingOrder: row.billing_order,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle");
      void load();
    }
  };

  const remove = async (row: EventArtistJoined) => {
    setRows((prev) => prev.filter((r) => r.id !== row.id));
    try {
      const res = await fetch(`/api/events/${eventId}/artists`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artistId: row.artist_id }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove");
      void load();
    }
  };

  const persistOrder = async (ordered: EventArtistJoined[]) => {
    try {
      await Promise.all(
        ordered.map((r, idx) =>
          fetch(`/api/events/${eventId}/artists`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              artistId: r.artist_id,
              isHeadliner: r.is_headliner,
              billingOrder: idx,
            }),
          }),
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reorder");
      void load();
    }
  };

  const handleDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) {
      setDragId(null);
      return;
    }
    const fromIdx = rows.findIndex((r) => r.id === dragId);
    const toIdx = rows.findIndex((r) => r.id === targetId);
    if (fromIdx < 0 || toIdx < 0) {
      setDragId(null);
      return;
    }
    const next = rows.slice();
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    const renumbered = next.map((r, idx) => ({ ...r, billing_order: idx }));
    setRows(renumbered);
    setDragId(null);
    void persistOrder(renumbered);
  };

  return (
    <section className="rounded-md border border-border bg-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-heading text-base tracking-wide">Artist roster</h2>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setPickerOpen(true)}
          disabled={loading}
        >
          <Plus className="h-3.5 w-3.5" />
          Add artist
        </Button>
      </div>

      {error && (
        <div className="mb-3 rounded border border-destructive bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading roster…
        </div>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No artists linked. Roster powers genre roll-ups, lookalikes, and
          fan cross-promotion.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded border border-border">
          {rows.map((row) => (
            <li
              key={row.id}
              draggable
              onDragStart={() => setDragId(row.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(row.id)}
              className={`flex items-center gap-2 px-3 py-2 ${
                dragId === row.id ? "opacity-50" : ""
              }`}
            >
              <button
                type="button"
                aria-label="Drag to reorder"
                className="cursor-grab text-muted-foreground hover:text-foreground"
              >
                <GripVertical className="h-3.5 w-3.5" />
              </button>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  {row.is_headliner && (
                    <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                  )}
                  <span className="truncate">{row.artist_name}</span>
                </p>
                {row.genres.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {row.genres.map((g) => (
                      <span
                        key={g}
                        className="rounded-full border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground"
                      >
                        {g}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={row.is_headliner}
                  onChange={() => void toggleHeadliner(row)}
                  className="h-3.5 w-3.5"
                />
                Headliner
              </label>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void remove(row)}
                aria-label="Remove artist"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {pickerOpen && (
        <ArtistPickerModal
          excludeIds={linkedIds}
          onClose={() => setPickerOpen(false)}
          onPick={async (artistId) => {
            try {
              const res = await fetch(`/api/events/${eventId}/artists`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  artistId,
                  isHeadliner: false,
                  billingOrder: rows.length,
                }),
              });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              setPickerOpen(false);
              void load();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Failed to add");
            }
          }}
        />
      )}
    </section>
  );
}

// ─── Modal ─────────────────────────────────────────────────────────────────

function ArtistPickerModal({
  excludeIds,
  onClose,
  onPick,
}: {
  excludeIds: Set<string>;
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  const [artists, setArtists] = useState<ArtistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createGenres, setCreateGenres] = useState<string[]>([]);
  const [createInstagram, setCreateInstagram] = useState("");
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/artists", { cache: "no-store" });
      if (!res.ok) return;
      const j = (await res.json()) as { artists: ArtistRow[] };
      setArtists(j.artists ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = artists
    .filter((a) => !excludeIds.has(a.id))
    .filter((a) => {
      if (!query.trim()) return true;
      const needle = query.trim().toLowerCase();
      return (
        a.name.toLowerCase().includes(needle) ||
        a.genres.some((g) => g.toLowerCase().includes(needle))
      );
    });

  const submitCreate = async () => {
    const name = createName.trim();
    if (!name) return;
    setSaving(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/artists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          genres: createGenres,
          instagram_handle: createInstagram.trim() || null,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      const j = (await res.json()) as { artist: ArtistRow };
      onPick(j.artist.id);
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : "Failed to create artist",
      );
    } finally {
      setSaving(false);
    }
  };

  const toggleGenre = (g: string) => {
    setCreateGenres((prev) =>
      prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g],
    );
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-md border border-border bg-card p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-heading text-sm tracking-wide">Add artist</h3>
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
                placeholder="Search artists…"
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
                  No artists match.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {filtered.map((a) => (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => onPick(a.id)}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-muted"
                      >
                        <span className="truncate font-medium">{a.name}</span>
                        <span className="truncate text-muted-foreground">
                          {a.genres.join(" · ")}
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
                Create new artist
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
              label="Instagram handle"
              placeholder="@artist"
              value={createInstagram}
              onChange={(e) => setCreateInstagram(e.target.value)}
            />
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                Genres
              </p>
              <div className="flex flex-wrap gap-1">
                {GENRES.map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => toggleGenre(g)}
                    className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${
                      createGenres.includes(g)
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border text-muted-foreground hover:border-border-strong"
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>
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
                disabled={saving || !createName.trim()}
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Create + add
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
