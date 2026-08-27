/**
 * Pure overflow-menu helpers. The client component renders this view;
 * tests can assert open-state items without a DOM.
 */

export type OverflowMenuItemSpec = {
  id: string;
  label: string;
  hidden?: boolean;
  destructive?: boolean;
};

export function visibleOverflowMenuItems<T extends OverflowMenuItemSpec>(items: T[]): T[] {
  return items.filter((item) => !item.hidden);
}

export function overflowMenuView<T extends OverflowMenuItemSpec>(
  open: boolean,
  items: T[],
): { expanded: boolean; itemLabels: string[] } {
  return {
    expanded: open,
    itemLabels: open ? visibleOverflowMenuItems(items).map((item) => item.label) : [],
  };
}

export type PlanRowPointerTarget = "row" | "menu-trigger" | "menu-item";

export function planRowPointerOutcome(target: PlanRowPointerTarget): {
  opensPlan: boolean;
  togglesMenu: boolean;
} {
  return {
    opensPlan: target === "row",
    togglesMenu: target === "menu-trigger",
  };
}

export function planRowMenuItemSpecs(input: {
  status: string;
  disposal: "delete" | "archive";
}): OverflowMenuItemSpec[] {
  return [
    { id: "open", label: "Open" },
    { id: "duplicate", label: "Duplicate" },
    { id: "template", label: "Save as plan template" },
    { id: "unarchive", label: "Unarchive", hidden: input.status !== "archived" },
    {
      id: "delete",
      label: input.disposal === "delete" ? "Delete plan" : "Archive plan",
      destructive: true,
    },
  ];
}
