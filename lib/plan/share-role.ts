/**
 * Canon §1.6 — one overlay per face. Role changes what renders around
 * an exhibit, never whether the exhibit exists. No switcher, no marker.
 */

import { adjustControlsVisible } from "./adjust-face.ts";
import { launchControlsVisible } from "./launch-face.ts";
import { learnControlsVisible } from "./learn-face.ts";

export type PlanRole = "operator" | "client";

export function planSharePath(token: string): string {
  return `/share/plan/${token}`;
}

export function planShareHref(token: string, origin?: string): string {
  const path = planSharePath(token);
  return origin ? `${origin}${path}` : path;
}

/** 16-char base64url — same shape as report_shares. A plan uuid is not a token. */
const PLAN_SHARE_TOKEN = /^[A-Za-z0-9_-]{16}$/;

export function isPlanShareToken(value: string): boolean {
  return PLAN_SHARE_TOKEN.test(value);
}

const PLAN_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Internal plan id after a token resolve. Never a URL credential. */
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
