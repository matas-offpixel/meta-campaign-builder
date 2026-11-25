/**
 * lib/render-templates/file-name.ts — the 25 Nov file name (spec "Delivery").
 *
 *   {EVENT}__{owner}__{recipe}__{variant}__{cta-slug}__r{round}__{ratio}.{ext}
 *
 * Double underscores separate the fields, so the Drive pickup and the
 * learnings can read them back (parseRenderFileName). owner is
 * `artist-{slug}`, `promoter-{client-slug}` or `offpixel`; anything with
 * promoter footage is `promoter-…`. A no-CTA version takes `no-cta`.
 * The ratio is written 9x16 / 4x5 / 1x1 and printed 9:16 (RT2).
 *
 * Relative imports only (node:test).
 */

import { M4_WORDS, RECIPES, recipeWord, type Recipe } from "./words.ts";

export const RATIOS = ["9:16", "4:5", "1:1"] as const;
export type Ratio = (typeof RATIOS)[number];

export const MONTAGE_VARIANTS = ["no-text", "teaser", "announcement"] as const;
export type MontageVariant = (typeof MONTAGE_VARIANTS)[number];

export type FileOwner =
  | { kind: "artist"; slug: string }
  | { kind: "promoter"; slug: string }
  | { kind: "offpixel" };

export type RenderFileName = {
  eventCode: string;
  owner: FileOwner;
  recipe: Recipe;
  variant: string;
  ctaSlug: string;
  round: number;
  ratio: Ratio;
  ext: string;
};

export const NO_CTA = "no-cta";

/** lower-case, ASCII, hyphens: "Enzo Siragusa" → "enzo-siragusa", "Circuit & Engine" → "circuit-engine". */
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function ratioSlug(ratio: Ratio): string {
  return ratio.replace(":", "x");
}

export function ownerSlug(owner: FileOwner): string {
  if (owner.kind === "offpixel") return "offpixel";
  return `${owner.kind}-${owner.slug}`;
}

/** The field values may not carry "__" or a dot: a stray one would break the read-back. */
function field(value: string): string {
  if (!value || /__|\.|\s/.test(value)) throw new Error(`bad file-name field: ${JSON.stringify(value)}`);
  return value;
}

export function buildRenderFileName(name: RenderFileName): string {
  if (!Number.isInteger(name.round) || name.round < 1) throw new Error("round must be a whole number from 1");
  return [
    field(name.eventCode),
    field(ownerSlug(name.owner)),
    field(name.recipe),
    field(name.variant),
    field(name.ctaSlug),
    `r${name.round}`,
    ratioSlug(name.ratio),
  ].join("__") + `.${field(name.ext)}`;
}

/** The fields back from a name, or null when it isn't a 25 Nov name. */
export function parseRenderFileName(fileName: string): RenderFileName | null {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = fileName.slice(dot + 1);
  const parts = fileName.slice(0, dot).split("__");
  if (parts.length !== 7) return null;
  const [eventCode, owner, recipe, variant, ctaSlug, round, ratio] = parts as [string, string, string, string, string, string, string];
  if (!(RECIPES as readonly string[]).includes(recipe)) return null;
  const r = /^r([1-9][0-9]*)$/.exec(round);
  if (!r) return null;
  const rat = RATIOS.find((x) => ratioSlug(x) === ratio);
  if (!rat) return null;
  let parsedOwner: FileOwner;
  if (owner === "offpixel") parsedOwner = { kind: "offpixel" };
  else if (owner.startsWith("artist-") && owner.length > 7) parsedOwner = { kind: "artist", slug: owner.slice(7) };
  else if (owner.startsWith("promoter-") && owner.length > 9) parsedOwner = { kind: "promoter", slug: owner.slice(9) };
  else return null;
  if (!eventCode || !variant || !ctaSlug) return null;
  return { eventCode, owner: parsedOwner, recipe: recipe as Recipe, variant, ctaSlug, round: Number(r[1]), ratio: rat, ext };
}

function variantWord(variant: string): string {
  if (variant === "no-text") return M4_WORDS["m4.variant.no_text"];
  if (variant === "teaser") return M4_WORDS["m4.variant.teaser"];
  if (variant === "announcement") return M4_WORDS["m4.variant.announcement"];
  return variant;
}

function ctaWord(slug: string): string {
  return slug === NO_CTA ? M4_WORDS["m4.cta.none"] : slug;
}

/** RT2's line under the name: "{recipe} · {variant} · {cta} · {ratio} · round {round}", read from the name. */
export function rowMeta(fileName: string): string | null {
  const parsed = parseRenderFileName(fileName);
  if (!parsed) return null;
  return M4_WORDS["m4.row.meta"]
    .replace("{recipe}", recipeWord(parsed.recipe))
    .replace("{variant}", variantWord(parsed.variant))
    .replace("{cta}", ctaWord(parsed.ctaSlug))
    .replace("{ratio}", parsed.ratio)
    .replace("{round}", String(parsed.round));
}

/**
 * RT2's line split for setting: everything before the last " · ", and
 * "round {n}", which never breaks across lines (design, #1385 at 393: the
 * same rule as "33 files"). Null when the name isn't a 25 Nov name.
 */
export function rowMetaParts(fileName: string): { lead: string; round: string } | null {
  const meta = rowMeta(fileName);
  if (!meta) return null;
  const at = meta.lastIndexOf(" · ");
  return { lead: meta.slice(0, at), round: meta.slice(at + 3) };
}

/** RT2: the name breaks only after a "__", never inside a field. */
export function nameBreakParts(fileName: string): string[] {
  const parts = fileName.split("__");
  return parts.map((p, i) => (i < parts.length - 1 ? `${p}__` : p));
}

/**
 * The cta-slug for a version with a CTA, from the stage its claim is written
 * for (check 3). Builder's choice, listed in the PR: the frames' "tickets" for
 * on sale, the spec's "signup" for signup, "presale" for presale.
 */
export function ctaSlugForStage(stage: "signup" | "presale" | "on_sale"): string {
  return stage === "on_sale" ? "tickets" : stage;
}
