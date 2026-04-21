/**
 * lib/creatives/placid/provider.ts
 *
 * Placid adapter — STUB behind `FEATURE_PLACID`. Same shape as the
 * Bannerbear stub.
 */

import {
  CreativeProviderDisabledError,
  isPlacidEnabled,
  type CreativeProvider,
  type CreativeTemplate,
  type ProviderTemplateSummary,
  type RenderJob,
} from "@/lib/creatives/types";

const DISABLED =
  "Placid is gated behind FEATURE_PLACID — pending account provisioning.";

export class PlacidProvider implements CreativeProvider {
  readonly name = "placid" as const;

  async listTemplates(): Promise<ProviderTemplateSummary[]> {
    if (!isPlacidEnabled()) {
      throw new CreativeProviderDisabledError("placid", DISABLED);
    }
    throw new CreativeProviderDisabledError(
      "placid",
      "FEATURE_PLACID is on but listTemplates is not implemented yet.",
    );
  }

  async render(
    template: CreativeTemplate,
    fields: Record<string, unknown>,
  ): Promise<{ jobId: string; status: "queued" }> {
    if (!isPlacidEnabled()) {
      throw new CreativeProviderDisabledError("placid", DISABLED);
    }
    void template;
    void fields;
    throw new CreativeProviderDisabledError(
      "placid",
      "FEATURE_PLACID is on but render is not implemented yet.",
    );
  }

  async pollRender(jobId: string): Promise<RenderJob> {
    if (!isPlacidEnabled()) {
      throw new CreativeProviderDisabledError("placid", DISABLED);
    }
    void jobId;
    throw new CreativeProviderDisabledError(
      "placid",
      "FEATURE_PLACID is on but pollRender is not implemented yet.",
    );
  }
}

export const placidProvider = new PlacidProvider();
