import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { stringify } from "node:querystring";
import { describe, it } from "node:test";

import { resolveChannelDefaults } from "../../clients/channel-defaults.ts";
import { EMPTY_IDENTITY_NAMES } from "../identity-chips.ts";
import { launchBlockerGroups } from "../launch-face.ts";
import {
  MML_LEGACY_REDIRECTS,
  MML_LIST_PATH,
  MML_NEW_HREF,
  mmlNavMatch,
  mmlPlanHref,
} from "../mml-routes.ts";
import {
  MML_SECTION,
  MML_SECTIONS,
  channelDefaultsHref,
  mmlPromoterIdentityRows,
  mmlSectionMarker,
} from "../mml-sections.ts";
import { scopedGoogleIssueMessage, type PlanPreflightIssue } from "../preflight.ts";
import { planContinuationHref } from "../schedule.ts";
import {
  collapseOverlappingMomentLabels,
  momentLabelBox,
  momentMarkAlign,
} from "../../viz/window-bar.ts";

const require = createRequire(import.meta.url);
const { getPathMatch } = require("next/dist/shared/lib/router/utils/path-match.js") as {
  getPathMatch: (
    source: string,
    options: { strict: boolean; removeUnnamedParams: boolean },
  ) => (pathname: string) => Record<string, string> | false;
};
const { prepareDestination } = require("next/dist/shared/lib/router/utils/prepare-destination.js") as {
  prepareDestination: (args: {
    appendParamsToQuery: boolean;
    destination: string;
    params: Record<string, string>;
    query: Record<string, string | string[]>;
  }) => { parsedDestination: { pathname: string; query: Record<string, string | string[]> } };
};
const { getRedirectStatus } = require("next/dist/lib/redirect-status.js") as {
  getRedirectStatus: (route: { permanent?: boolean; statusCode?: number }) => number;
};

/** What Next's router does with a `redirects()` rule (resolve-routes.js, "handle redirect"). */
function nextRedirect(href: string): { status: number; location: string } | null {
  const url = new URL(href, "http://localhost");
  const query: Record<string, string | string[]> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key);
    query[key] = values.length > 1 ? values : values[0]!;
  }
  for (const rule of MML_LEGACY_REDIRECTS) {
    const params = getPathMatch(rule.source, { strict: true, removeUnnamedParams: true })(url.pathname);
    if (!params) continue;
    const { parsedDestination } = prepareDestination({
      appendParamsToQuery: false,
      destination: rule.destination,
      params,
      query,
    });
    const search = stringify(parsedDestination.query);
    return {
      status: getRedirectStatus(rule),
      location: `${parsedDestination.pathname}${search ? `?${search}` : ""}`,
    };
  }
  return null;
}

const read = (path: string) => readFileSync(path, "utf8");

describe("MML redirects — /plans and /plan/[id] stay reachable", () => {
  it("next.config.ts serves MML_LEGACY_REDIRECTS from redirects()", () => {
    const config = read("next.config.ts");
    assert.match(config, /import \{ MML_LEGACY_REDIRECTS \} from "\.\/lib\/plan\/mml-routes"/);
    assert.match(config, /async redirects\(\) \{\s*return MML_LEGACY_REDIRECTS\.map/);
    assert.ok(MML_LEGACY_REDIRECTS.every((rule) => rule.permanent === true));
  });

  it("redirects /plans to /mml with a permanent 308", () => {
    assert.deepEqual(nextRedirect("/plans"), { status: 308, location: "/mml" });
  });

  it("redirects /plans?tab=templates keeping the query string", () => {
    assert.deepEqual(nextRedirect("/plans?tab=templates"), {
      status: 308,
      location: "/mml?tab=templates",
    });
  });

  it("redirects /plan/:id to /mml/:id", () => {
    assert.deepEqual(nextRedirect("/plan/299dd4e5-0000-0000-0000-000000000001"), {
      status: 308,
      location: "/mml/299dd4e5-0000-0000-0000-000000000001",
    });
  });

  it("redirects /plan/:id?drawer=tt&tab=tt-video keeping the drawer deep link", () => {
    assert.deepEqual(nextRedirect("/plan/p1?drawer=tt&tab=tt-video"), {
      status: 308,
      location: "/mml/p1?drawer=tt&tab=tt-video",
    });
    for (const drawer of ["f", "tt", "g"]) {
      assert.equal(nextRedirect(`/plan/p1?drawer=${drawer}`)?.location, `/mml/p1?drawer=${drawer}`);
    }
  });

  it("redirects /plan/new?event=… to /mml/new?event=…", () => {
    assert.deepEqual(nextRedirect("/plan/new?event=e1"), {
      status: 308,
      location: "/mml/new?event=e1",
    });
  });

  it("does not catch /mml, the share link, the API or a deeper path", () => {
    for (const path of ["/mml", "/mml/p1", "/share/plan/tok", "/api/plan/launch", "/plan/p1/extra", "/plansx"]) {
      assert.equal(nextRedirect(path), null, path);
    }
  });
});

describe("MML routes and links", () => {
  it("builds /mml hrefs", () => {
    assert.equal(MML_LIST_PATH, "/mml");
    assert.equal(mmlPlanHref("p1"), "/mml/p1");
    assert.equal(MML_NEW_HREF, "/mml/new");
    assert.equal(planContinuationHref("p1"), "/mml/p1#plan-step-2");
  });

  it("no internal link still points at /plans or /plan/", () => {
    const files = [
      "components/plan/plan-link-banner.tsx",
      "components/plan/plan-workspace.tsx",
      "components/plan/plan-delete-action.tsx",
      "components/plan/meta-drawer.tsx",
      "components/plan/meta-drawer-details.tsx",
      "components/plan/tiktok-drawer-details.tsx",
      "components/plan/google-drawer-details.tsx",
      "components/library/plan-library.tsx",
      "components/wizard/wizard-shell.tsx",
      "components/tiktok-wizard/wizard-shell.tsx",
      "components/google-search-wizard/wizard-shell.tsx",
      "components/dashboard/dashboard-nav.tsx",
      "lib/plan/schedule.ts",
    ];
    for (const file of files) {
      assert.doesNotMatch(read(file), /["'`]\/plans?(["'`/?#]|\$\{)/, file);
    }
  });
});

describe("MML nav — first item under Platforms", () => {
  it("matches /mml, /mml/*, and the legacy /plans and /plan/*", () => {
    for (const path of ["/mml", "/mml/p1", "/mml/new", "/plans", "/plan/p1"]) {
      assert.equal(mmlNavMatch(path), true, path);
    }
    for (const path of ["/", "/mmlx", "/plansx", "/plan", "/share/plan/tok", "/campaign/c1", "/tiktok"]) {
      assert.equal(mmlNavMatch(path), false, path);
    }
  });

  it("removes Plans from the top section and puts MML above Meta / TikTok / Google Ads", () => {
    const nav = read("components/dashboard/dashboard-nav.tsx");
    assert.doesNotMatch(nav, /label: "Plans"/);
    const platforms = nav.indexOf('heading: "Platforms"');
    const mml = nav.indexOf('label: "MML"');
    const meta = nav.indexOf('label: "Meta"');
    const tiktok = nav.indexOf('label: "TikTok"');
    const google = nav.indexOf('label: "Google Ads"');
    assert.ok(platforms > 0 && platforms < mml, "MML sits under Platforms");
    assert.ok(mml < meta && meta < tiktok && tiktok < google, "MML is first, then Meta, TikTok, Google Ads");
    assert.equal(nav.slice(platforms, mml).match(/label:/g), null, "nothing above MML in Platforms");
    assert.match(nav.slice(mml - 120, mml + 120), /href: MML_LIST_PATH/);
    assert.match(nav.slice(mml, mml + 120), /match: mmlNavMatch/);
  });
});

describe("MML canvas — section order on /mml/[id]", () => {
  const expected = [
    ["event", "Event & promoter"],
    ["creatives", "Creatives"],
    ["copy", "Copy"],
    ["budget", "Budget & schedule"],
    ["locations", "Locations & placements"],
    ["channels", "Channels"],
    ["launch", "Launch"],
  ];

  it("numbers seven sections ① to ⑦", () => {
    assert.deepEqual(
      MML_SECTIONS.map((section) => [section.id, section.title]),
      expected,
    );
    assert.deepEqual(
      MML_SECTIONS.map((section) => mmlSectionMarker(section.n)),
      ["①", "②", "③", "④", "⑤", "⑥", "⑦"],
    );
  });

  it("the page renders the workspace, and the workspace renders the sections in that order", () => {
    assert.match(read("app/(dashboard)/mml/[id]/page.tsx"), /<PlanWorkspace/);
    const src = read("components/plan/plan-workspace.tsx");
    const rendered = [...src.matchAll(/<MmlSection section=\{MML_SECTION\.(\w+)\}/g)].map((m) => m[1]);
    assert.deepEqual(rendered, expected.map(([id]) => id));
  });

  it("moves each zone into its section without rewriting it", () => {
    const src = read("components/plan/plan-workspace.tsx");
    const starts = expected.map(([id]) => src.indexOf(`<MmlSection section={MML_SECTION.${id}}`));
    const body = (id: string) => {
      const index = expected.findIndex(([key]) => key === id);
      return src.slice(starts[index], starts[index + 1] ?? src.indexOf("{share.drawerEdit && drawer?.adapter"));
    };
    const zones: Record<string, RegExp[]> = {
      event: [/<CanvasHeader/, /<MmlPromoterIdentity/, /<CanvasWindow/, /<Combobox/],
      creatives: [/<CanvasAssets/],
      budget: [/<CanvasBudget/, /<CanvasTarget/, /<CanvasAdjust/, /<CanvasLearn/],
      channels: [/<CanvasChannels/, /id=\{PLAN_STEP2_HASH\}/],
      launch: [/<CanvasLaunch/],
    };
    for (const [id, patterns] of Object.entries(zones)) {
      for (const pattern of patterns) assert.match(body(id), pattern, `${pattern} in ${id}`);
    }
    assert.match(body("budget"), /<aside[^>]*>\s*\{maybePlanNoShowLock\(\s*noShow,\s*<CanvasTarget/);
  });

  it("②, ③ and ⑤ are placeholder cards naming their PR, operator-only, with no controls", () => {
    assert.match(MML_SECTION.creatives.placeholder ?? "", /^Coming in M2/);
    assert.match(MML_SECTION.copy.placeholder ?? "", /^Coming in M3/);
    assert.match(MML_SECTION.locations.placeholder ?? "", /^Coming in M4/);
    for (const id of ["event", "budget", "channels", "launch"] as const) {
      assert.equal(MML_SECTION[id].placeholder, undefined, id);
    }
    const src = read("components/plan/plan-workspace.tsx");
    for (const id of ["creatives", "copy", "locations"]) {
      assert.match(src, new RegExp(`<MmlPlaceholderCard>\\{MML_SECTION\\.${id}\\.placeholder\\}</MmlPlaceholderCard>`));
    }
    assert.equal(src.match(/readOnly \? null : \(\s*<(MmlPlaceholderCard|MmlSection section=\{MML_SECTION\.(copy|locations)\})/g)?.length, 3);
    const card = read("components/plan/mml-section.tsx");
    const placeholder = card.slice(card.indexOf("export function MmlPlaceholderCard"));
    assert.doesNotMatch(placeholder, /<(button|input|select|textarea|Button)\b/);
  });

  it("⑥ is one card per channel with status, blocker count and Adjust", () => {
    const channels = read("components/plan/canvas-channels.tsx");
    assert.match(channels, /<article\s+key=\{row\.adapter\}\s+data-mml-channel=\{row\.adapter\}/);
    assert.match(channels, /data-blocker-count=\{blockerCount\}/);
    assert.match(channels, /\{stateWord\}/);
    assert.match(channels, />\s*Adjust\s*</);
    assert.match(channels, /ref=\{openRefs\?\.\[row\.adapter\]\}/);
    assert.match(channels, /onClick=\{\(\) => onOpen\(row\)\}/);
  });

  it("⑦ keeps the one paused launch, now under a grouped blocker list", () => {
    const launch = read("components/plan/canvas-launch.tsx");
    assert.match(launch, /<PlanBlockerGroups groups=\{blockerGroups\}/);
    assert.doesNotMatch(launch, /text-right/);
    assert.doesNotMatch(launch, /justify-end/);
    const groups = read("components/plan/blocker-items.tsx");
    assert.match(groups, /<details key=\{group\.adapter\}/);
    assert.match(read("lib/plan/canvas.ts"), /launchAll: "Launch all \(paused\)"/);
    assert.match(read("app/api/plan/launch/route.ts"), /if \(!gate\.enabled\)/);
    assert.match(read("lib/plan/gate.ts"), /env\.ENABLE_PLAN_FANOUT === "1"/);
    assert.match(launch, /fanoutOff \?/);
  });
});

describe("MML ① promoter identity", () => {
  const resolved = resolveChannelDefaults({
    clientId: "c1",
    clientName: "Innervisions",
    metaAdAccountId: "act_1",
    metaPixelId: null,
    defaultPageId: "page-1",
    defaultInstagramActorId: "ig-1",
    tiktokAccountId: null,
    tiktokAdvertiserId: "adv-1",
    tiktokIdentityId: null,
    tiktokIdentityType: null,
    tiktokIdentityBcId: null,
    googleAdsAccountId: null,
    googleAdsCustomerId: null,
  });

  it("reads Page, Instagram and TikTok identity from the channel defaults", () => {
    const rows = mmlPromoterIdentityRows(resolved, {
      ...EMPTY_IDENTITY_NAMES,
      facebookPage: { "page-1": "Innervisions" },
      instagramActor: { "ig-1": "innervisions" },
    });
    assert.deepEqual(
      rows.map((row) => [row.label, row.value, row.adapter, row.provenance]),
      [
        ["Facebook Page", "Innervisions", "meta", "client-default"],
        ["Instagram", "@innervisions", "meta", "client-default"],
        ["TikTok identity", null, "tiktok", "unset"],
      ],
    );
  });

  it("links to the client's channel-defaults card", () => {
    assert.equal(channelDefaultsHref("c1"), "/clients/c1#channel-defaults");
    assert.equal(channelDefaultsHref(null), null);
    assert.match(read("components/dashboard/clients/channel-defaults-card.tsx"), /id="channel-defaults"/);
  });
});

describe("MML layout bugs from the 2026-10-08 screenshots", () => {
  it("does not print the same scope twice in a Google blocker", () => {
    assert.equal(
      scopedGoogleIssueMessage("Plan campaign", "Plan campaign: No daily budget resolved."),
      "Plan campaign: No daily budget resolved.",
    );
    assert.equal(
      scopedGoogleIssueMessage("Plan campaign", 'Campaign "Plan campaign" has no keywords.'),
      'Campaign "Plan campaign" has no keywords.',
    );
    assert.equal(scopedGoogleIssueMessage("Brand", "no RSA copy."), "Brand: no RSA copy.");
    assert.equal(scopedGoogleIssueMessage(undefined, "Add at least one campaign."), "Add at least one campaign.");
  });

  it("groups launch blockers by channel and folds repeats", () => {
    const issue = (adapter: PlanPreflightIssue["adapter"], id: string, message: string): PlanPreflightIssue => ({
      adapter,
      id,
      field: "x",
      message,
      blocking: true,
    });
    const groups = launchBlockerGroups([
      issue("google", "g1", "Plan campaign: No daily budget resolved."),
      issue("meta", "m1", "Creative needs a headline"),
      issue("meta", "m2", "Creative needs a headline"),
      issue("meta", "m3", "Pick a Facebook Page"),
      { ...issue("tiktok", "t1", "advisory only"), blocking: false },
    ]);
    assert.deepEqual(
      groups.map((group) => [group.adapter, group.count, group.rows.map((row) => row.full)]),
      [
        ["meta", 3, ["Creative needs a headline (×2)", "Pick a Facebook Page"]],
        ["google", 1, ["Plan campaign: No daily budget resolved."]],
      ],
    );
    assert.equal(groups[0]?.rows[0]?.anchor?.drawer, "meta");
  });

  it("measures moment labels by their text, so two passed sale dates no longer overlap", () => {
    const width = 900;
    const presale = { id: "presale", noun: "presale passed Fri 18 Sep", x: 40 };
    const general = { id: "gen-sale", noun: "gen sale passed Fri 25 Sep", x: 160 };
    const boxes = [presale, general].map((mark) => ({
      id: mark.id,
      ...momentLabelBox({ x: mark.x, noun: mark.noun, align: momentMarkAlign(mark.x / width) }),
    }));
    assert.ok(boxes.every((box) => box.width > 150), "labels are wider than the old 56px box");
    assert.deepEqual([...collapseOverlappingMomentLabels(boxes)], ["gen-sale"]);
    assert.deepEqual(momentLabelBox({ x: 0, noun: "show", align: "start" }), { x: 28, width: 56 });
    assert.deepEqual(momentLabelBox({ x: 900, noun: "show", align: "end" }), { x: 872, width: 56 });
    const source = read("components/viz/window-bar.tsx");
    assert.match(source, /\.\.\.momentLabelBox\(\{/);
  });

  it("a same-day join wins the collision, so 'announcement passed' no longer prints over 'presale · gen sale'", () => {
    const width = 1290;
    const announcement = {
      id: "announcement",
      ...momentLabelBox({ x: 0.1156 * width, noun: "announcement passed Tue 15 Sep", align: "center" }),
    };
    const join = {
      id: "gen-sale",
      ...momentLabelBox({
        x: 0.1632 * width,
        noun: "presale passed Fri 18 Sep · gen sale passed Fri 18 Sep",
        align: "center",
      }),
      keep: true,
    };
    assert.deepEqual([...collapseOverlappingMomentLabels([announcement, join])], ["announcement"]);
    assert.deepEqual([...collapseOverlappingMomentLabels([announcement, { ...join, keep: false }])], ["gen-sale"]);
    const source = read("components/viz/window-bar.tsx");
    assert.match(source, /keep: rail\.joinedLabel\.has\(mark\.id\)/);
    assert.doesNotMatch(source, /hiddenNouns\.delete/);
    assert.match(source, /\{hideNoun && tip \? \(\s*<span className="absolute left-full[^"]*" data-moment-tip>/);
  });
});
