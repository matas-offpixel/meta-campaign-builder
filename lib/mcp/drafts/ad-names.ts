/**
 * lib/mcp/drafts/ad-names.ts — an ad's name from its Drive file's recipe.
 *
 * The export names a render's file in one of two ways:
 *   {CODE}_{owner}_{recipe}_{variant}_{ratio}.ext
 *     ES27-ENZOSIRAGUSA_ES_ugc-caption-2_signup_9x16.mp4 → ugc-caption-2, signup
 *   {CODE}__{owner}__{kind}__{recipe}__{variant}[__{rev}]__{ratio}.ext
 *     ES27-ENZOSIRAGUSA__artist-enzo-siragusa__raw__ugc-2-original__no-cta__r1__9x16.mp4 → ugc-2-original, no-cta
 * Anything else doesn't parse: the caller stops on it rather than guess.
 *
 * The ad's name is the recipe; when two ads in a draft share a recipe, the
 * variant is added ("roll-call-amnesia · no-cta"). Pure, relative imports
 * only (node:test).
 */

export interface FileRecipe {
  recipe: string;
  variant: string;
}

const RATIO = /^\d+x\d+$/;
const PART = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function recipeOf(fileName: string | null | undefined): FileRecipe | null {
  if (!fileName) return null;
  const base = fileName.replace(/\.[A-Za-z0-9]+$/, "");
  if (base.includes("__")) {
    const parts = base.split("__");
    if (parts.length < 6 || parts.length > 7 || !RATIO.test(parts.at(-1)!)) return null;
    if (parts.length === 7 && !/^r\d+$/.test(parts[5]!)) return null;
    const [recipe, variant] = [parts[3]!, parts[4]!];
    return PART.test(recipe) && PART.test(variant) ? { recipe, variant } : null;
  }
  const parts = base.split("_");
  if (parts.length !== 5 || !RATIO.test(parts[4]!)) return null;
  const [recipe, variant] = [parts[2]!, parts[3]!];
  return PART.test(recipe) && PART.test(variant) ? { recipe, variant } : null;
}

/** Names for a set of recipes: the recipe, with the variant where two share one. */
export function recipeNames(items: ReadonlyArray<FileRecipe>, taken: ReadonlyArray<string> = []): string[] {
  const count = new Map<string, number>();
  for (const it of items) count.set(it.recipe, (count.get(it.recipe) ?? 0) + 1);
  const used = new Set(taken);
  return items.map((it) => {
    let name = (count.get(it.recipe) ?? 0) > 1 || used.has(it.recipe) ? `${it.recipe} · ${it.variant}` : it.recipe;
    for (let n = 2; used.has(name); n += 1) name = `${it.recipe} · ${it.variant} ${n}`;
    used.add(name);
    return name;
  });
}

/** The Drive file behind an ad: its first asset with a file name. */
export function adFile(c: { assetVariations?: Array<{ assets: Array<{ fileName?: string; driveFileId?: string }> }> }): { fileName: string | null; driveFileId: string | null } {
  for (const v of c.assetVariations ?? []) for (const a of v.assets) if (a.fileName || a.driveFileId) return { fileName: a.fileName ?? null, driveFileId: a.driveFileId ?? null };
  return { fileName: null, driveFileId: null };
}
