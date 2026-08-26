/**
 * Plan fan-out killswitch — same pattern as ENABLE_OPTIMISATION_AUTOMATION.
 * Unset or any value other than exactly "1" is disabled.
 */
export const PLAN_FANOUT_KILLSWITCH_REASON = "killswitch" as const;

export function isPlanFanoutEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.ENABLE_PLAN_FANOUT === "1";
}

export function planFanoutGateState(env: NodeJS.ProcessEnv = process.env): {
  enabled: boolean;
  skippedReason: typeof PLAN_FANOUT_KILLSWITCH_REASON | null;
} {
  const enabled = isPlanFanoutEnabled(env);
  return {
    enabled,
    skippedReason: enabled ? null : PLAN_FANOUT_KILLSWITCH_REASON,
  };
}
