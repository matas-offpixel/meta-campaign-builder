import "server-only";

import sharp from "sharp";

import { extractPaletteFromPixels } from "./palette.ts";

/**
 * lib/landing-pages/palette-extract.ts
 *
 * SERVER-ONLY artwork → dominant-palette pipeline (PR 6). Fetches the
 * image, downsamples via sharp (already a repo dependency — no
 * node-vibrant needed), and runs the pure bin-ranking extractor from
 * palette.ts.
 *
 * Contract:
 *   - 3s hard deadline across fetch + decode. Fail-SILENT → [] (a missing
 *     palette costs one accent-color fallback, never a page error), but
 *     console.error'd so sustained failures show in Vercel logs.
 *   - Returns [primary, secondary, tertiary] as #RRGGBB.
 *
 * Trigger model (audited 2026-07-04): nothing in the app writes
 * page_events artwork today — artwork/hero URLs are set by manual SQL /
 * the seed script. So instead of hooking a write path that doesn't
 * exist, extraction is LAZY: the /l page render calls
 * maybeExtractAndPersistPalette via next/server's after() whenever a
 * page has artwork but artwork_palette IS NULL, fire-and-forget. Clear
 * artwork_palette to NULL to force re-extraction after artwork changes.
 */

export const PALETTE_TIMEOUT_MS = 3_000;

/** Downsample target — 100x100 is plenty for dominant-color binning. */
const RESIZE_PX = 100;

export interface ExtractPaletteOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export async function extractArtworkPalette(
  url: string,
  options: ExtractPaletteOptions = {},
): Promise<string[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? PALETTE_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return [];
    }

    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) {
      console.error(
        `[landing-pages palette] fetch failed for artwork: http_${response.status}`,
      );
      return [];
    }
    const bytes = new Uint8Array(await response.arrayBuffer());

    // The abort signal does not cover sharp; race the decode against the
    // remaining budget so the 3s deadline is genuinely hard.
    const decode = sharp(bytes)
      .resize(RESIZE_PX, RESIZE_PX, { fit: "inside" })
      .ensureAlpha()
      .raw()
      .toBuffer();
    const decoded = await Promise.race([
      decode,
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener("abort", () =>
          reject(new Error("palette_deadline_exceeded")),
        );
        if (controller.signal.aborted) {
          reject(new Error("palette_deadline_exceeded"));
        }
      }),
    ]);

    return extractPaletteFromPixels(new Uint8Array(decoded));
  } catch (error) {
    console.error(
      `[landing-pages palette] extraction failed (failing silent → []):`,
      error instanceof Error ? error.message : error,
    );
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// ─── Render-time persist hook ────────────────────────────────────────────────

/** Minimal update surface — service-role client satisfies this. */
export interface PaletteDb {
  from(table: string): {
    update(values: Record<string, unknown>): {
      eq(
        column: string,
        value: unknown,
      ): PromiseLike<{ error: { message: string } | null }>;
    };
  };
}

/**
 * In-flight guard: many concurrent renders of the same page must not each
 * fetch + decode the artwork. Per-instance (serverless) — worst case a few
 * duplicate idempotent writes across lambdas, which is fine.
 */
const inFlight = new Set<string>();

/**
 * Extract the palette for a page's first hero image and persist it to
 * page_events.artwork_palette. Fire-and-forget from after() — never
 * throws, never blocks the response. No-op when already extracting.
 */
export async function maybeExtractAndPersistPalette(
  db: PaletteDb,
  pageEventId: string,
  imageUrl: string,
  options: ExtractPaletteOptions = {},
): Promise<void> {
  if (inFlight.has(pageEventId)) return;
  inFlight.add(pageEventId);
  try {
    const palette = await extractArtworkPalette(imageUrl, options);
    if (palette.length === 0) return;
    const { error } = await db
      .from("page_events")
      .update({ artwork_palette: palette })
      .eq("id", pageEventId);
    if (error) {
      console.error(
        `[landing-pages palette] persist failed for page_event ${pageEventId}: ${error.message}`,
      );
    }
  } catch (error) {
    console.error("[landing-pages palette] unexpected error:", error);
  } finally {
    inFlight.delete(pageEventId);
  }
}
