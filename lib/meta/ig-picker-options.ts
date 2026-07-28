/**
 * lib/meta/ig-picker-options.ts
 *
 * Pure option-building for the wizard's Instagram identity pickers.
 *
 * Extracted from `components/wizard/page-instagram-overrides-panel.tsx` so the
 * defaulting rules are unit-testable: the single most important property of
 * these pickers is that a page with 2+ linked Instagram accounts produces NO
 * default selection (task #96 — the wizard used to land on an arbitrary handle,
 * e.g. @__mastery instead of @junction_2 for the Junction 2 page).
 */

import type { MetaInstagramAccount, PageIgOption } from "../types.ts";

export type IgWithPage = MetaInstagramAccount & { linkedPageId: string };

/**
 * Group a flat IG list by page, sorted with the page's own business account
 * first (the recommendation) and the rest alphabetically.
 */
export function groupIgsByPage(igAccounts: IgWithPage[]): Map<string, PageIgOption[]> {
  const map = new Map<string, PageIgOption[]>();
  for (const ig of igAccounts) {
    if (!ig.linkedPageId || !ig.id) continue;
    const list = map.get(ig.linkedPageId) ?? [];
    if (!list.some((entry) => entry.igId === ig.id)) {
      list.push({
        igId: ig.id,
        username: ig.username ? `@${ig.username.replace(/^@/, "")}` : ig.id,
        displayName: ig.name,
        isPagePrimary: ig.isPagePrimary,
      });
    }
    map.set(ig.linkedPageId, list);
  }
  for (const [pageId, list] of map) {
    map.set(
      pageId,
      list.sort((a, b) => {
        if (Boolean(a.isPagePrimary) !== Boolean(b.isPagePrimary)) {
          return a.isPagePrimary ? -1 : 1;
        }
        return a.username.localeCompare(b.username);
      }),
    );
  }
  return map;
}

/** Option label, with a "Recommended" hint on the Page's own business account. */
export function formatIgOptionLabel(ig: PageIgOption): string {
  const base = ig.displayName ? `${ig.username} (${ig.displayName})` : ig.username;
  return ig.isPagePrimary ? `${base} — Recommended` : base;
}

/** Page IDs with 2+ linked IGs — these require an explicit operator pick. */
export function deriveMultiIgPageIds(igAccounts: IgWithPage[]): string[] {
  const counts = new Map<string, number>();
  for (const ig of igAccounts) {
    counts.set(ig.linkedPageId, (counts.get(ig.linkedPageId) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([pageId]) => pageId);
}

/**
 * The value the picker should show for a page.
 *
 * Returns `""` (nothing selected) whenever the page has 2+ linked IGs and the
 * operator hasn't chosen yet — recommending is fine, pre-ticking is not, because
 * a pre-ticked wrong handle is indistinguishable from a deliberate choice.
 * Single-IG pages auto-fill, since there is nothing to get wrong.
 */
export function resolveIgPickerValue(input: {
  options: PageIgOption[];
  override?: string;
}): string {
  const { options, override } = input;
  if (override && options.some((ig) => ig.igId === override)) return override;
  if (override) return override;
  if (options.length === 1) return options[0].igId;
  return "";
}
