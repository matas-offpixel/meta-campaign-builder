/**
 * lib/d2c/mailchimp/templates/types.ts
 *
 * Types for the Mailchimp templates automation layer — mirrors the Bird
 * templates architecture (PR #651). Declarative brand definitions →
 * builder → Mailchimp-compatible HTML → Marketing API v3 resources.
 *
 * Mailchimp API v3 docs: https://mailchimp.com/developer/marketing/api/
 */

// ─── Declarative brand definitions (the "brand definition file" pattern) ────

/** Template kinds shipped per brand. Maps 1:1 to D2C job types (minus community_early, which is Bird-only). */
export type MailchimpTemplateKind =
  | "announcement"
  | "presale_reminder"
  | "presale_live"
  | "autoresp"
  | "gen_sale";

export const MAILCHIMP_TEMPLATE_KINDS: readonly MailchimpTemplateKind[] = [
  "announcement",
  "presale_reminder",
  "presale_live",
  "autoresp",
  "gen_sale",
] as const;

/** Visual theme applied by the builder. All colours are hex strings. */
export interface BrandTheme {
  /** Page/background colour (e.g. Jackies red #E63329). */
  bgColor: string;
  /** Text colour on the coloured background. */
  fgColor: string;
  /** Logo image URL for the header (placeholder allowed). */
  logoUrl: string;
  /** CTA button background (e.g. #000000). */
  ctaBg: string;
  /** CTA button text colour (e.g. #FFFFFF). */
  ctaColor: string;
  /** Optional footer brand image URL. */
  footerImageUrl?: string;
}

/** A single call-to-action button. `url` is typically a merge tag like *|TICKET_URL|*. */
export interface Cta {
  label: string;
  url: string;
}

/**
 * A declarative email template definition. The builder converts this to
 * Outlook-safe inline-styled HTML. Body/subject/headline may contain
 * Mailchimp merge tags in *|VAR|* form; they are emitted verbatim.
 */
export interface MailchimpTemplateDefinition {
  /** Unique template name inside the account, e.g. "jackies_announcement". */
  name: string;
  kind: MailchimpTemplateKind;
  /** Optional locale suffix used when a brand ships EN + ES variants. */
  locale?: "en" | "es";
  /** Default subject line (merge tags allowed). */
  subject: string;
  /** Hidden preview text shown in inbox list. */
  preheader?: string;
  /** Big headline at the top of the body. */
  headline: string;
  /** One or more body paragraphs (merge tags allowed). */
  paragraphs: string[];
  /** Primary CTA button. Omit for templates with no button. */
  cta?: Cta;
  /** Render a full-width artwork image block (*|ARTWORK_URL|*). */
  showArtwork?: boolean;
  /** Footer legal/unsubscribe line. Mailchimp appends its own required footer. */
  footerNote?: string;
}

/** A brand's full config: theme + template set. */
export interface MailchimpBrandConfig {
  brand: string;
  theme: BrandTheme;
  templates: MailchimpTemplateDefinition[];
}

// ─── Mailchimp Marketing API v3 wire shapes (partial — only what we use) ────

export interface MailchimpTemplate {
  id: number;
  type: string;
  name: string;
  active?: boolean;
  category?: string;
  date_created?: string;
}

export interface MailchimpTemplateList {
  templates: MailchimpTemplate[];
  total_items: number;
}

export interface MailchimpCampaign {
  id: string;
  web_id?: number;
  type: string;
  status?: string;
  recipients?: { list_id: string; segment_opts?: unknown };
  settings?: Record<string, unknown>;
}

export interface MailchimpAudience {
  id: string;
  name: string;
  stats?: { member_count?: number };
}

export interface MailchimpAudienceList {
  lists: MailchimpAudience[];
  total_items: number;
}

export interface MailchimpSegment {
  id: number;
  name: string;
  member_count?: number;
  type?: string;
}

export interface MailchimpSegmentList {
  segments: MailchimpSegment[];
  total_items: number;
}

export interface MailchimpAutomation {
  id: string;
  status?: string;
  settings?: { title?: string };
  trigger_settings?: Record<string, unknown>;
}

export interface MailchimpAutomationList {
  automations: MailchimpAutomation[];
  total_items: number;
}

// ─── Validation ─────────────────────────────────────────────────────────────

const NAME_RE = /^[a-z0-9][a-z0-9_-]{1,80}$/;

/** Hand-rolled validator (no zod dep). Returns a list of problems (empty = ok). */
export function validateMailchimpDefinition(def: MailchimpTemplateDefinition): string[] {
  const errs: string[] = [];
  if (!def.name || !NAME_RE.test(def.name)) {
    errs.push(`name must match ${NAME_RE} (got "${def.name}")`);
  }
  if (!MAILCHIMP_TEMPLATE_KINDS.includes(def.kind)) {
    errs.push(`kind "${def.kind}" is not a known template kind`);
  }
  if (!def.subject?.trim()) errs.push("subject is required");
  if (!def.headline?.trim()) errs.push("headline is required");
  if (!def.paragraphs?.length) errs.push("at least one paragraph is required");
  if (def.cta && (!def.cta.label?.trim() || !def.cta.url?.trim())) {
    errs.push("cta requires both label and url");
  }
  return errs;
}

/** Extract all *|VAR|* merge tags referenced anywhere in a definition. */
export function extractMergeTags(def: MailchimpTemplateDefinition): string[] {
  const haystack = [
    def.subject,
    def.preheader ?? "",
    def.headline,
    ...def.paragraphs,
    def.cta?.url ?? "",
    def.cta?.label ?? "",
    def.footerNote ?? "",
    def.showArtwork ? "*|ARTWORK_URL|*" : "",
  ].join(" ");
  const tags = new Set<string>();
  const re = /\*\|([A-Z0-9_]+)\|\*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(haystack)) !== null) tags.add(m[1]);
  return [...tags].sort();
}
