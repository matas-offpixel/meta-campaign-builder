/**
 * Drawer interaction model. Mirrors OverflowMenu's #871 lesson:
 * a same-tick document closer eats the opening click, so tab content
 * and Done never land in the tree. Defer the subscription one tick
 * and exempt the trigger.
 */

import type { VizPlatform, VizStatus } from "./tokens.ts";

export type DrawerTabSpec = { id: string; label: string };

export type DrawerView = {
  open: boolean;
  platform: VizPlatform;
  tabs: DrawerTabSpec[];
  activeTab: string;
  status: VizStatus;
  showTemplate: boolean;
  showDone: boolean;
  tabContentReachable: boolean;
  doneReachable: boolean;
};

export function drawerView(input: {
  open: boolean;
  platform: VizPlatform;
  tabs: DrawerTabSpec[];
  activeTab: string;
  status: VizStatus;
  hasTemplate?: boolean;
}): DrawerView {
  const active = input.tabs.some((tab) => tab.id === input.activeTab)
    ? input.activeTab
    : (input.tabs[0]?.id ?? "");
  return {
    open: input.open,
    platform: input.platform,
    tabs: input.tabs,
    activeTab: active,
    status: input.status,
    showTemplate: Boolean(input.hasTemplate),
    showDone: input.open,
    tabContentReachable: input.open,
    doneReachable: input.open,
  };
}

export type DrawerPointerTarget = "trigger" | "sheet" | "tab" | "done" | "outside";

/**
 * Opening-click outcome. `subscribeSameTick: true` is the #871 bug:
 * the opening pointer is treated as outside and the sheet never stays open.
 */
export function drawerOpenClick(input: {
  subscribeSameTick: boolean;
  target: DrawerPointerTarget;
}): { open: boolean; doneReachable: boolean; tabContentReachable: boolean } {
  if (input.target === "trigger" && input.subscribeSameTick) {
    return { open: false, doneReachable: false, tabContentReachable: false };
  }
  if (input.target === "trigger") {
    return { open: true, doneReachable: true, tabContentReachable: true };
  }
  if (input.target === "outside") {
    return { open: false, doneReachable: false, tabContentReachable: false };
  }
  return { open: true, doneReachable: true, tabContentReachable: true };
}

export function drawerTabAfterClick(
  tabs: DrawerTabSpec[],
  clickedId: string,
): string {
  return tabs.some((tab) => tab.id === clickedId) ? clickedId : (tabs[0]?.id ?? "");
}

export function shouldIgnoreOutsidePointer(pathHas: {
  trigger: boolean;
  sheet: boolean;
}): boolean {
  return pathHas.trigger || pathHas.sheet;
}
