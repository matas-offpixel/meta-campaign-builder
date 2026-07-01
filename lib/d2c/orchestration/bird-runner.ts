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
  // Once `.scratch/bird-runtime-send-capture.txt` lands and the send shape is
  // confirmed, this executor should, IN ORDER (2026-07-01 incident layers 7-9):
  //   1. Layer 8 — resolve artwork: `resolveEventArtwork(supabase, eventId, …)`
  //      (lib/d2c/assets/resolver.ts) so event_artwork_url is never empty; it
  //      also writes the resolved URL back to d2c_event_copy.
  //   2. Layer 7 — `hydrateSendVariables(sendRow, eventCopy, event, client)`
  //      (lib/d2c/bird/hydrate-variables.ts) which LOUD-FAILS if any of the 6
  //      required template variables is empty — BEFORE any HTTP call.
  //   3. Layers 6 & 9 — POST the verified receiver + template body shape via
  //      the typed client (see BIRD_RUNTIME_SEND_VERIFIED in provider.ts).
  // Intentionally not implemented against an unverified contract.
  throw new Error(
    "BIRD_RUNTIME_UNVERIFIED: live Bird template send not implemented pending verified runtime payload " +
      "(.scratch/bird-runtime-send-capture.txt). See docs/D2C_LIVE_FIRE_RUNBOOK.md.",
  );
}
