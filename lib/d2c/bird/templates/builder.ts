/**
 * lib/d2c/bird/templates/builder.ts
 *
 * Pure, deterministic transform: declarative `BrandTemplateDefinition` →
 * Bird Studio `BirdTemplateCreatePayload`. No I/O. Fully unit-tested.
 *
 * Variable model: definitions use named `{{var}}` tokens directly in body
 * text, footer, button URL, and the header image var. Bird Studio uses the
 * **same** named-`{{var}}` scheme (verified via GET of an approved template),
 * so no positional (`{{1}}`) conversion is needed — tokens pass through
 * verbatim and are declared in `variables[]`.
 */

import { randomBytes } from "node:crypto";

import {
  normaliseLocale,
  validateDefinition,
  type BirdBlock,
  type BirdDeployment,
  type BirdPlatformContent,
  type BirdTemplateCreatePayload,
  type BirdVariable,
  type BrandTemplateDefinition,
} from "./types.ts";

const NANOID_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** 21-char client id in Bird's observed nanoid shape. */
export function nanoid(size = 21): string {
  const bytes = randomBytes(size);
  let out = "";
  for (let i = 0; i < size; i++) out += NANOID_ALPHABET[bytes[i] % NANOID_ALPHABET.length];
  return out;
}

const DEFAULT_HEADER_VAR = "event_artwork_url";

function toExampleArray(ex: string | string[]): string[] {
  return Array.isArray(ex) ? ex : [ex];
}

export interface BuildOptions {
  /** WABA channel group(s) to attach. Omit to create a local draft (no Meta). */
  channelGroupIds?: string[];
  /** Enable Bird link-shortening. Default false. */
  shortLinks?: boolean;
  /** Restrict to a subset of the definition's locales (normalised form ok). */
  onlyLocales?: string[];
  /** Injectable id generator for deterministic tests. */
  idFactory?: () => string;
}

/**
 * Build the Bird create payload from a declarative definition.
 * Throws `TemplateDefinitionError` on invalid input.
 */
export function buildTemplatePayload(
  def: BrandTemplateDefinition,
  opts: BuildOptions = {},
): BirdTemplateCreatePayload {
  const referenced = validateDefinition(def);
  const genId = opts.idFactory ?? nanoid;

  const headerVar =
    def.headerImageVar === null ? null : def.headerImageVar ?? DEFAULT_HEADER_VAR;

  // Locale selection (in defaultLocale-first order).
  const wanted = opts.onlyLocales?.map(normaliseLocale);
  const locales = def.locales.filter((l) =>
    wanted ? wanted.includes(normaliseLocale(l)) : true,
  );
  if (locales.length === 0) {
    throw new Error(`buildTemplatePayload: no locales left after onlyLocales filter for "${def.name}".`);
  }

  // Shared block ids across locales (verified: Bird reuses ids per role).
  const ids = {
    header: genId(),
    body: genId(),
    footer: genId(),
    button: genId(),
  };

  const platformContent: BirdPlatformContent[] = locales.map((rawLocale, idx) => {
    const locale = normaliseLocale(rawLocale);
    const blocks: BirdBlock[] = [];
    if (headerVar) {
      blocks.push({
        id: ids.header,
        type: "image",
        role: "header",
        image: { mediaUrl: `{{${headerVar}}}`, altText: "" },
      });
    }
    blocks.push({
      id: ids.body,
      type: "text",
      role: "body",
      text: { text: def.body[rawLocale] },
    });
    if (def.footer?.[rawLocale]) {
      blocks.push({
        id: ids.footer,
        type: "text",
        role: "footer",
        text: { text: def.footer[rawLocale] },
      });
    }
    if (def.button) {
      blocks.push({
        id: ids.button,
        type: "link-action",
        linkAction: { text: def.button.text[rawLocale], url: def.button.url },
      });
    }
    const entry: BirdPlatformContent = {
      platform: "whatsapp",
      locale,
      // Only the first locale entry declares the header media kind.
      type: idx === 0 ? (headerVar ? "image" : null) : null,
      blocks,
    };
    if (opts.channelGroupIds?.length) entry.channelGroupIds = opts.channelGroupIds;
    return entry;
  });

  const variables: BirdVariable[] = referenced.map((key) => {
    const exByLocale = def.variableExamples[key];
    const examplesLocale: BirdVariable["examplesLocale"] = {};
    for (const rawLocale of locales) {
      const locale = normaliseLocale(rawLocale);
      examplesLocale[locale] = {
        exampleValueStrings: toExampleArray(exByLocale[rawLocale]),
      };
    }
    return {
      key,
      type: "string",
      format: "none",
      description: def.variableDescriptions?.[key] ?? key,
      examplesLocale,
    };
  });

  const deployments: BirdDeployment[] = [
    { key: "whatsappTemplateName", platform: "whatsapp", value: def.name },
    { key: "whatsappCategory", platform: "whatsapp", value: def.category },
  ];

  return {
    defaultLocale: normaliseLocale(locales[0]),
    genericContent: [],
    platformContent,
    variables,
    supportedPlatforms: ["whatsapp"],
    shortLinks: { enabled: opts.shortLinks ?? false, domain: "brd1.eu" },
    deployments,
  };
}

/** Read the whatsappTemplateName out of a create payload / template. */
export function templateNameOf(payload: {
  deployments: { key: string; value: string }[];
}): string | null {
  return (
    payload.deployments.find((d) => d.key === "whatsappTemplateName")?.value ?? null
  );
}
