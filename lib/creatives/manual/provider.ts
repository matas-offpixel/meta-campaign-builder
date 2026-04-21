/**
 * lib/creatives/manual/provider.ts
 *
 * Manual provider. Doesn't render anything — exists so users can
 * register a template they generate by hand outside the system and
 * still browse it in the same library. `render` returns a `done`
 * status with a null asset_url; the caller must populate the URL
 * separately.
 *
 * No feature flag — manual templates are always available.
 */

import {
  type CreativeProvider,
  type CreativeTemplate,
  type ProviderTemplateSummary,
  type RenderJob,
} from "@/lib/creatives/types";

export class ManualProvider implements CreativeProvider {
  readonly name = "manual" as const;

  async listTemplates(): Promise<ProviderTemplateSummary[]> {
    return [];
  }

  async render(
    template: CreativeTemplate,
    fields: Record<string, unknown>,
  ): Promise<{ jobId: string; status: "done" }> {
    void template;
    void fields;
    return { jobId: `manual-${Date.now()}`, status: "done" };
  }

  async pollRender(jobId: string): Promise<RenderJob> {
    return {
      jobId,
      status: "done",
      assetUrl: null,
    };
  }
}

export const manualProvider = new ManualProvider();
