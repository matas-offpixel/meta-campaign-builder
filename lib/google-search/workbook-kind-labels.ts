import type { GoogleWorkbookKind } from "./workbook.ts";

export type { GoogleWorkbookKind };

/** Kept apart from `workbook.ts` so client components don't bundle xlsx. */
export const WORKBOOK_KIND_LABELS: Record<GoogleWorkbookKind, string> = {
  search: "Google Search plan",
  video: "YouTube video plan",
  unknown: "not a Google build sheet",
};
