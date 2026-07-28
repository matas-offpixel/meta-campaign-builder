"use client";

import { useMemo } from "react";
import { AlertCircle } from "lucide-react";
import { Select } from "@/components/ui/select";
import {
  groupIgsByPage,
  formatIgOptionLabel,
  type IgWithPage,
} from "@/lib/meta/ig-picker-options";

// Re-exported so existing wizard-step imports keep their single source.
export { deriveMultiIgPageIds } from "@/lib/meta/ig-picker-options";

type IGWithPage = IgWithPage;

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

        const recommended = options.find((ig) => ig.isPagePrimary);

        return (
          <div key={pageId}>
            <Select
              label={`Instagram for ${pageLabel} *`}
              value={selected}
              onChange={(e) => onOverrideChange(pageId, e.target.value)}
              placeholder={loading ? "Loading…" : "Select Instagram account…"}
              disabled={loading}
              // Red border + red helper text while unset — the launch is blocked
              // until this is answered, so it reads as an error, not a hint.
              error={
                !selected && !loading
                  ? "Required — pick the Instagram account to advertise as."
                  : undefined
              }
              options={[
                { value: "", label: "— Select account —" },
                ...options.map((ig) => ({
                  value: ig.igId,
                  label: formatIgOptionLabel(ig),
                })),
              ]}
            />
            {!selected && !loading && recommended && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                {recommended.username} is this Page&apos;s own Instagram business
                account — usually the right choice.
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

