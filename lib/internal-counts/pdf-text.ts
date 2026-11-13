/**
 * lib/internal-counts/pdf-text.ts
 *
 * The one place that touches a PDF library. It returns positioned text
 * items, and `parse.ts` does everything else, so the parser stays a pure
 * function of those items and its tests need no PDF at all.
 *
 * `unpdf` is imported lazily: only the routes that read a count PDF (the
 * cron, the upload route, the review-list rerun and the backfill script)
 * pull it into their trace.
 */

export interface PdfTextItem {
  page: number;
  /** Left edge, PDF points from the left of the page. */
  x: number;
  /** Baseline, PDF points from the bottom of the page. */
  y: number;
  width: number;
  str: string;
}

export async function extractPdfTextItems(bytes: Uint8Array): Promise<PdfTextItem[]> {
  const { getDocumentProxy } = await import("unpdf");
  // pdf.js detaches the buffer it is given, so hand it a copy.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const items: PdfTextItem[] = [];
  try {
    for (let page = 1; page <= pdf.numPages; page++) {
      const content = await (await pdf.getPage(page)).getTextContent();
      for (const raw of content.items) {
        if (!("str" in raw)) continue;
        const str = raw.str.trim();
        if (!str) continue;
        items.push({ page, x: raw.transform[4], y: raw.transform[5], width: raw.width, str });
      }
    }
  } finally {
    await pdf.cleanup?.();
  }
  return items;
}
