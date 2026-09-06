/**
 * Canon §1.6 — one overlay per face. Role changes what renders around
 * an exhibit, never whether the exhibit exists. No switcher, no marker.
 */

import { adjustControlsVisible } from "./adjust-face.ts";
import { launchControlsVisible } from "./launch-face.ts";
import { learnControlsVisible } from "./learn-face.ts";

export type PlanRole = "operator" | "client";

export function planSharePath(planId: string): string {
  return `/share/plan/${planId}`;
}

const PLAN_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isPlanShareId(value: string): boolean {
  return PLAN_ID.test(value);
}

export function planShareControls(role: PlanRole): {
  launch: boolean;
  unitPicker: boolean;
  drawerEdit: boolean;
  suggestion: boolean;
  doIt: boolean;
  notNow: boolean;
  undo: boolean;
  nextTimeColumn: boolean;
  switcher: boolean;
  marker: boolean;
} {
  return {
    ...launchControlsVisible(role),
    ...adjustControlsVisible(role),
    ...learnControlsVisible(role),
    switcher: role !== "client",
    marker: false,
  };
}
