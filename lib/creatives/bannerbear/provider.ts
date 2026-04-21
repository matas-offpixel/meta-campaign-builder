/**
 * lib/creatives/bannerbear/provider.ts
 *
 * Bannerbear adapter — STUB behind `FEATURE_BANNERBEAR`. Real
 * implementation lands when the Bannerbear account is provisioned.
 */

import {
  CreativeProviderDisabledError,
  isBannerbearEnabled,
  type CreativeProvider,
  type CreativeTemplate,
  type ProviderTemplateSummary,
  type RenderJob,
} from "@/lib/creatives/types";

const DISABLED =
  "Bannerbear is gated behind FEATURE_BANNERBEAR — pending account provisioning.";

export class BannerbearProvider implements CreativeProvider {
  readonly name = "bannerbear" as const;

  async listTemplates(): Promise<ProviderTemplateSummary[]> {
    if (!isBannerbearEnabled()) {
      throw new CreativeProviderDisabledError("bannerbear", DISABLED);
    }
    throw new CreativeProviderDisabledError(
      "bannerbear",
      "FEATURE_BANNERBEAR is on but listTemplates is not implemented yet.",
    );
  }

  async render(
    template: CreativeTemplate,
    fields: Record<string, unknown>,
  ): Promise<{ jobId: string; status: "queued" }> {
    if (!isBannerbearEnabled()) {
      throw new CreativeProviderDisabledError("bannerbear", DISABLED);
    }
    void template;
    void fields;
    throw new CreativeProviderDisabledError(
      "bannerbear",
      "FEATURE_BANNERBEAR is on but render is not implemented yet.",
    );
  }

  async pollRender(jobId: string): Promise<RenderJob> {
    if (!isBannerbearEnabled()) {
      throw new CreativeProviderDisabledError("bannerbear", DISABLED);
    }
    void jobId;
    throw new CreativeProviderDisabledError(
      "bannerbear",
      "FEATURE_BANNERBEAR is on but pollRender is not implemented yet.",
    );
  }
}

export const bannerbearProvider = new BannerbearProvider();
