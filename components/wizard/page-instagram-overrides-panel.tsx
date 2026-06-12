"use client";

import { useMemo } from "react";
import { AlertCircle } from "lucide-react";
import { Select } from "@/components/ui/select";
import type { MetaInstagramAccount, PageIgOption } from "@/lib/types";

type IGWithPage = MetaInstagramAccount & { linkedPageId: string };

interface PageInstagramOverridesPanelProps {
  /** Page IDs that need an explicit IG pick (subset of multi-IG pages in use). */
  pageIds: string[];
  /** Flat IG list from /api/meta/instagram-accounts (multiple rows per page allowed). */
  igAccounts: IGWithPage[];
  /** Optional page id → display name map (from pages cache). */
  pageNames?: Record<string, string>;
  overrides: Record<string, string>;
  onOverrideChange: (pageId: string, igId: string) => void;
  loading?: boolean;
  error?: string | null;
  /** Shown above the per-page dropdowns. */
  title?: string;
}

function groupIgsByPage(igAccounts: IGWithPage[]): Map<string, PageIgOption[]> {
  const map = new Map<string, PageIgOption[]>();
  for (const ig of igAccounts) {
    if (!ig.linkedPageId || !ig.id) continue;
    const list = map.get(ig.linkedPageId) ?? [];
    if (!list.some((entry) => entry.igId === ig.id)) {
      list.push({
        igId: ig.id,
        username: ig.username ? `@${ig.username.replace(/^@/, "")}` : ig.id,
        displayName: ig.name,
      });
    }
    map.set(ig.linkedPageId, list);
  }
  for (const [pageId, list] of map) {
    map.set(
      pageId,
      list.sort((a, b) => a.username.localeCompare(b.username)),
    );
  }
  return map;
}

export function PageInstagramOverridesPanel({
  pageIds,
  igAccounts,
  pageNames,
  overrides,
  onOverrideChange,
  loading,
  error,
  title = "Instagram accounts",
}: PageInstagramOverridesPanelProps) {
  const igsByPage = useMemo(() => groupIgsByPage(igAccounts), [igAccounts]);

  const multiPages = useMemo(
    () =>
      pageIds.filter((pageId) => (igsByPage.get(pageId)?.length ?? 0) >= 2),
    [pageIds, igsByPage],
  );

  if (multiPages.length === 0) return null;

  return (
    <div className="rounded-lg border border-warning/40 bg-warning/5 p-4 space-y-3">
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          These Facebook Pages have more than one linked Instagram account. Pick
          which handle to use for ad identity and IG engagement audiences.
        </p>
      </div>

      {multiPages.map((pageId) => {
        const options = igsByPage.get(pageId) ?? [];
        const pageLabel = pageNames?.[pageId] ?? pageId;
        const selected = overrides[pageId] ?? "";

        return (
          <div key={pageId}>
            <Select
              label={`Instagram for ${pageLabel}`}
              value={selected}
              onChange={(e) => onOverrideChange(pageId, e.target.value)}
              placeholder={loading ? "Loading…" : "Select Instagram account…"}
              disabled={loading}
              options={[
                { value: "", label: "— Select account —" },
                ...options.map((ig) => ({
                  value: ig.igId,
                  label: ig.displayName
                    ? `${ig.username} (${ig.displayName})`
                    : ig.username,
                })),
              ]}
            />
            {!selected && !loading && (
              <p className="mt-1 flex items-center gap-1 text-[11px] text-warning">
                <AlertCircle className="h-3 w-3 flex-shrink-0" />
                Required — Meta will pick the wrong IG if you skip this.
              </p>
            )}
          </div>
        );
      })}

      {error && (
        <p className="text-xs text-destructive flex items-center gap-1">
          <AlertCircle className="h-3.5 w-3.5" /> {error}
        </p>
      )}
    </div>
  );
}

/** Derive page IDs with 2+ linked IGs from a flat IG account list. */
export function deriveMultiIgPageIds(igAccounts: IGWithPage[]): string[] {
  const counts = new Map<string, number>();
  for (const ig of igAccounts) {
    counts.set(ig.linkedPageId, (counts.get(ig.linkedPageId) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([pageId]) => pageId);
}
