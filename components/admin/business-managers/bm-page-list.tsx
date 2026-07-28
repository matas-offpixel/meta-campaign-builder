"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ShieldCheck, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PAGE_PERMITTED_TASKS, PAGE_TASKS_NEVER_GRANTED } from "@/lib/bm/page-tasks";
import type { BMPage } from "@/lib/bm/types";

/**
 * Per-page detail for one Business Manager, loaded on demand when an operator
 * expands a Pages row.
 *
 * Shows the operator's ACTUAL task list per page (migration 149) rather than a
 * derived verdict. That is deliberate: this arc set out to fix the wizard's
 * audience builder by granting a page task named `AUDIENCE_MANAGE`, and a live
 * capture proved no such task exists (see lib/bm/page-tasks.ts). Until the real
 * cause of subcode 1713140 is known, the honest thing to render is the evidence
 * — which pages hold which capabilities — plus what the last grant asked Meta
 * for, so the two can be compared.
 */

/** A very large BM (Columbo Group: ~1060 pages) would otherwise render 1000+ rows. */
const MAX_ROWS = 200;

interface Props {
  businessId: string;
  /** POSTs to `url` with an optional JSON body, then reports whether it succeeded. */
  onGrant: (key: string, url: string, body?: unknown) => Promise<boolean>;
  busyKey: string | null;
  disabled: boolean;
}

/** Pages the operator cannot act on at all come first, then by task count, then name. */
function byActionability(a: BMPage, b: BMPage): number {
  const score = (p: BMPage) => (p.user_has_access ? 1 : 0) * 100 + p.user_tasks.length;
  const diff = score(a) - score(b);
  if (diff !== 0) return diff;
  return (a.page_name ?? a.page_id).localeCompare(b.page_name ?? b.page_id);
}

function formatWhen(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 16).replace("T", " ") : iso;
}

export function BMPageList({ businessId, onGrant, busyKey, disabled }: Props) {
  const [pages, setPages] = useState<BMPage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  const grantable = useMemo(
    () => PAGE_PERMITTED_TASKS.filter((t) => !PAGE_TASKS_NEVER_GRANTED.includes(t)),
    [],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/business-managers/${businessId}/pages`, {
        cache: "no-store",
      });
      const body = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string; pages?: BMPage[] }
        | null;
      if (!res.ok || !body?.ok) {
        setError(body?.error ?? `Could not load pages (${res.status})`);
        setPages(null);
        return;
      }
      setPages([...(body.pages ?? [])].sort(byActionability));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setPages(null);
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && pages === null) {
    return <p className="px-4 py-3 text-xs text-muted-foreground">Loading…</p>;
  }
  if (error) {
    return (
      <div className="px-4 py-3 text-xs text-red-700">
        {error}{" "}
        <button type="button" className="underline" onClick={() => void load()}>
          Retry
        </button>
      </div>
    );
  }
  if (!pages || pages.length === 0) {
    return (
      <p className="px-4 py-3 text-xs text-muted-foreground">
        No pages found. Run <span className="font-medium">Sync now</span> to enumerate this
        Business Manager.
      </p>
    );
  }

  const visible = pages.slice(0, MAX_ROWS);
  const selectionKey = selected.join(",");
  const bulkKey = `granttasks:${businessId}:${selectionKey}`;

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Grant tasks
        </span>
        {grantable.map((task) => (
          <label key={task} className="flex items-center gap-1 text-[11px]">
            <input
              type="checkbox"
              className="h-3 w-3"
              checked={selected.includes(task)}
              onChange={(e) =>
                setSelected((prev) =>
                  e.target.checked ? [...prev, task] : prev.filter((t) => t !== task),
                )
              }
            />
            {task}
          </label>
        ))}
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          onClick={async () => {
            const ok = await onGrant(
              bulkKey,
              `/api/business-managers/${businessId}/pages/grant-tasks`,
              { tasks: selected },
            );
            if (ok) await load();
          }}
          disabled={selected.length === 0 || busyKey === bulkKey || disabled}
          title="Grant the selected tasks on every page in this BM that does not already hold them"
        >
          {busyKey === bulkKey ? "Granting…" : "Grant to all missing"}
        </Button>
      </div>

      <ul className="divide-y divide-border">
        {visible.map((page) => {
          const adKey = `grant:${businessId}:${page.page_id}`;
          const taskKey = `granttasks:${businessId}:${page.page_id}:${selectionKey}`;
          // The delta between what a grant asked for and what Meta reported is
          // the point of the audit columns — Meta expands some task grants and
          // silently drops others, so only showing it when they differ keeps
          // the row quiet in the ordinary case.
          const requested = page.last_grant_requested_tasks ?? [];
          const unreported = requested.filter((t) => !page.user_tasks.includes(t));
          return (
            <li
              key={page.page_id}
              className="flex items-start justify-between gap-3 px-4 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm">
                  {page.page_name ?? page.page_id}
                  {!page.is_owned_by_bm ? (
                    <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      shared in
                    </span>
                  ) : null}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {page.page_id}
                  {page.category ? ` · ${page.category}` : ""}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {page.user_tasks.length > 0
                    ? `tasks: ${page.user_tasks.join(", ")}`
                    : "tasks: none reported by Meta"}
                </p>
                {unreported.length > 0 ? (
                  <p className="truncate text-[11px] text-amber-700">
                    requested {unreported.join(", ")} on {formatWhen(page.last_grant_at)} — not
                    reported back by Meta
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {page.user_has_access ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
                    <ShieldCheck className="h-3.5 w-3.5" /> Access
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      const ok = await onGrant(
                        adKey,
                        `/api/business-managers/${businessId}/pages/${page.page_id}/grant`,
                      );
                      if (ok) await load();
                    }}
                    disabled={busyKey === adKey || disabled}
                  >
                    <ShieldAlert className="h-3.5 w-3.5" />
                    {busyKey === adKey ? "Granting…" : "Grant ads"}
                  </Button>
                )}
                {selected.length > 0 &&
                selected.some((t) => !page.user_tasks.includes(t)) ? (
                  <Button
                    size="sm"
                    onClick={async () => {
                      const ok = await onGrant(
                        taskKey,
                        `/api/business-managers/${businessId}/pages/${page.page_id}/grant-tasks`,
                        { tasks: selected },
                      );
                      if (ok) await load();
                    }}
                    disabled={busyKey === taskKey || disabled}
                  >
                    {busyKey === taskKey ? "Granting…" : `Grant ${selected.join(" + ")}`}
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {pages.length > visible.length ? (
        <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          Showing the {visible.length} pages needing most attention of {pages.length}. Use{" "}
          <span className="font-medium">Grant to all missing</span> to cover the rest in bulk.
        </p>
      ) : null}
    </>
  );
}
