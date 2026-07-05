/**
 * lib/admin/pages-list.ts
 *
 * Pure filter/sort seam for the OP909 Pages list + the copy-to-clipboard
 * state machine. No React, no DOM — pinned by node:test under the
 * react-server condition (see lib/admin/__tests__/pages-list.test.ts).
 */

export type PageSortKey = "created" | "presale" | "edited" | "signups";

export const PAGE_SORT_OPTIONS: ReadonlyArray<{
  key: PageSortKey;
  label: string;
}> = [
  { key: "created", label: "created" },
  { key: "presale", label: "presale" },
  { key: "edited", label: "last edited" },
  { key: "signups", label: "signups" },
];

export interface PagesListItem {
  pageEventId: string;
  eventName: string;
  eventSlug: string;
  status: string;
  artworkUrl: string | null;
  presaleAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  signupCount: number;
}

export interface PagesListFilters {
  search: string;
  sort: PageSortKey;
  hidePast: boolean;
}

export const DEFAULT_PAGES_FILTERS: PagesListFilters = {
  search: "",
  sort: "presale",
  hidePast: false,
};

/** Parseable ms epoch for an ISO string, or null. */
function ms(iso: string | null): number | null {
  if (!iso) return null;
  const n = Date.parse(iso);
  return Number.isNaN(n) ? null : n;
}

/** Descending ISO comparator — nulls sink to the bottom. */
function byIsoDesc(a: string | null, b: string | null): number {
  const av = ms(a);
  const bv = ms(b);
  if (av === null && bv === null) return 0;
  if (av === null) return 1;
  if (bv === null) return -1;
  return bv - av;
}

/**
 * Apply the search box, hide-past toggle, and sort. "Past" = a presale date
 * strictly before `nowMs`; undated pages (null presale) are never hidden.
 * Stable, non-mutating.
 */
export function filterAndSortPages(
  items: readonly PagesListItem[],
  filters: PagesListFilters,
  nowMs: number = Date.now(),
): PagesListItem[] {
  const q = filters.search.trim().toLowerCase();

  const filtered = items.filter((item) => {
    if (q) {
      const hay = `${item.eventName} ${item.eventSlug}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (filters.hidePast) {
      const presale = ms(item.presaleAt);
      if (presale !== null && presale < nowMs) return false;
    }
    return true;
  });

  const sorted = [...filtered];
  switch (filters.sort) {
    case "created":
      sorted.sort((a, b) => byIsoDesc(a.createdAt, b.createdAt));
      break;
    case "presale":
      sorted.sort((a, b) => byIsoDesc(a.presaleAt, b.presaleAt));
      break;
    case "edited":
      sorted.sort((a, b) => byIsoDesc(a.updatedAt, b.updatedAt));
      break;
    case "signups":
      sorted.sort((a, b) => b.signupCount - a.signupCount);
      break;
  }
  return sorted;
}

// ─── copy-to-clipboard state machine ─────────────────────────────────────

export type CopyState = "idle" | "copied";

/** Full fan-facing URL for a page path, given the current origin. */
export function fanUrl(origin: string, clientSlug: string, eventSlug: string) {
  const trimmed = origin.replace(/\/+$/, "");
  return `${trimmed}/l/${clientSlug}/${eventSlug}`;
}

/** Path shown under the title (origin-relative). */
export function fanPath(clientSlug: string, eventSlug: string) {
  return `/l/${clientSlug}/${eventSlug}`;
}

/** Label to show on the copy affordance for a given state. */
export function copyLabel(state: CopyState, path: string): string {
  return state === "copied" ? "Copied" : path;
}
