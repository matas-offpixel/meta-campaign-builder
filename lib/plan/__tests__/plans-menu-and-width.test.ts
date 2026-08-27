/**
 * Live click-through fixes for #870 at 1440×900.
 * Falsify 1 and 3 against parent sha 67f9a4f.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { PLAN_SURFACE_MAX_WIDTH_CLASS } from "../surface.ts";
import {
  overflowMenuView,
  planRowMenuItemSpecs,
  planRowPointerOutcome,
} from "../../viz/overflow-menu.ts";

const PARENT = "67f9a4f";

function buttonsIn(source: string): Array<{ open: string; inner: string }> {
  return [...source.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((match) => ({
    open: match[1],
    inner: match[2],
  }));
}

function buttonHasAccessibleName(button: { open: string; inner: string }): boolean {
  if (/aria-label=/.test(button.open) || /aria-labelledby=/.test(button.open)) return true;
  const text = button.inner.replace(/<[^>]+>/g, "").replace(/\{[^}]+\}/g, "").trim();
  return /[A-Za-z]{2,}/.test(text) || /item\.label/.test(button.inner);
}

describe("1 — OverflowMenu opens and exposes its items", () => {
  it("falsify: parent menu is not portaled and closes on the opening gesture", () => {
    const parent = execFileSync("git", ["show", `${PARENT}:components/viz/overflow-menu.tsx`], {
      encoding: "utf8",
    });
    assert.doesNotMatch(parent, /createPortal/);
    assert.match(parent, /document\.addEventListener\("mousedown"/);
    assert.doesNotMatch(parent, /setTimeout/);
    assert.match(parent, /onClick=\{\(\) => setOpen/);
  });

  it("opening the menu exposes all four draft-row actions", () => {
    const closed = overflowMenuView(false, planRowMenuItemSpecs({ status: "draft", disposal: "delete" }));
    assert.equal(closed.expanded, false);
    assert.deepEqual(closed.itemLabels, []);

    const open = overflowMenuView(true, planRowMenuItemSpecs({ status: "draft", disposal: "delete" }));
    assert.equal(open.expanded, true);
    assert.deepEqual(open.itemLabels, [
      "Open",
      "Duplicate",
      "Save as plan template",
      "Delete plan",
    ]);

    const archived = overflowMenuView(
      true,
      planRowMenuItemSpecs({ status: "archived", disposal: "archive" }),
    );
    assert.deepEqual(archived.itemLabels, [
      "Open",
      "Duplicate",
      "Save as plan template",
      "Unarchive",
      "Archive plan",
    ]);
  });

  it("OverflowMenu portals, defers the outside closer, and PlanRow uses the shared item specs", () => {
    const menu = readFileSync("components/viz/overflow-menu.tsx", "utf8");
    assert.match(menu, /createPortal/);
    assert.match(menu, /document\.body/);
    assert.match(menu, /role="menu"/);
    assert.match(menu, /role="menuitem"/);
    assert.match(menu, /setTimeout/);
    assert.match(menu, /pointerdown/);
    assert.match(menu, /stopPropagation/);
    const rows = readFileSync("components/library/library-rows.tsx", "utf8");
    assert.match(rows, /planRowMenuItemSpecs/);
    assert.match(rows, /OverflowMenu/);
    assert.match(rows, /PlanDeleteAction/);
    assert.match(rows, /trigger="none"/);
    assert.match(readFileSync("lib/viz/overflow-menu.ts", "utf8"), /Save as plan template/);
  });
});

describe("row-click vs menu-click isolation", () => {
  it("row opens the plan; trigger toggles the menu; neither does both", () => {
    assert.deepEqual(planRowPointerOutcome("row"), { opensPlan: true, togglesMenu: false });
    assert.deepEqual(planRowPointerOutcome("menu-trigger"), { opensPlan: false, togglesMenu: true });
    assert.deepEqual(planRowPointerOutcome("menu-item"), { opensPlan: false, togglesMenu: false });
  });

  it("PlanRow keeps the ⋯ outside the row open control and stops propagation on the menu cluster", () => {
    const rows = readFileSync("components/library/library-rows.tsx", "utf8");
    const planRow = rows.slice(rows.indexOf("export function PlanRow"));
    assert.match(planRow, /aria-label=\{planLabel\}/);
    assert.match(planRow, /stopPropagation/);
    assert.match(planRow, /relative z-10/);
    assert.doesNotMatch(
      planRow,
      /<button[\s\S]*OverflowMenu[\s\S]*<\/button>/,
      "OverflowMenu must not sit inside the row open button",
    );
    const menu = readFileSync("components/viz/overflow-menu.tsx", "utf8");
    assert.match(menu, /onTriggerClick/);
    assert.match(menu, /event\.stopPropagation\(\)/);
  });
});

describe("3 — no unnamed interactive elements on the plan row", () => {
  it("falsify: parent row open button has no aria-label", () => {
    const parent = execFileSync("git", ["show", `${PARENT}:components/library/library-rows.tsx`], {
      encoding: "utf8",
    });
    const planRow = parent.slice(parent.indexOf("export function PlanRow"));
    assert.doesNotMatch(planRow, /aria-label=\{plan\.name/);
    assert.doesNotMatch(planRow, /aria-label=\{planLabel\}/);
  });

  it("every button on the row has an accessible name; EventThumb is not a button", () => {
    const rows = readFileSync("components/library/library-rows.tsx", "utf8");
    const planRow = rows.slice(
      rows.indexOf("export function PlanRow"),
      rows.indexOf("export function PlanTemplateRow"),
    );
    const unnamed = buttonsIn(planRow).filter((button) => !buttonHasAccessibleName(button));
    assert.deepEqual(unnamed, [], "PlanRow buttons must have aria-label or text");
    assert.match(planRow, /aria-label=\{planLabel\}/);
    assert.doesNotMatch(planRow, /<button[^>]*>\s*<EventThumb/);

    const menu = readFileSync("components/viz/overflow-menu.tsx", "utf8");
    const unnamedMenu = buttonsIn(menu).filter((button) => !buttonHasAccessibleName(button));
    assert.deepEqual(unnamedMenu, [], "OverflowMenu buttons must have aria-label or text");
    assert.match(menu, /aria-label=\{label\}/);

    const thumb = readFileSync("components/viz/event-thumb.tsx", "utf8");
    assert.doesNotMatch(thumb, /<button/);
  });
});

describe("width — plan surfaces only", () => {
  it("applies the 1400px reading cap on /plans and /plan/[id], not the shared header default", () => {
    assert.equal(PLAN_SURFACE_MAX_WIDTH_CLASS, "max-w-[1400px]");
    const list = readFileSync("app/(dashboard)/plans/page.tsx", "utf8");
    const detail = readFileSync("app/(dashboard)/plan/[id]/page.tsx", "utf8");
    assert.match(list, /PLAN_SURFACE_MAX_WIDTH_CLASS/);
    assert.match(detail, /PLAN_SURFACE_MAX_WIDTH_CLASS/);
    assert.doesNotMatch(list, /max-w-6xl/);
    assert.doesNotMatch(detail, /max-w-6xl/);
    const header = readFileSync("components/dashboard/page-header.tsx", "utf8");
    assert.match(header, /contentClassName = "max-w-6xl"/);
    const overview = readFileSync("app/(dashboard)/overview/page.tsx", "utf8");
    assert.match(overview, /max-w-\[1400px\]/);
    assert.doesNotMatch(overview, /PLAN_SURFACE_MAX_WIDTH_CLASS/);
  });
});
