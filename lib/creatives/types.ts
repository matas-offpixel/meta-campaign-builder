/**
 * lib/creatives/types.ts
 *
 * Provider abstraction for the autofill / template-render pipeline.
 * Same shape as `lib/d2c/types.ts` and `lib/ticketing/types.ts` — the
 * dashboard reasons about all three the same way.
 *
 * v1 SAFETY: every provider gates on a per-provider feature flag
 * (FEATURE_CANVA_AUTOFILL / FEATURE_BANNERBEAR / FEATURE_PLACID).
 * With the flag off, `render` and `pollRender` throw a typed error so
 * the UI surfaces a clear "pending approval" state instead of silently
 * queuing renders that will never complete.
 */

export type CreativeProviderName =
  | "canva"
  | "bannerbear"
  | "placid"
  | "manual";

export type CreativeChannel =
  | "feed"
  | "story"
  | "reel"
  | "display"
  | "other";

export type CreativeRenderStatus =
  | "queued"
  | "rendering"
  | "done"
  | "failed";

export type CreativeFieldType = "text" | "image" | "color" | "number";

export interface CreativeFieldDescriptor {
  key: string;
  label: string;
  type: CreativeFieldType;
  required?: boolean;
  defaultValue?: string | number | null;
}

export interface CreativeTemplate {
  id: string;
  user_id: string;
  name: string;
  provider: CreativeProviderName;
  external_template_id: string | null;
  fields_jsonb: CreativeFieldDescriptor[];
  channel: CreativeChannel;
  aspect_ratios: string[];
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreativeRender {
  id: string;
  user_id: string;
  event_id: string | null;
  template_id: string;
  status: CreativeRenderStatus;
  asset_url: string | null;
  provider_job_id: string | null;
  fields_jsonb: Record<string, unknown>;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProviderTemplateSummary {
  externalTemplateId: string;
  name: string;
  channel?: CreativeChannel;
  aspectRatios?: string[];
  thumbnailUrl?: string | null;
  fields?: CreativeFieldDescriptor[];
}

export interface RenderJob {
  jobId: string;
  status: CreativeRenderStatus;
  assetUrl?: string | null;
  errorMessage?: string | null;
}

export interface CreativeProvider {
  readonly name: CreativeProviderName;
  /**
   * List templates available to the user on the provider side.
   * Returns an empty array for `manual` because manual templates only
   * exist as DB rows.
   */
  listTemplates(): Promise<ProviderTemplateSummary[]>;
  /**
   * Kick off a render with the given field values. Returns the
   * provider job id which the caller persists onto
   * `creative_renders.provider_job_id`.
   */
  render(
    template: CreativeTemplate,
    fields: Record<string, unknown>,
  ): Promise<{ jobId: string; status: CreativeRenderStatus }>;
  /**
   * Poll for job status. The caller decides on the polling interval.
   */
  pollRender(jobId: string): Promise<RenderJob>;
}

export class CreativeProviderDisabledError extends Error {
  readonly providerName: CreativeProviderName;
  constructor(providerName: CreativeProviderName, message: string) {
    super(message);
    this.name = "CreativeProviderDisabledError";
    this.providerName = providerName;
  }
}

export class CanvaPendingEnterpriseError extends CreativeProviderDisabledError {
  constructor(message?: string) {
    super(
      "canva",
      message ??
        "Canva Autofill is gated behind FEATURE_CANVA_AUTOFILL — pending Canva Enterprise approval.",
    );
    this.name = "CanvaPendingEnterpriseError";
  }
}

function flagOn(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  return v === "true" || v === "1" || v === "on" || v === "yes";
}

export function isCanvaEnabled(): boolean {
  return flagOn("FEATURE_CANVA_AUTOFILL");
}
export function isBannerbearEnabled(): boolean {
  return flagOn("FEATURE_BANNERBEAR");
}
export function isPlacidEnabled(): boolean {
  return flagOn("FEATURE_PLACID");
}
