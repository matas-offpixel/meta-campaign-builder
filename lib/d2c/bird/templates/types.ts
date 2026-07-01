/**
 * lib/d2c/bird/templates/types.ts
 *
 * Types for Bird Studio's **internal** channel-template API
 * (`POST /workspaces/{wid}/projects/{pid}/channel-templates`) plus the
 * declarative brand-template definition shape our builder consumes.
 *
 * ⚠️ Internal, undocumented API — shapes are empirically verified against a
 * DevTools capture + live GETs (see docs/audits/D2C_BIRD_TEMPLATES_API_AUDIT_2026-06-30.md).
 * Bird may change these without notice. Runtime validators below guard the
 * declarative input; wire shapes are validated defensively at parse time.
 */

// ─── WhatsApp / Meta enums ──────────────────────────────────────────────────

export type WhatsAppCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION";
export const WHATSAPP_CATEGORIES: readonly WhatsAppCategory[] = [
  "MARKETING",
  "UTILITY",
  "AUTHENTICATION",
] as const;

/**
 * Bird stores locales hyphenated (`es-ES`). We accept the underscore form
 * (`es_ES`) in definitions and normalise. `en` stays `en`.
 */
export type LocaleId = string;

export function normaliseLocale(locale: string): string {
  const t = locale.trim();
  if (!t) return t;
  // es_ES → es-ES ; leave bare `en` alone.
  return t.replace("_", "-");
}

// ─── Bird wire shapes (POST body + GET response) ────────────────────────────

export interface BirdImageBlock {
  id: string;
  type: "image";
  role: "header";
  image: { mediaUrl: string; altText: string };
}

export interface BirdTextBlock {
  id: string;
  type: "text";
  role: "body" | "footer";
  text: { text: string };
}

export interface BirdLinkActionBlock {
  id: string;
  type: "link-action";
  linkAction: { text: string; url: string };
}

export type BirdBlock = BirdImageBlock | BirdTextBlock | BirdLinkActionBlock;

export interface BirdPlatformContent {
  platform: "whatsapp";
  locale: string;
  /** Header media kind; only the first locale entry carries it (rest `null`). */
  type: "image" | null;
  /** The WABA(s). Optional — omitting keeps the template a local draft. */
  channelGroupIds?: string[];
  blocks: BirdBlock[];
}

export interface BirdVariable {
  key: string;
  type: "string";
  format: "none";
  description: string;
  examplesLocale: Record<string, { exampleValueStrings: string[] }>;
}

export interface BirdDeployment {
  key: "whatsappTemplateName" | "whatsappCategory";
  platform: "whatsapp";
  value: string;
}

/** The exact body posted to `POST …/channel-templates`. */
export interface BirdTemplateCreatePayload {
  defaultLocale: string;
  genericContent: [];
  platformContent: BirdPlatformContent[];
  variables: BirdVariable[];
  supportedPlatforms: ["whatsapp"];
  shortLinks: { enabled: boolean; domain: string };
  deployments: BirdDeployment[];
}

export interface BirdApproval {
  approvalReference: string | null;
  status: string | null;
  platformStatus: string | null;
  reason: string | null;
  reasonCode: string | null;
  platformReference: string | null;
  channelGroupId: string | null;
  platformAccountIdentifier: string | null;
  platform: string | null;
}

/** GET response for a single channel-template (superset of the create payload). */
export interface BirdTemplate extends BirdTemplateCreatePayload {
  id: string;
  projectId: string;
  status: string; // "draft" | "active" | "pending_approval" | …
  platformInfo: Record<
    string,
    { status: string; category?: string; qualityRating?: string }
  >;
  platformContent: (BirdPlatformContent & { approvals?: BirdApproval[] })[];
  createdAt?: string;
  updatedAt?: string;
}

export interface BirdProject {
  id: string;
  name: string;
  type: string; // "channelTemplate"
  supportedPlatforms?: string[];
  locales?: string[];
  approvedTemplateChannelGroupIds?: string[] | null;
  approvedTemplateChannelsId?: string[] | null;
  draftCount?: number;
  pendingCount?: number;
  activeCount?: number;
  createdAt?: string;
}

// ─── Declarative brand-template definition (builder input) ──────────────────

export type LocalizedString = Record<LocaleId, string>;

/** Per-locale example value(s) for a variable, shown to Meta at review. */
export type LocalizedExamples = Record<LocaleId, string | string[]>;

export interface BrandTemplateDefinition {
  /** whatsappTemplateName (Meta-visible, snake_case). */
  name: string;
  category: WhatsAppCategory;
  /** Locales this template ships in, in `defaultLocale`-first order. */
  locales: LocaleId[];
  /** Per-locale body text; may contain `{{var}}` tokens. */
  body: LocalizedString;
  /** Per-locale footer (optional). */
  footer?: LocalizedString;
  /** Per-locale button label + a shared URL template (may contain `{{var}}`). */
  button?: { text: LocalizedString; url: string };
  /**
   * Variable holding the header image URL. Defaults to `event_artwork_url`.
   * Set to `null` to omit the image header entirely.
   */
  headerImageVar?: string | null;
  /**
   * Example values per variable key, per locale — required for every `{{var}}`
   * referenced anywhere (body, button url, header image var).
   */
  variableExamples: Record<string, LocalizedExamples>;
  /** Optional human descriptions per variable key (Meta-visible). */
  variableDescriptions?: Record<string, string>;
}

// ─── Runtime validation (hand-rolled — zod is not a dependency here) ────────

export class TemplateDefinitionError extends Error {
  readonly code = "BIRD_TPL_DEF_INVALID";
  constructor(message: string) {
    super(message);
    this.name = "TemplateDefinitionError";
  }
}

const NAME_RE = /^[a-z0-9_]+$/;
const VAR_TOKEN_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** Extract `{{var}}` keys from a string (deduped, in first-seen order). */
export function extractVariableKeys(text: string): string[] {
  const seen = new Set<string>();
  for (const m of text.matchAll(VAR_TOKEN_RE)) seen.add(m[1]);
  return [...seen];
}

/**
 * Validate a declarative definition. Throws `TemplateDefinitionError` with a
 * precise message on the first problem. Returns the full set of variable keys
 * the template references.
 */
export function validateDefinition(def: BrandTemplateDefinition): string[] {
  if (!def.name || !NAME_RE.test(def.name)) {
    throw new TemplateDefinitionError(
      `name "${def.name}" must be lower snake_case ([a-z0-9_]+).`,
    );
  }
  if (!WHATSAPP_CATEGORIES.includes(def.category)) {
    throw new TemplateDefinitionError(`unknown category "${def.category}".`);
  }
  if (!Array.isArray(def.locales) || def.locales.length === 0) {
    throw new TemplateDefinitionError(`${def.name}: at least one locale is required.`);
  }
  const headerVar =
    def.headerImageVar === null ? null : def.headerImageVar ?? "event_artwork_url";

  const referenced = new Set<string>();
  if (headerVar) referenced.add(headerVar);

  for (const locale of def.locales) {
    const body = def.body?.[locale];
    if (typeof body !== "string" || !body.trim()) {
      throw new TemplateDefinitionError(`${def.name}: body missing for locale "${locale}".`);
    }
    extractVariableKeys(body).forEach((k) => referenced.add(k));
    if (def.footer && typeof def.footer[locale] !== "string") {
      throw new TemplateDefinitionError(`${def.name}: footer missing for locale "${locale}".`);
    }
    if (def.button) {
      if (typeof def.button.text?.[locale] !== "string" || !def.button.text[locale].trim()) {
        throw new TemplateDefinitionError(`${def.name}: button.text missing for locale "${locale}".`);
      }
    }
  }
  if (def.button?.url) extractVariableKeys(def.button.url).forEach((k) => referenced.add(k));

  // Every referenced variable must have examples for every locale.
  for (const key of referenced) {
    const ex = def.variableExamples?.[key];
    if (!ex) {
      throw new TemplateDefinitionError(
        `${def.name}: variable "{{${key}}}" is referenced but has no variableExamples entry.`,
      );
    }
    for (const locale of def.locales) {
      if (ex[locale] === undefined) {
        throw new TemplateDefinitionError(
          `${def.name}: variableExamples["${key}"] missing example for locale "${locale}".`,
        );
      }
    }
  }
  return [...referenced];
}
