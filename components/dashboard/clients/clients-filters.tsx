"use client";

import { useSearchParams } from "next/navigation";
import { SearchInput } from "@/components/dashboard/_shared/search-input";
import { useWriteParams } from "@/components/dashboard/_shared/use-write-params";
import { CLIENT_STATUSES } from "@/lib/db/clients";

/**
 * Filter strip rendered above the /clients list. Reuses the shared
 * SearchInput + useWriteParams primitives from slice 2 so URL conventions
 * stay consistent across dashboard list views.
 */
export function ClientsFilters() {
  const searchParams = useSearchParams();
  const { writeParams } = useWriteParams();

  const status = searchParams.get("status") ?? "";
  const q = searchParams.get("q") ?? "";

  const setStatus = (next: string) =>
    writeParams((p) => {
      if (!next) p.delete("status");
      else p.set("status", next);
    });

  const setQuery = (next: string) =>
    writeParams((p) => {
      const trimmed = next.trim();
      if (trimmed === "") p.delete("q");
      else p.set("q", trimmed);
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={status}
        onChange={(e) => setStatus(e.target.value)}
        aria-label="Filter by status"
        className="rounded-md border border-border bg-card px-2 py-1.5 text-xs focus:border-border-strong focus:outline-none"
      >
        <option value="">All statuses</option>
        {CLIENT_STATUSES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>

      <SearchInput
        initialQuery={q}
        writeQuery={setQuery}
        placeholder="Search by name…"
        ariaLabel="Search clients"
      />
    </div>
  );
}
