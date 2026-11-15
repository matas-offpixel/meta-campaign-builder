/** Exactly "true". Anything else, including unset, keeps Lab launches off. */
export function labLaunchesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CREATIVE_LAB_LAUNCH_ENABLED === "true";
}

export const LAB_LAUNCHES_OFF = "Lab launches are switched off";
