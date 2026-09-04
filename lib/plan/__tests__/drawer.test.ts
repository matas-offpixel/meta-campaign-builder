/**
 * PR 4 — the Meta drawer.
 *
 * Two halves. The model half exercises `lib/plan/drawer.ts` directly: the
 * tab an anchor opens, the URL a refresh survives, the `⊞` tab's one
 * dependency, `validateStep` → badge rows, and the `details` rows.
 *
 * The structural half is the grep-guard the repo uses in place of a React
 * renderer (there is none, and adding one is a new dependency): it reads
 * the drawer-mounted sources and asserts the invariants a render test
 * would have asserted — no standing `<p>`, no `CardDescription` from the
 * shared card primitive, no route change on open, no wizard Launch on a
 * plan-linked draft.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { planChannelRows } from "../canvas.ts";
import { execSync } from "node:child_process";

import {
  DETAIL_ROW_ORDER,
  DECISIONS_QUERY_VALUE,
  DRAWER_QUERY_KEY,
  DRAWER_TABS,
  GOOGLE_DRAWER_TABS,
  LAUNCH_ON_CANVAS_LABEL,
  META_DRAWER_TABS,
  TIKTOK_DRAWER_TABS,
  adsetsTabWaiting,
  blockerRowsFromValidation,
  detailRows,
  drawerUrl,
  googleKeywordBlockers,
  isGoogleDrawerTab,
  isMetaDrawerTab,
  isTikTokDrawerTab,
  readDrawerUrl,
  sectionForStep,
  tabForAnchor,
  tiktokAssignTabVisible,
  tiktokNeedsVideoBlockers,
} from "../drawer.ts";
import { planTargetChip } from "../canvas-inputs.ts";
import { VIZ_PROVENANCE_MARK } from "../../viz/tokens.ts";
import { FIXTURE_HREFS, basePlan, blockingIssues, factsBundle } from "./canvas-fixtures.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/**
 * Every source that renders inside the drawer. The three tabs, the two
 * halves of budget-schedule, the four demoted steps in `details`, the
 * attach pickers in `⊞`, and the two retry panels under launch issues.
 */
const DRAWER_MOUNTED = [
  "components/steps/audiences/audiences-step.tsx",
  "components/steps/audiences/page-audiences-panel.tsx",
  "components/steps/audiences/custom-audiences-panel.tsx",
  "components/steps/audiences/saved-audiences-panel.tsx",
  "components/steps/audiences/interest-groups-panel.tsx",
  "components/steps/creatives.tsx",
  "components/steps/budget-schedule.tsx",
  "components/steps/assign-creatives.tsx",
  "components/steps/account-setup.tsx",
  "components/steps/campaign-setup.tsx",
  "components/steps/optimisation-strategy.tsx",
  "components/steps/adset-picker.tsx",
  "components/steps/cross-campaign-adset-picker.tsx",
  "components/bulk-attach/campaign-multi-picker.tsx",
  "components/tiktok-wizard/steps/creatives.tsx",
  "components/tiktok-wizard/steps/audiences.tsx",
  "components/tiktok-wizard/steps/assign-creatives.tsx",
  "components/tiktok-wizard/steps/account-setup.tsx",
  "components/tiktok-wizard/steps/campaign-setup.tsx",
  "components/tiktok-wizard/steps/optimisation-strategy.tsx",
  "components/tiktok-wizard/steps/budget-schedule.tsx",
  "components/tiktok-wizard/steps/review-launch.tsx",
  "components/google-search-wizard/steps/ad-groups-keywords.tsx",
  "components/google-search-wizard/steps/negatives.tsx",
  "components/google-search-wizard/steps/ad-copy.tsx",
  "components/google-search-wizard/steps/plan-setup.tsx",
  "components/google-search-wizard/steps/campaigns.tsx",
  "components/google-search-wizard/steps/targeting-budget.tsx",
  "components/google-search-wizard/steps/push.tsx",
  "components/plan/decisions-sheet.tsx",
];

// ── A. the drawer opens at the section a row or a blocker names ────────

describe("drawer anchors", () => {
  it("opens at each of the three Meta sections", () => {
    for (const tab of META_DRAWER_TABS) {
      assert.equal(
        tabForAnchor("meta", { drawer: "meta", section: tab.id }),
        tab.id,
        `${tab.id} should open its own tab`,
      );
    }
  });

  it("a row with no more specific anchor opens audiences", () => {
    assert.equal(tabForAnchor("meta", null), "f-audiences");
    assert.equal(tabForAnchor("meta", undefined), "f-audiences");
  });

  it("an anchor for another drawer does not open a Meta tab", () => {
    assert.equal(tabForAnchor("meta", { drawer: "tiktok", section: "tt-video" }), "f-audiences");
  });

  it("an unknown section falls back rather than opening nothing", () => {
    assert.equal(tabForAnchor("meta", { drawer: "meta", section: "f-nope" }), "f-audiences");
  });

  /** The contract PR 5 inherits: same shell, same anchor ids. */
  it("TikTok and Google carry the section ids PR 5 must use", () => {
    assert.deepEqual(
      DRAWER_TABS.tiktok.map((t) => t.id),
      ["tt-video", "tt-refine"],
    );
    assert.deepEqual(
      DRAWER_TABS.google.map((t) => t.id),
      ["g-keywords", "g-copy"],
    );
  });

  it("only the three Meta ids are Meta tabs", () => {
    assert.ok(isMetaDrawerTab("f-adsets"));
    assert.ok(!isMetaDrawerTab("tt-video"));
    assert.ok(!isMetaDrawerTab("details"));
  });
});

// ── A. opening is not a navigation ─────────────────────────────────────

describe("drawer URL", () => {
  it("stays on /plan/[id] and carries the drawer in the query", () => {
    const url = drawerUrl("/plan/p1", { adapter: "meta", tab: "f-creatives" });
    assert.ok(url.startsWith("/plan/p1?"), url);
    assert.match(url, /drawer=f/);
    assert.match(url, /tab=f-creatives/);
  });

  it("closing leaves no trace", () => {
    assert.equal(drawerUrl("/plan/p1", { adapter: null, tab: null }), "/plan/p1");
  });

  it("preserves query params it does not own", () => {
    const url = drawerUrl(
      "/plan/p1",
      { adapter: "meta", tab: "f-adsets" },
      new URLSearchParams("event=e1"),
    );
    assert.match(url, /event=e1/);
  });

  it("a refresh reopens the drawer at its tab", () => {
    const state = readDrawerUrl(new URLSearchParams("drawer=f&tab=f-adsets"));
    assert.deepEqual(state, { adapter: "meta", tab: "f-adsets" });
  });

  it("a tab that does not exist reopens the drawer at its first tab", () => {
    assert.deepEqual(readDrawerUrl(new URLSearchParams("drawer=f&tab=nope")), {
      adapter: "meta",
      tab: null,
    });
  });

  it("no drawer in the query means no drawer", () => {
    assert.deepEqual(readDrawerUrl(new URLSearchParams("event=e1")), {
      adapter: null,
      tab: null,
    });
  });

  it("decisions sheet round-trips as ?drawer=decisions", () => {
    const url = drawerUrl("/plan/p1", { adapter: null, tab: null, sheet: "decisions" });
    assert.equal(url, `/plan/p1?${DRAWER_QUERY_KEY}=${DECISIONS_QUERY_VALUE}`);
    assert.deepEqual(readDrawerUrl(new URLSearchParams(`${DRAWER_QUERY_KEY}=${DECISIONS_QUERY_VALUE}`)), {
      adapter: null,
      tab: null,
      sheet: "decisions",
    });
  });

  it("decisions does not steal a channel drawer", () => {
    assert.deepEqual(readDrawerUrl(new URLSearchParams("drawer=f")), {
      adapter: "meta",
      tab: null,
    });
  });

  it("the canvas restores and writes the decisions sheet", () => {
    const src = read("components/plan/plan-workspace.tsx");
    assert.match(src, /fromUrl\.sheet === "decisions"/);
    assert.match(src, /sheet: "decisions"/);
    assert.match(src, /<DecisionsSheet/);
    assert.match(src, /setDecisionsOpen\(true\)/);
  });

  it("the canvas replaces the URL rather than pushing a route", () => {
    const src = read("components/plan/plan-workspace.tsx");
    /**
     * `openChannel` for Meta must not navigate. A `router.push` to
     * `/campaign/...` inside the drawer branch would put the wizard back.
     */
    const opens = src.slice(src.indexOf("function openDrawerOrWizard"));
    const body = opens.slice(0, opens.indexOf("\n  }"));
    assert.match(body, /setDrawer\(/, "every adapter opens the drawer in state");
    assert.ok(!/adapter === "meta"/.test(body), "the Meta-only gate is gone");
    assert.ok(!/router\.push/.test(body), "no adapter navigates to a wizard");
    assert.match(
      src,
      new RegExp(`router\\.replace\\([^)]*drawerUrl|drawerUrl\\(`),
      "drawer state is written with a shallow replace",
    );
  });

  it("Done closes and flushes, and does not navigate", () => {
    const src = read("components/plan/meta-drawer.tsx");
    const done = src.slice(src.indexOf("const done = useCallback"));
    const body = done.slice(0, done.indexOf("}, ["));
    assert.match(body, /flush\(\)/, "a pending debounce is flushed");
    assert.match(body, /onClose\(\)/, "and the drawer closes");
    assert.ok(!/router\.(push|replace)/.test(body), "Done must not navigate");
  });
});

// ── B. the ⊞ tab waits for the audiences it reads ──────────────────────

describe("⊞ waiting state", () => {
  it("waits until at least one audience exists", () => {
    assert.equal(adsetsTabWaiting(0).waiting, true);
    assert.equal(adsetsTabWaiting(1).waiting, false);
  });

  it("names what it is waiting for", () => {
    assert.equal(adsetsTabWaiting(0).label, "waiting for audiences");
    assert.equal(adsetsTabWaiting(0).waitingFor, "meta");
  });

  it("the tab renders the waiting state instead of the rows", () => {
    const src = read("components/plan/meta-drawer.tsx");
    assert.match(src, /adsetsTabWaiting\(audienceCount\)/);
    const tab = src.slice(src.indexOf("function AdSetsTab"));
    assert.ok(
      tab.indexOf("if (waiting)") < tab.indexOf("<BudgetSchedule"),
      "the waiting return precedes the rows",
    );
  });
});

// ── F. validateStep results become anchored badge rows ─────────────────

describe("step blockers", () => {
  it("anchors each step at the tab that owns it", () => {
    assert.equal(sectionForStep(3), "f-audiences");
    assert.equal(sectionForStep(4), "f-creatives");
    assert.equal(sectionForStep(5), "f-adsets");
    assert.equal(sectionForStep(6), "f-adsets");
  });

  it("a step with no tab of its own answers to the first", () => {
    assert.equal(sectionForStep(0), "f-audiences");
    assert.equal(sectionForStep(1), "f-audiences");
  });

  it("carries the anchor a badge click can open", () => {
    const rows = blockerRowsFromValidation([
      { step: 4, errors: ["Add at least one creative"] },
    ]);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0]!.anchor, { drawer: "meta", section: "f-creatives" });
    assert.equal(rows[0]!.kind, "blocker");
    assert.equal(rows[0]!.full, "Add at least one creative");
  });

  it("shortens the label but keeps the full message", () => {
    const [row] = blockerRowsFromValidation([
      { step: 3, errors: ["Select at least one audience before continuing to ad sets"] },
    ]);
    assert.ok(row!.label.split(" ").length <= 5);
    assert.equal(row!.full, "Select at least one audience before continuing to ad sets");
  });

  it("dedupes a message two steps both report", () => {
    const rows = blockerRowsFromValidation([
      { step: 3, errors: ["Select at least one audience"] },
      { step: 6, errors: ["Select at least one audience"] },
    ]);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0]!.anchor?.section, "f-audiences", "first step wins the anchor");
  });

  it("drops empty messages", () => {
    assert.equal(blockerRowsFromValidation([{ step: 3, errors: ["", "   "] }]).length, 0);
  });

  it("the canvas Meta row shows them next to the preflight rows", () => {
    const rows = planChannelRows({
      plan: basePlan(),
      issues: blockingIssues(),
      facts: factsBundle(),
      hrefs: FIXTURE_HREFS,
      drawerBlockers: {
        meta: blockerRowsFromValidation([
          { step: 3, errors: ["Select at least one audience"] },
        ]),
      },
    });
    const meta = rows.find((row) => row.adapter === "meta")!;
    const messages = meta.blockers.map((b) => b.full);
    assert.ok(
      messages.includes("No creatives on the Meta draft"),
      "preflight is unchanged",
    );
    assert.ok(messages.includes("Select at least one audience"), "step blockers are added");
  });

  it("does not double-report a message preflight already raised", () => {
    const shared = "No creatives on the Meta draft";
    const rows = planChannelRows({
      plan: basePlan(),
      issues: blockingIssues(),
      facts: factsBundle(),
      hrefs: FIXTURE_HREFS,
      drawerBlockers: { meta: blockerRowsFromValidation([{ step: 4, errors: [shared] }]) },
    });
    const meta = rows.find((row) => row.adapter === "meta")!;
    assert.equal(meta.blockers.filter((b) => b.full === shared).length, 1);
  });

  it("a channel with no budget gains no step blockers", () => {
    const plan = basePlan();
    plan.intent.budget = { totalDaily: 96, metaDaily: 96, tiktokDaily: 0, googleDaily: 0 };
    const rows = planChannelRows({
      plan,
      issues: [],
      facts: factsBundle(),
      hrefs: FIXTURE_HREFS,
      drawerBlockers: {
        tiktok: blockerRowsFromValidation([{ step: 3, errors: ["anything"] }]),
      },
    });
    const skipped = rows.filter((row) => row.skipped);
    assert.ok(skipped.length > 0, "the fixture has a skipped channel");
    for (const row of skipped) assert.equal(row.blockers.length, 0);
  });
});

// ── C. the details rows carry their provenance ─────────────────────────

describe("details disclosure", () => {
  it("renders every demoted datum §3a names", () => {
    const rows = detailRows({});
    assert.deepEqual(
      rows.map((row) => row.id),
      [...DETAIL_ROW_ORDER],
    );
    for (const name of ["account", "pixel", "page", "instagram", "code", "name", "objective", "goal", "placements", "age", "geo", "timezone", "budget", "schedule", "preset"]) {
      assert.ok(rows.some((row) => row.id === name), `${name} is missing`);
    }
  });

  it("an unresolved row reads not-instrumented, never as an empty field", () => {
    const [account] = detailRows({});
    assert.equal(account!.value, null);
    assert.equal(account!.provenance, "not instrumented");
  });

  it("carries the provenance the caller resolved", () => {
    const rows = detailRows({
      account: { value: "act_1", provenance: "derived" },
      preset: { value: "balanced · v3", provenance: "industry seed" },
    });
    assert.equal(rows.find((r) => r.id === "account")!.provenance, "derived");
    assert.equal(rows.find((r) => r.id === "preset")!.provenance, "industry seed");
  });

  /**
   * The rows the wizard let an operator override per campaign, and only
   * those. Budget and schedule belong to the canvas; the code, the name,
   * the geo and the timezone belong to the event.
   */
  it("only the six per-campaign overrides are editable here", () => {
    const editable = detailRows({})
      .filter((row) => row.editable)
      .map((row) => row.id);
    assert.deepEqual(editable, [
      "account",
      "pixel",
      "page",
      "instagram",
      "objective",
      "goal",
    ]);
  });

  it("the four demoted steps render only inside this disclosure", () => {
    const details = read("components/plan/meta-drawer-details.tsx");
    for (const step of ["AccountSetup", "CampaignSetup", "BudgetSchedule", "OptimisationStrategy"]) {
      assert.match(details, new RegExp(`<${step}\\b`), `${step} should mount in details`);
    }
    /** Each is mounted at `surface="drawer"`, which is what strips it. */
    assert.equal(
      (details.match(/surface="drawer"/g) ?? []).length,
      4,
      "every demoted step is mounted on the drawer surface",
    );
  });

  it("budget-schedule renders each of its halves once", () => {
    const src = read("components/steps/budget-schedule.tsx");
    assert.match(src, /const showDemoted = surface !== "drawer" \|\| variant === "details"/);
    assert.match(src, /const showAdSets = surface !== "drawer" \|\| variant === "adsets"/);
    const details = read("components/plan/meta-drawer-details.tsx");
    assert.match(details, /variant="details"/, "details takes the demoted half");
    const drawer = read("components/plan/meta-drawer.tsx");
    assert.ok(
      !/variant="details"/.test(drawer),
      "the ⊞ tab takes the ad-set half, which is the default",
    );
  });
});

// ── the surface="drawer" contract ──────────────────────────────────────

describe("surface=drawer strips chrome and nothing else", () => {
  it("every drawer-mounted source takes a surface or sits under one", () => {
    for (const file of DRAWER_MOUNTED) {
      const src = read(file);
      assert.ok(
        /surface\?: StepSurface/.test(src) || /useIsDrawer|Prose|Datum|StatusLine|Chrome/.test(src),
        `${file} neither takes a surface nor routes its chrome`,
      );
    }
  });

  /**
   * The zero-`<p>` rule. A raw `<p>` in a drawer-mounted source is a
   * sentence that survives into the drawer, which §3 forbids — so every
   * one is routed through `Prose` (hidden), `StatusLine` (kept, as a
   * span) or `Datum` (kept, as a span). A `<p>` inside a `<Chrome>`
   * subtree is allowed, because `Chrome` returns null in a drawer.
   */
  it("no standing <p> renders in the drawer", () => {
    for (const file of DRAWER_MOUNTED) {
      const src = read(file);
      for (const match of src.matchAll(/<p[\s>]/g)) {
        const before = src.slice(0, match.index);
        const opens = (before.match(/<Chrome>/g) ?? []).length;
        const closes = (before.match(/<\/Chrome>/g) ?? []).length;
        assert.ok(
          opens > closes,
          `${file}: a <p> at offset ${match.index} is outside <Chrome> — route it through Prose, Datum or StatusLine`,
        );
      }
    }
  });

  it("no CardDescription comes from the shared card primitive", () => {
    for (const file of DRAWER_MOUNTED) {
      const src = read(file);
      const cardImport = src.match(/import \{([^}]*)\} from "@\/components\/ui\/card";/);
      if (!cardImport) continue;
      assert.ok(
        !/\bCardDescription\b/.test(cardImport[1]!),
        `${file} imports CardDescription from the card primitive; import it from step-surface so it disappears in the drawer`,
      );
    }
  });

  it("the primitives are the only place the rule is decided", () => {
    const src = read("components/steps/step-surface.tsx");
    for (const primitive of ["Prose", "Chrome", "CardDescription"]) {
      const at = src.indexOf(`export function ${primitive}(`);
      assert.ok(at > 0, `${primitive} is missing`);
      assert.match(
        src.slice(at, at + 220),
        /if \(useIsDrawer\(\)\) return null/,
        `${primitive} must vanish in a drawer`,
      );
    }
    /** Evidence is kept — as a span, so the zero-`<p>` claim stays honest. */
    for (const primitive of ["Datum", "StatusLine"]) {
      const at = src.indexOf(`export function ${primitive}(`);
      const body = src.slice(at, at + 420);
      assert.match(body, /if \(useIsDrawer\(\)\)/, `${primitive} branches on the surface`);
      assert.match(body, /<span/, `${primitive} keeps rendering, as a span`);
    }
  });

  /** §3a drops these three from the creatives tab; the wizard keeps them. */
  it("the creatives tab drops the re-entry fields §3a names", () => {
    const src = read("components/steps/creatives.tsx");
    assert.match(
      src,
      /drawer \? \(\s*<DestinationBadge/,
      "the per-ad destination URL becomes a badge",
    );
    assert.match(src, /function DestinationBadge/, "and the badge exists");
    assert.match(src, /META_DRAWER_COPY\.destinationTip/, "with a tip pointing at the canvas");
  });

  it("the page/IG panel renders once, on the audiences tab", () => {
    const audiences = read("components/steps/audiences/audiences-step.tsx");
    const creatives = read("components/steps/creatives.tsx");
    assert.match(audiences, /<PageInstagramOverridesPanel/, "audiences owns it");
    const at = creatives.indexOf("<PageInstagramOverridesPanel");
    assert.ok(at > 0, "creatives still has one for the wizard");
    const before = creatives.slice(0, at);
    assert.ok(
      (before.match(/<Chrome>/g) ?? []).length > (before.match(/<\/Chrome>/g) ?? []).length,
      "the creatives copy is inside <Chrome>, so the drawer shows one",
    );
  });
});

// ── D + E. the template loader and the launch pointer ──────────────────

describe("template loader", () => {
  it("the drawer header carries one template control", () => {
    const drawer = read("components/viz/drawer.tsx");
    assert.match(drawer, /⌁ template ▸/);
    const meta = read("components/plan/meta-drawer.tsx");
    assert.match(meta, /loadTemplatesFromDb/, "reading from lib/db/templates");
    assert.match(meta, /onLoadTemplate=\{/, "wired to the header control");
  });

  it("the wizard's own load-template control no longer renders", () => {
    const footer = read("components/wizard/wizard-footer.tsx");
    assert.ok(!/Load Template/.test(footer), "the footer's Load Template is gone");
    assert.ok(!/onLoadTemplate/.test(footer));
  });
});

describe("launch belongs to the canvas for a plan-linked draft", () => {
  it("the wizard footer offers a pointer instead of Launch", () => {
    const footer = read("components/wizard/wizard-footer.tsx");
    assert.match(footer, /showLaunch \? \(/, "Launch is conditional");
    assert.match(footer, /LAUNCH_ON_CANVAS_LABEL/, "and the alternative is the pointer");
    assert.match(footer, /planHref/, "which links to the plan");
  });

  it("the shell hides it exactly when the draft has a plan", () => {
    const shell = read("components/wizard/wizard-shell.tsx");
    assert.match(shell, /showLaunch=\{!linkedPlan\}/);
    assert.match(shell, /planHref=\{linkedPlan \? `\/plan\/\$\{linkedPlan\.id\}` : null\}/);
  });

  it("a standalone draft still renders review and its Launch", () => {
    const shell = read("components/wizard/wizard-shell.tsx");
    assert.match(shell, /!linkedPlan && \(/, "review is gated on there being no plan");
    assert.match(shell, /<ReviewLaunch/);
  });

  it("the retry panels move under the ⊞ tab so they stay reachable", () => {
    const review = read("components/steps/review-launch.tsx");
    assert.match(review, /export function RetryFailedAdsPanel/);
    assert.match(review, /export function RetryLookalikesPanel/);
    const meta = read("components/plan/meta-drawer.tsx");
    assert.match(meta, /<RetryFailedAdsPanel/);
    assert.match(meta, /<RetryLookalikesPanel/);
    assert.match(meta, /function LaunchIssues/);
  });

  it("the pointer says where launch went", () => {
    assert.match(LAUNCH_ON_CANVAS_LABEL, /canvas/i);
  });
});

// ── standalone /campaign/[id] is the same drawer ────────────────────────

describe("/campaign/[id] renders the same drawer", () => {
  it("the shell mounts MetaDrawer full-page, not a stepper", () => {
    const shell = read("components/wizard/wizard-shell.tsx");
    assert.match(shell, /<MetaDrawer/);
    assert.match(shell, /variant="page"/);
    assert.ok(!/<WizardStepper/.test(shell), "the eight-step stepper no longer renders");
  });

  it("both surfaces mount the one component", () => {
    const workspace = read("components/plan/plan-workspace.tsx");
    assert.match(workspace, /<MetaDrawerMount/, "the canvas mounts it as a sheet");
    const shell = read("components/wizard/wizard-shell.tsx");
    assert.match(shell, /<MetaDrawer/, "and /campaign/[id] as a page");
  });

  it("the page variant is not modal — there is nothing behind it", () => {
    const drawer = read("components/viz/drawer.tsx");
    assert.match(drawer, /variant\?: "sheet" \| "page"/);
    assert.match(drawer, /variant === "page"/);
  });

  it("both share one draft controller, so neither forks persistence", () => {
    const hook = read("lib/wizard/use-campaign-draft.ts");
    assert.match(hook, /export function useCampaignDraft/);
    assert.match(read("components/wizard/wizard-shell.tsx"), /useCampaignDraft\(/);
    assert.match(read("components/plan/meta-drawer.tsx"), /useCampaignDraft\(/);
  });
});

// ── decision 2. attach modes are first class ───────────────────────────

describe("attach modes", () => {
  it("the header carries the mode", () => {
    const src = read("components/plan/meta-drawer.tsx");
    assert.match(src, /function ModeChip/);
    for (const mode of ["attach_campaign", "attach_adset", "attach_all_adsets"]) {
      assert.match(src, new RegExp(`"${mode}"`), `${mode} is recognised`);
    }
    assert.match(src, /header=\{<ModeChip mode=\{mode\} \/>\}/);
  });

  it("the ⊞ tab shows the pickers rather than suggestions", () => {
    const src = read("components/plan/meta-drawer.tsx");
    assert.match(src, /attachMode \? \(\s*<CampaignSetup/);
  });

  it("campaign-setup owns the pickers and keeps them", () => {
    const src = read("components/steps/campaign-setup.tsx");
    assert.match(src, /<CrossCampaignAdSetPicker/);
    assert.match(src, /<AdSetPicker/);
    assert.match(src, /<CampaignMultiPicker/);
  });

  it("it mounts once — in the ⊞ tab in an attach mode, in details otherwise", () => {
    const src = read("components/plan/meta-drawer.tsx");
    assert.match(src, /showCampaignSetup=\{mode === "new"\}/);
  });

  it("attach_adset projects the picked ad sets onto the assign matrix", () => {
    const src = read("components/plan/meta-drawer.tsx");
    assert.match(src, /attachedAdSetKey\(/, "the same key the wizard used");
    assert.match(src, /attachAdSetMode/);
  });

  it("attach_all_adsets has no per-ad-set assignment to make", () => {
    const src = read("components/plan/meta-drawer.tsx");
    assert.match(src, /showAssign=\{mode !== "attach_all_adsets"\}/);
  });

  it("an attach mode's inherited steps raise no blockers", () => {
    const src = read("components/plan/meta-drawer.tsx");
    assert.match(src, /getVisibleSteps\(mode\)/, "only visible steps are validated");
  });
});

// ── G. the two provenance fixes from #878's render ─────────────────────

describe("provenance reads honestly", () => {
  it("manual never borrows the derived glyph", () => {
    assert.notEqual(VIZ_PROVENANCE_MARK["manual entry"], VIZ_PROVENANCE_MARK.derived);
    assert.ok(
      !VIZ_PROVENANCE_MARK["manual entry"].includes("⌁"),
      "a value the operator typed is not derived",
    );
  });

  it("a target nobody has typed reads as a seed, not as a model", () => {
    const chip = planTargetChip({ value: null, unit: "reg", benchmark: 12, currency: "£" });
    assert.equal(chip.provenance, "industry seed");
    assert.equal(VIZ_PROVENANCE_MARK["industry seed"], "seed");
  });

  it("a target the operator typed reads as manual", () => {
    const chip = planTargetChip({ value: 9, unit: "reg", benchmark: 12, currency: "£" });
    assert.equal(chip.provenance, "manual entry");
  });
});

// ── the drawer is not a route ──────────────────────────────────────────

describe("the drawer query key is the one PR 5 will reuse", () => {
  it("names the drawer, not the platform", () => {
    assert.equal(DRAWER_QUERY_KEY, "drawer");
    assert.equal(drawerUrl("/plan/p1", { adapter: "tiktok", tab: "tt-video" }), "/plan/p1?drawer=tt&tab=tt-video");
    assert.equal(drawerUrl("/plan/p1", { adapter: "google", tab: "g-copy" }), "/plan/p1?drawer=g&tab=g-copy");
  });

  it("?drawer=tt&tab=tt-video and ?drawer=g&tab=g-copy round-trip", () => {
    assert.deepEqual(readDrawerUrl(new URLSearchParams("drawer=tt&tab=tt-video")), {
      adapter: "tiktok",
      tab: "tt-video",
    });
    assert.deepEqual(readDrawerUrl(new URLSearchParams("drawer=g&tab=g-copy")), {
      adapter: "google",
      tab: "g-copy",
    });
  });
});

// ── PR 5. TikTok + Google drawers ──────────────────────────────────────

describe("TikTok and Google drawers open at each anchor", () => {
  it("each TikTok tab is its own landing", () => {
    for (const tab of TIKTOK_DRAWER_TABS) {
      assert.equal(tabForAnchor("tiktok", { drawer: "tiktok", section: tab.id }), tab.id);
      assert.ok(isTikTokDrawerTab(tab.id));
    }
  });

  it("each Google tab is its own landing", () => {
    for (const tab of GOOGLE_DRAWER_TABS) {
      assert.equal(tabForAnchor("google", { drawer: "google", section: tab.id }), tab.id);
      assert.ok(isGoogleDrawerTab(tab.id));
    }
  });

  it("a row with no more specific anchor opens the first tab", () => {
    assert.equal(tabForAnchor("tiktok", null), "tt-video");
    assert.equal(tabForAnchor("google", null), "g-keywords");
  });

  it("the canvas mounts both drawers and wires a ref per adapter", () => {
    const src = read("components/plan/plan-workspace.tsx");
    assert.match(src, /<TikTokDrawerMount/);
    assert.match(src, /<GoogleDrawerMount/);
    assert.match(src, /tiktok: tiktokOpenRef/);
    assert.match(src, /google: googleOpenRef/);
    assert.match(src, /drawer\?\.adapter === "tiktok"/);
    assert.match(src, /drawer\?\.adapter === "google"/);
  });

  it("a blocker click uses the same openDrawerOrWizard as a row", () => {
    const src = read("components/plan/plan-workspace.tsx");
    assert.match(src, /onOpenAnchor=\{\(row, anchor\) => void openChannel\(row, undefined, anchor\)\}/);
    assert.match(src, /openDrawerOrWizard\(row\.adapter, row\.draftId, anchor \?\? row\.anchor\)/);
  });
});

describe("TikTok needs-1 blocker", () => {
  it("anchors tt-video when no videoId is present", () => {
    const rows = tiktokNeedsVideoBlockers({ items: [{ videoId: null }, { videoId: "" }] });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.label, "needs 1");
    assert.deepEqual(rows[0]!.anchor, { drawer: "tiktok", section: "tt-video" });
  });

  it("is silent once a real video exists", () => {
    assert.equal(tiktokNeedsVideoBlockers({ items: [{ videoId: "v1" }] }).length, 0);
  });

  it("assign appears only when there is more than one routed video", () => {
    assert.equal(tiktokAssignTabVisible(1), false);
    assert.equal(tiktokAssignTabVisible(2), true);
  });
});

describe("Google keyword blockers", () => {
  it("anchors g-keywords with the row index", () => {
    const rows = googleKeywordBlockers({
      campaigns: [
        {
          ad_groups: [
            {
              keywords: [
                { id: "k1", keyword: "hard techno", match_type: null },
                { id: "k2", keyword: "  ", match_type: "PHRASE" },
              ],
            },
          ],
        },
      ],
    });
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.label, "hard techno — no match type → fix ▸");
    assert.ok(rows[0]!.full?.includes("1:"));
    assert.deepEqual(rows[0]!.anchor, { drawer: "google", section: "g-keywords" });
    assert.match(rows[1]!.label, /no text/);
    assert.deepEqual(rows[1]!.anchor, { drawer: "google", section: "g-keywords" });
  });
});

describe("standalone pages keep Launch / Push", () => {
  it("/tiktok-campaign/[id] is the same drawer, page variant", () => {
    const shell = read("components/tiktok-wizard/wizard-shell.tsx");
    assert.match(shell, /<TikTokDrawer/);
    assert.match(shell, /variant="page"/);
    assert.ok(!/TikTokWizardFooter/.test(shell), "the stepper footer is gone");
    assert.ok(!/TIKTOK_WIZARD_STEPS\.map/.test(shell), "the eight-step stepper is gone");
  });

  it("a standalone TikTok draft still renders ReviewLaunch", () => {
    const drawer = read("components/plan/tiktok-drawer.tsx");
    assert.match(drawer, /variant === "page" && !planId/);
    assert.match(drawer, /<ReviewLaunchStep/);
  });

  it("/google-search/[id] is the same drawer, page variant", () => {
    const shell = read("components/google-search-wizard/wizard-shell.tsx");
    assert.match(shell, /<GoogleDrawer/);
    assert.match(shell, /variant="page"/);
    assert.ok(!/GOOGLE_SEARCH_WIZARD_STEPS\.map/.test(shell), "the eight-step stepper is gone");
  });

  it("a standalone Google tree still renders Push", () => {
    const drawer = read("components/plan/google-drawer.tsx");
    assert.match(drawer, /variant === "page" && !planId/);
    assert.match(drawer, /<PushStep/);
  });

  it("Google has no templates — the loader is present and disabled", () => {
    const drawer = read("components/plan/google-drawer.tsx");
    assert.match(drawer, /noTemplatesTip/);
    assert.match(drawer, /aria-disabled="true"/);
    assert.ok(!/onLoadTemplate/.test(drawer), "the header control is not wired");
  });

  it("TikTok loads templates from lib/db/tiktok-templates", () => {
    const drawer = read("components/plan/tiktok-drawer.tsx");
    assert.match(drawer, /loadTikTokTemplatesFromDb/);
    assert.match(drawer, /onLoadTemplate=/);
  });
});

describe("write paths are untouched", () => {
  it("lib/tiktok/write and lib/google-search have no diff against main", () => {
    /**
     * CI's pull_request checkout has `origin/main` and no local `main`
     * (`fatal: bad revision 'main'`). Resolve either, then diff.
     */
    let base = "";
    for (const ref of ["origin/main", "main"] as const) {
      try {
        base = execSync(`git rev-parse --verify ${ref}`, {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim();
        break;
      } catch {
        continue;
      }
    }
    assert.ok(base, "neither origin/main nor main exists");
    const diff = execSync(`git diff ${base} -- lib/tiktok/write lib/google-search`, {
      encoding: "utf8",
    });
    assert.equal(diff.trim(), "", diff);
  });

  it("evaluate.ts tick-runner.ts gates.ts apply.ts have no diff against main", () => {
    let base = "";
    for (const ref of ["origin/main", "main"] as const) {
      try {
        base = execSync(`git rev-parse --verify ${ref}`, {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim();
        break;
      } catch {
        continue;
      }
    }
    assert.ok(base, "neither origin/main nor main exists");
    const diff = execSync(
      `git diff ${base} -- lib/optimisation/evaluate.ts lib/optimisation/tick-runner.ts lib/optimisation/gates.ts lib/optimisation/apply.ts`,
      { encoding: "utf8" },
    );
    assert.equal(diff.trim(), "", diff);
  });
});
