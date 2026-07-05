"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";

import {
  DEFAULT_PAGES_FILTERS,
  filterAndSortPages,
  PAGE_SORT_OPTIONS,
  type PageSortKey,
  type PagesListItem,
} from "@/lib/admin/pages-list";
import { AdminLinkButton } from "./ui/button";
import { PagesListRow } from "./pages-list-row";

const ROWS_PER_PAGE_OPTIONS = [10, 25, 50] as const;

/**
 * components/admin/pages-list.tsx
 *
 * Interactive Pages list shell (OP909 Sprint 1): search + sort + hide-past
 * toolbar, hairline rows, offset pagination. All filtering/sorting delegates
 * to the pure filterAndSortPages seam (tested); this only holds UI state.
 */
export function PagesList({
  items,
  clientSlug,
  origin,
  accent,
  boxLogoText,
}: {
  items: PagesListItem[];
  clientSlug: string;
  origin: string;
  accent: string;
  boxLogoText: string;
}) {
  const [search, setSearch] = useState(DEFAULT_PAGES_FILTERS.search);
  const [sort, setSort] = useState<PageSortKey>(DEFAULT_PAGES_FILTERS.sort);
  const [hidePast, setHidePast] = useState(DEFAULT_PAGES_FILTERS.hidePast);
  const [rowsPerPage, setRowsPerPage] = useState<number>(10);
  const [page, setPage] = useState(0);

  const filtered = useMemo(
    () => filterAndSortPages(items, { search, sort, hidePast }),
    [items, search, sort, hidePast],
  );

  const total = items.length;
  const shown = filtered.length;
  const pageCount = Math.max(1, Math.ceil(shown / rowsPerPage));
  const clampedPage = Math.min(page, pageCount - 1);
  const start = clampedPage * rowsPerPage;
  const visible = filtered.slice(start, start + rowsPerPage);
  const rangeEnd = Math.min(start + rowsPerPage, shown);

  const inputCls =
    "font-[family-name:var(--admin-mono)] text-[12px] border-[0.5px] border-black bg-white px-2.5 py-1.5";

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 border-b-[0.5px] border-black pb-4">
        <input
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          placeholder="search pages…"
          className={`${inputCls} w-52`}
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as PageSortKey)}
          className={inputCls}
          aria-label="Sort pages"
        >
          {PAGE_SORT_OPTIONS.map((opt) => (
            <option key={opt.key} value={opt.key}>
              sort: {opt.label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 font-[family-name:var(--admin-mono)] text-[12px] text-[#666]">
          <input
            type="checkbox"
            checked={hidePast}
            onChange={(e) => {
              setHidePast(e.target.checked);
              setPage(0);
            }}
          />
          hide past events
        </label>

        <div className="ml-auto flex items-center gap-4">
          <span className="font-[family-name:var(--admin-mono)] text-[11px] text-[#666]">
            {shown} of {total} pages
          </span>
          <AdminLinkButton href={`/admin/${clientSlug}/pages/new`} accentFill={accent}>
            <Plus className="h-3.5 w-3.5" />
            new page
          </AdminLinkButton>
        </div>
      </div>

      {/* Rows */}
      {visible.length === 0 ? (
        <p className="py-14 text-center font-[family-name:var(--admin-mono)] text-[12px] text-[#999]">
          No pages match your filters.
        </p>
      ) : (
        <div>
          {visible.map((item) => (
            <PagesListRow
              key={item.pageEventId}
              page={item}
              clientSlug={clientSlug}
              origin={origin}
              accent={accent}
              boxLogoText={boxLogoText}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 font-[family-name:var(--admin-mono)] text-[11px] text-[#666]">
        <label className="flex items-center gap-2">
          rows per page
          <select
            value={rowsPerPage}
            onChange={(e) => {
              setRowsPerPage(Number(e.target.value));
              setPage(0);
            }}
            className="border-[0.5px] border-black bg-white px-1.5 py-1"
          >
            {ROWS_PER_PAGE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-3">
          <span>
            {shown === 0 ? 0 : start + 1}–{rangeEnd} of {shown}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={clampedPage === 0}
            className="px-2 py-1 hover:text-black disabled:opacity-30 disabled:pointer-events-none"
          >
            prev
          </button>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={clampedPage >= pageCount - 1}
            className="px-2 py-1 hover:text-black disabled:opacity-30 disabled:pointer-events-none"
          >
            next
          </button>
        </div>
      </div>
    </div>
  );
}
