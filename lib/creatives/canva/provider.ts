/**
 * lib/creatives/canva/provider.ts
 *
 * Canva Autofill adapter — STUB. Behind `FEATURE_CANVA_AUTOFILL`.
 * Throws `CanvaPendingEnterpriseError` on every method when the flag
 * is off. When on, methods throw a TODO error so flipping the flag
 * without the real implementation never silently no-ops.
 *
 * Real implementation lands when Matas's Canva Enterprise approval
 * clears. Expected scope: server-side OAuth via Canva Connect API,
 * brand-template autofill via the Designs API.
 */

import {
  CanvaPendingEnterpriseError,
  isCanvaEnabled,
  type CreativeProvider,
  type CreativeTemplate,
  type ProviderTemplateSummary,
  type RenderJob,
} from "@/lib/creatives/types";

export class CanvaProvider implements CreativeProvider {
  readonly name = "canva" as const;

  async listTemplates(): Promise<ProviderTemplateSummary[]> {
    if (!isCanvaEnabled()) throw new CanvaPendingEnterpriseError();
    throw new CanvaPendingEnterpriseError(
      "FEATURE_CANVA_AUTOFILL is on but Canva listTemplates is not implemented yet.",
    );
  }

  async render(
    template: CreativeTemplate,
    fields: Record<string, unknown>,
  ): Promise<{ jobId: string; status: "queued" }> {
    if (!isCanvaEnabled()) throw new CanvaPendingEnterpriseError();
    void template;
    void fields;
    throw new CanvaPendingEnterpriseError(
      "FEATURE_CANVA_AUTOFILL is on but Canva render is not implemented yet.",
    );
  }

  async pollRender(jobId: string): Promise<RenderJob> {
    if (!isCanvaEnabled()) throw new CanvaPendingEnterpriseError();
    void jobId;
    throw new CanvaPendingEnterpriseError(
      "FEATURE_CANVA_AUTOFILL is on but Canva pollRender is not implemented yet.",
    );
  }
}

export const canvaProvider = new CanvaProvider();
