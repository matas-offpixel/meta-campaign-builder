"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Save, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  ArtistRow,
  AudienceQueryResponse,
  AudienceSeedFilters,
  AudienceSeedRow,
  VenueRow,
} from "@/lib/types/intelligence";

// Inline genres list: lib/genre-classification.ts is keyed off a different
// taxonomy (Meta page buckets) and isn't a fit for event-level free-text
// genres. Keeping this short + portfolio-relevant per the brief.
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

interface EventOption {
  id: string;
  name: string;
  event_date: string | null;
  client_name: string | null;
}

/** Local filter state — mirror of AudienceSeedFilters with non-nullable arrays. */
interface FilterState {
  eventIds: string[];
  artistIds: string[];
  venueIds: string[];
  genres: string[];
  dateFrom: string;
  dateTo: string;
}

const EMPTY_FILTERS: FilterState = {
  eventIds: [],
  artistIds: [],
  venueIds: [],
  genres: [],
  dateFrom: "",
  dateTo: "",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function AudienceBuilderPage() {
  // ── Picker source data (single fetch on mount) ───────────────────────────
  const [events, setEvents] = useState<EventOption[]>([]);
  const [artists, setArtists] = useState<ArtistRow[]>([]);
  const [venues, setVenues] = useState<VenueRow[]>([]);
  const [seeds, setSeeds] = useState<AudienceSeedRow[]>([]);
  const [pickerError, setPickerError] = useState<string | null>(null);

  // ── Filter + result state ────────────────────────────────────────────────
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [results, setResults] = useState<AudienceQueryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Save-seed inline form ────────────────────────────────────────────────
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [seedName, setSeedName] = useState("");
  const [savingSeed, setSavingSeed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadPickers() {
      try {
        const [evRes, arRes, vnRes, sdRes] = await Promise.all([
          fetch("/api/events", { cache: "no-store" }),
          fetch("/api/artists", { cache: "no-store" }),
          fetch("/api/venues", { cache: "no-store" }),
          fetch("/api/intelligence/audiences/seeds", { cache: "no-store" }),
        ]);
        if (cancelled) return;
        if (evRes.ok) {
          const j = (await evRes.json()) as { events: EventOption[] };
          setEvents(j.events ?? []);
        }
        if (arRes.ok) {
          const j = (await arRes.json()) as { artists: ArtistRow[] };
          setArtists(j.artists ?? []);
        }
        if (vnRes.ok) {
          const j = (await vnRes.json()) as { venues: VenueRow[] };
          setVenues(j.venues ?? []);
        }
        if (sdRes.ok) {
          const j = (await sdRes.json()) as { seeds: AudienceSeedRow[] };
          setSeeds(j.seeds ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          setPickerError(
            err instanceof Error ? err.message : "Failed to load filters",
          );
        }
      }
    }
    void loadPickers();
    return () => {
      cancelled = true;
    };
  }, []);

  const buildAudience = async () => {
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams();
      if (filters.eventIds.length) sp.set("eventIds", filters.eventIds.join(","));
      if (filters.artistIds.length) sp.set("artistIds", filters.artistIds.join(","));
      if (filters.venueIds.length) sp.set("venueIds", filters.venueIds.join(","));
      if (filters.genres.length) sp.set("genres", filters.genres.join(","));
      if (filters.dateFrom) sp.set("dateFrom", filters.dateFrom);
      if (filters.dateTo) sp.set("dateTo", filters.dateTo);

      const res = await fetch(`/api/intelligence/audiences?${sp.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      const j = (await res.json()) as AudienceQueryResponse;
      setResults(j);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to build audience");
    } finally {
      setLoading(false);
    }
  };

  const saveSeed = async () => {
    const name = seedName.trim();
    if (!name) return;
    setSavingSeed(true);
    try {
      const payloadFilters: AudienceSeedFilters = {
        eventIds: filters.eventIds,
        artistIds: filters.artistIds,
        venueIds: filters.venueIds,
        genres: filters.genres,
        dateFrom: filters.dateFrom || null,
        dateTo: filters.dateTo || null,
      };
      const res = await fetch("/api/intelligence/audiences/seeds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, filters: payloadFilters }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      const j = (await res.json()) as { seed: AudienceSeedRow };
      setSeeds((prev) => [j.seed, ...prev]);
      setSeedName("");
      setShowSaveForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save seed");
    } finally {
      setSavingSeed(false);
    }
  };

  const deleteSeed = async (id: string) => {
    if (!confirm("Delete this saved audience?")) return;
    try {
      const res = await fetch(`/api/intelligence/audiences/seeds/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSeeds((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete seed");
    }
  };

  const restoreSeed = (seed: AudienceSeedRow) => {
    const f = seed.filters ?? {};
    setFilters({
      eventIds: f.eventIds ?? [],
      artistIds: f.artistIds ?? [],
      venueIds: f.venueIds ?? [],
      genres: f.genres ?? [],
      dateFrom: f.dateFrom ?? "",
      dateTo: f.dateTo ?? "",
    });
    setResults(null);
  };

  const totalGenreCount = useMemo(
    () =>
      results
        ? Object.values(results.genreBreakdown).reduce((a, b) => a + b, 0)
        : 0,
    [results],
  );
  const totalGeoCount = useMemo(
    () =>
      results
        ? Object.values(results.geoBreakdown).reduce((a, b) => a + b, 0)
        : 0,
    [results],
  );

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
      {/* ── Filters ─────────────────────────────────────────────────── */}
      <aside className="space-y-5">
        {pickerError && (
          <div className="rounded-md border border-destructive bg-destructive/10 p-3 text-xs text-destructive">
            {pickerError}
          </div>
        )}

        <FilterMultiSelect
          label="Events"
          values={filters.eventIds}
          onChange={(vals) => setFilters((f) => ({ ...f, eventIds: vals }))}
          options={events.map((e) => ({
            value: e.id,
            label: e.client_name
              ? `${e.name} · ${e.client_name}${
                  e.event_date ? ` · ${fmtDate(e.event_date)}` : ""
                }`
              : e.name,
          }))}
        />

        <FilterMultiSelect
          label="Artists"
          values={filters.artistIds}
          onChange={(vals) => setFilters((f) => ({ ...f, artistIds: vals }))}
          options={artists.map((a) => ({ value: a.id, label: a.name }))}
        />

        <FilterMultiSelect
          label="Venues"
          values={filters.venueIds}
          onChange={(vals) => setFilters((f) => ({ ...f, venueIds: vals }))}
          options={venues.map((v) => ({
            value: v.id,
            label: `${v.name} · ${v.city}`,
          }))}
        />

        <FilterMultiSelect
          label="Genres"
          values={filters.genres}
          onChange={(vals) => setFilters((f) => ({ ...f, genres: vals }))}
          options={GENRES.map((g) => ({ value: g, label: g }))}
        />

        <div className="grid grid-cols-2 gap-2">
          <Input
            label="From"
            type="date"
            value={filters.dateFrom}
            onChange={(e) =>
              setFilters((f) => ({ ...f, dateFrom: e.target.value }))
            }
          />
          <Input
            label="To"
            type="date"
            value={filters.dateTo}
            onChange={(e) =>
              setFilters((f) => ({ ...f, dateTo: e.target.value }))
            }
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={buildAudience}
            disabled={loading}
            size="sm"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : null}
            Build audience
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFilters(EMPTY_FILTERS);
              setResults(null);
            }}
            disabled={loading}
          >
            Reset
          </Button>
        </div>

        {/* ── Saved seeds ────────────────────────────────────────────── */}
        <section className="rounded-md border border-border bg-card p-4">
          <h3 className="mb-2 font-heading text-sm tracking-wide">
            Saved audiences
          </h3>
          {seeds.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Save a filter set after building an audience to recall it later.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {seeds.map((s) => (
                <li
                  key={s.id}
                  className="flex items-start justify-between gap-2 rounded border border-border px-2 py-1.5"
                >
                  <button
                    type="button"
                    className="flex-1 truncate text-left text-xs hover:text-foreground"
                    onClick={() => restoreSeed(s)}
                    title="Restore filters"
                  >
                    {s.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteSeed(s.id)}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label="Delete seed"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>

      {/* ── Results ─────────────────────────────────────────────────── */}
      <section className="space-y-4">
        {error && (
          <div className="rounded-md border border-destructive bg-destructive/10 p-3 text-xs text-destructive">
            {error}
          </div>
        )}

        {!results && !loading && (
          <div className="flex h-72 items-center justify-center rounded-md border border-dashed border-border bg-card text-sm text-muted-foreground">
            Select filters and click <span className="mx-1 font-medium">Build audience</span> to explore your event portfolio.
          </div>
        )}

        {loading && (
          <div className="flex h-72 items-center justify-center rounded-md border border-border bg-card text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Building audience…
          </div>
        )}

        {results && !loading && (
          <>
            <div className="rounded-md border border-border bg-card px-4 py-3 text-sm">
              <span className="font-medium">{results.events.length}</span>{" "}
              event{results.events.length === 1 ? "" : "s"} matched ·{" "}
              <span className="font-medium">
                {results.totalCapacity.toLocaleString()}
              </span>{" "}
              total capacity
              {filters.dateFrom || filters.dateTo
                ? ` · ${filters.dateFrom || "…"} → ${filters.dateTo || "…"}`
                : ""}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {!showSaveForm ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowSaveForm(true)}
                  >
                    <Save className="h-3.5 w-3.5" />
                    Save seed
                  </Button>
                ) : (
                  <>
                    <Input
                      placeholder="Seed name"
                      value={seedName}
                      onChange={(e) => setSeedName(e.target.value)}
                      className="h-8 max-w-xs"
                    />
                    <Button
                      size="sm"
                      onClick={() => void saveSeed()}
                      disabled={savingSeed || !seedName.trim()}
                    >
                      {savingSeed ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : null}
                      Save
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setShowSaveForm(false);
                        setSeedName("");
                      }}
                    >
                      Cancel
                    </Button>
                  </>
                )}
              </div>
            </div>

            <EventsTable rows={results.events} />

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <BreakdownCard
                title="Genre breakdown"
                data={results.genreBreakdown}
                total={totalGenreCount}
              />
              <BreakdownCard
                title="City breakdown"
                data={results.geoBreakdown}
                total={totalGeoCount}
              />
            </div>
          </>
        )}
      </section>
    </div>
  );
}

// ─── Pieces ────────────────────────────────────────────────────────────────

function FilterMultiSelect({
  label,
  values,
  onChange,
  options,
}: {
  label: string;
  values: string[];
  onChange: (vals: string[]) => void;
  options: { value: string; label: string }[];
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    if (!query.trim()) return options;
    const needle = query.trim().toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(needle));
  }, [options, query]);

  const selectedLabels = useMemo(
    () =>
      values
        .map((v) => options.find((o) => o.value === v)?.label ?? v)
        .filter(Boolean),
    [values, options],
  );

  const toggle = (val: string) => {
    if (values.includes(val)) onChange(values.filter((v) => v !== val));
    else onChange([...values, val]);
  };

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {values.length > 0 && (
          <button
            type="button"
            className="text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
            onClick={() => onChange([])}
          >
            Clear
          </button>
        )}
      </div>
      <div className="px-3 py-2 space-y-2">
        <input
          type="search"
          placeholder={`Search ${label.toLowerCase()}…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-8 w-full rounded border border-border bg-background px-2 text-xs focus:border-primary focus:outline-none"
        />
        {selectedLabels.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {values.map((v) => {
              const lbl = options.find((o) => o.value === v)?.label ?? v;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => toggle(v)}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] hover:border-border-strong"
                >
                  <span className="max-w-[140px] truncate">{lbl}</span>
                  <X className="h-3 w-3" />
                </button>
              );
            })}
          </div>
        )}
        <div className="max-h-48 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="py-2 text-center text-[11px] text-muted-foreground">
              No options.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {filtered.map((opt) => {
                const checked = values.includes(opt.value);
                return (
                  <li key={opt.value}>
                    <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-muted">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(opt.value)}
                        className="h-3.5 w-3.5"
                      />
                      <span className="truncate">{opt.label}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function EventsTable({
  rows,
}: {
  rows: AudienceQueryResponse["events"];
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
        No events match the current filters.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-card">
      <table className="w-full text-xs">
        <thead className="border-b border-border bg-muted/30">
          <tr className="text-left text-muted-foreground">
            <th className="px-3 py-2 font-medium">Event</th>
            <th className="px-3 py-2 font-medium">Client</th>
            <th className="px-3 py-2 font-medium">Date</th>
            <th className="px-3 py-2 font-medium">Venue</th>
            <th className="px-3 py-2 font-medium text-right">Capacity</th>
            <th className="px-3 py-2 font-medium">Genres</th>
            <th className="px-3 py-2 font-medium">Artists</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id} className="border-b border-border last:border-0">
              <td className="px-3 py-2 align-top font-medium">{e.name}</td>
              <td className="px-3 py-2 align-top text-muted-foreground">
                {e.client_name ?? "—"}
              </td>
              <td className="px-3 py-2 align-top text-muted-foreground">
                {fmtDate(e.event_date)}
              </td>
              <td className="px-3 py-2 align-top text-muted-foreground">
                {e.venue_name ?? "—"}
                {e.venue_city ? (
                  <span className="text-muted-foreground/60"> · {e.venue_city}</span>
                ) : null}
              </td>
              <td className="px-3 py-2 align-top text-right">
                {e.capacity != null ? e.capacity.toLocaleString() : "—"}
              </td>
              <td className="px-3 py-2 align-top text-muted-foreground">
                {e.genres.length > 0 ? e.genres.join(", ") : "—"}
              </td>
              <td className="px-3 py-2 align-top">
                {e.artists.length === 0 ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className="text-muted-foreground">
                    {e.artists.map((a, i) => (
                      <span key={`${a.name}-${i}`}>
                        {i > 0 ? ", " : ""}
                        <span
                          className={a.isHeadliner ? "font-semibold text-foreground" : ""}
                        >
                          {a.name}
                        </span>
                      </span>
                    ))}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BreakdownCard({
  title,
  data,
  total,
}: {
  title: string;
  data: Record<string, number>;
  total: number;
}) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  return (
    <section className="rounded-md border border-border bg-card p-4">
      <h3 className="mb-3 font-heading text-sm tracking-wide">{title}</h3>
      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">No data.</p>
      ) : (
        <ul className="space-y-1.5">
          {entries.map(([key, count]) => {
            const pct = total > 0 ? Math.round((count / total) * 100) : 0;
            return (
              <li key={key} className="text-xs">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate">{key}</span>
                  <span className="text-muted-foreground">
                    {count} · {pct}%
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-muted">
                  <div
                    className="h-full bg-primary"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
