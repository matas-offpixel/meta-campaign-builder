/**
 * O68 (overlay templates issue 10): a clip wider than the output is rendered
 * from a stored render copy (Lanczos, CRF ≤ 16, beside the clip), and the
 * original stays the master. Making that copy is the import follow-up's (O74,
 * Cursor's); this only reads it. When the clip or its asset carries a
 * render_copy_path, that path is used; otherwise the source's own
 * storage_path. Neither the column nor any copy is on main yet, so today
 * every render reads the source.
 */

/** The field a render copy is read from, on the clip row or on its creative_assets row. */
export const RENDER_COPY_FIELD = "render_copy_path";

export type RenderSource = { path: string; copy: boolean };

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/** The Storage path a render reads: the clip's render copy when one exists, else the source. Read only. */
export function renderSourcePath(asset: Readonly<Record<string, unknown>>, clip: Readonly<Record<string, unknown>> = {}): RenderSource {
  const copy = clip[RENDER_COPY_FIELD] ?? asset[RENDER_COPY_FIELD];
  if (nonEmpty(copy)) return { path: copy, copy: true };
  const source = asset.storage_path;
  if (!nonEmpty(source)) throw new Error("clip asset has no storage_path");
  return { path: source, copy: false };
}
