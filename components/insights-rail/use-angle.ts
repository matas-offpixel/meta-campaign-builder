import type { GeneratorAngle } from "@/lib/insights-rail/model";

/**
 * "Use {angle}" (R9): the rail tells the Creative Lab caption generator
 * which angle to pre-select. It never generates. The generator listens
 * on window; the event carries the angle and nothing else.
 */
export const USE_ANGLE_EVENT = "creative-lab:use-angle";

export type UseAngleDetail = { angle: GeneratorAngle };

export function dispatchUseAngle(angle: GeneratorAngle): void {
  window.dispatchEvent(new CustomEvent<UseAngleDetail>(USE_ANGLE_EVENT, { detail: { angle } }));
  document.getElementById("lab-captions")?.scrollIntoView({ block: "start", behavior: "smooth" });
}
