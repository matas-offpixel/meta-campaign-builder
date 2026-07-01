/**
 * lib/d2c/orchestration/bird-runner.ts
 *
 * Live executor for Bird (WhatsApp) orchestration jobs. Only reached when the
 * 3-of-3 gate is satisfied AND the referenced template is Meta-active (checked
 * in orchestrateJob).
 *
 * BLOCKER (documented in docs/D2C_FULL_ORCHESTRATION.md): the per-segment
 * broadcast/scheduledFor send shape for Bird's runtime Channels API is NOT yet
 * captured. PR #651 verified the Studio *template* API (create/activate); the
 * runtime *send-to-audience* shape (recipient/segment model + scheduledFor
 * field) needs a DevTools capture before we can wire a correct live send.
 *
 * Until then the live path fails loudly (per spec) rather than guessing at a
 * payload that could mis-send. The dry-run planner (planJob) fully describes
 * the intended send and is what the cron exercises today.
 */

import type { BirdTemplateClientConfig } from "../bird/templates/client.ts";
import type { OrchestrationInput, OrchestrationPlan } from "./index.ts";

/** Build the template-message parameters array from resolved event variables. */
export function buildBirdParameters(
  variables: Record<string, string>,
): { type: "string"; key: string; value: string }[] {
  return Object.entries(variables)
    .filter(([, v]) => v != null && v !== "")
    .map(([key, value]) => ({ type: "string", key, value: String(value) }));
}

export async function executeBirdJob(
  _cfg: BirdTemplateClientConfig & { workspaceId: string },
  input: OrchestrationInput,
  _plan: OrchestrationPlan,
): Promise<string> {
  if (!input.bird?.channelId) {
    throw new Error(
      "BIRD_RUNTIME_UNVERIFIED: no channelId, and the Bird runtime broadcast/scheduledFor " +
        "send shape is not yet captured. Provide a DevTools capture of the Studio 'send to " +
        "audience' call (recipient/segment model + scheduledFor) before enabling live Bird sends. " +
        `job=${input.jobType} template=${input.bird?.templateId}`,
    );
  }
  // Once the shape is confirmed, POST /workspaces/{wid}/channels/{cid}/messages
  // with { template: { projectId, templateId, parameters }, scheduledFor } via
  // birdFetch (typed client). Intentionally not implemented against an
  // unverified contract.
  throw new Error(
    "BIRD_RUNTIME_UNVERIFIED: live Bird template send not implemented pending verified runtime payload.",
  );
}
