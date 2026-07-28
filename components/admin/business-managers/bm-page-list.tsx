"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, ShieldAlert, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { BMPage } from "@/lib/bm/types";

/**
 * Per-page detail for one Business Manager, loaded on demand when an operator
 * expands a Pages row. Shows the TWO independent capabilities separately —
 * advertising (v1's ADVERTISE grant) and audience seeding (migration 148) —
 * because a page can have the first and lack the second, which is the state
 * that makes the wizard's audience builder skip it.
 */

/** A very large BM (Columbo Group: ~1060 pages) would otherwise render 1000+ rows. */
const MAX_ROWS = 200;

interface Props {
  businessId: string;
  /** Grants one capability on one page, then refreshes this list + parent counts. */
  onGrant: (key: string, url: string) => Promise<boolean>;
  busyKey: string | null;
  disabled: boolean;
}

/** Pages needing action first: missing both, then missing either, then complete. */
function byActionability(a: BMPage, b: BMPage): number {
  const score = (p: BMPage) => (p.user_has_access ? 1 : 0) + (p.user_has_audience_access ? 1 : 0);
  const diff = score(a) - score(b);
  if (diff !== 0) return diff;
  return (a.page_name ?? a.page_id).localeCompare(b.page_name ?? b.page_id);
}

export function BMPageList({ businessId, onGrant, busyKey, disabled }: Props) {
  const [pages, setPages] = useState<BMPage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

  return (
    <>
      <ul className="divide-y divide-border">
        {visible.map((page) => {
          const adKey = `grant:${businessId}:${page.page_id}`;
          const audienceKey = `grantaud:${businessId}:${page.page_id}`;
          return (
            <li
              key={page.page_id}
              className="flex items-center justify-between gap-3 px-4 py-2.5"
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
                {page.user_tasks.length > 0 ? (
                  <p className="truncate text-[11px] text-muted-foreground">
                    tasks: {page.user_tasks.join(", ")}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {page.user_has_access ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
                    <ShieldCheck className="h-3.5 w-3.5" /> Ads
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
                {page.user_has_audience_access ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
                    <Users className="h-3.5 w-3.5" /> Audiences
                  </span>
                ) : (
                  <Button
                    size="sm"
                    onClick={async () => {
                      const ok = await onGrant(
                        audienceKey,
                        `/api/business-managers/${businessId}/pages/${page.page_id}/grant-audience`,
                      );
                      if (ok) await load();
                    }}
                    disabled={busyKey === audienceKey || disabled}
                  >
                    <Users className="h-3.5 w-3.5" />
                    {busyKey === audienceKey ? "Granting…" : "Grant audience access"}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {pages.length > visible.length ? (
        <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          Showing the {visible.length} pages needing most attention of {pages.length}. Use{" "}
          <span className="font-medium">Grant audience access to all</span> to resolve the rest
          in bulk.
        </p>
      ) : null}
    </>
  );
}
