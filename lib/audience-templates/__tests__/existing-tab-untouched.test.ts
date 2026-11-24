/**
 * RC5: "The Audiences tab and its flow don't change." R6 is its own tab.
 *
 *  - The drawer still renders AudiencesStep with exactly the props it had on
 *    main (016a262), now wrapped by AudiencesTabSwitch, its only change.
 *  - The switch passes the Audiences tab through as children and keeps it
 *    mounted in one place; with no templates there is no tab row.
 *  - No audience-template file imports the Audiences step or the draft
 *    updaters, or writes the draft's audiences.
 *  - No audience-template file reaches a Meta write: the tab never creates
 *    an audience, and only reads whether audience writes are on.
 *  - No file under components/steps/audiences imports the templates.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = new URL("../../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** The block as it is on main at 016a262. */
const MAIN_AUDIENCES_STEP = `<AudiencesStep
              surface="drawer"
              audiences={draft.audiences}
              onChange={updateAudiences}
              settings={settings}
              onSettingsChange={updateSettings}
              onPageInstagramOverride={handlePageInstagramOverride}
              adAccountId={settings.metaAdAccountId || settings.adAccountId}
              clientId={settings.clientId}
              eventId={settings.eventId}
              campaignName={settings.campaignName}
              imported={draft.importMeta != null}
              adSetSuggestions={draft.adSetSuggestions}
            />`;

function files(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(join(ROOT, p)).isDirectory()) return f === "__tests__" ? [] : files(p);
    return /\.tsx?$/.test(f) ? [p] : [];
  });
}

const TEMPLATE_FILES = [
  ...files("lib/audience-templates"),
  ...files("components/audience-templates"),
  "lib/actions/audience-templates.ts",
  "scripts/seed-audience-templates.mts",
];

describe("the existing Audiences tab is untouched", () => {
  const drawer = read("components/plan/meta-drawer.tsx");

  it("the drawer renders AudiencesStep with main's props, inside the switch", () => {
    assert.equal(drawer.split(MAIN_AUDIENCES_STEP).length, 2, "the AudiencesStep block is main's, once");
    const at = drawer.indexOf(MAIN_AUDIENCES_STEP);
    const open = drawer.lastIndexOf("<AudiencesTabSwitch", at);
    const close = drawer.indexOf("</AudiencesTabSwitch>", at);
    assert.ok(open > 0 && close > at, "wrapped by AudiencesTabSwitch");
    assert.equal(drawer.match(/<AudiencesStep\b/g)?.length, 1);
    assert.match(drawer, /\{tab === "f-audiences" \? \(\s*<AudiencesTabSwitch/);
  });

  it("the drawer's tab list is unchanged", () => {
    const tabs = read("lib/plan/drawer.ts");
    assert.match(tabs, /\{ id: "f-audiences", glyph: "👥", label: "audiences" \},\s*\{ id: "f-creatives", glyph: "▤", label: "creatives" \},\s*\{ id: "f-adsets", glyph: "⊞", label: "ad sets" \},\s*\] as const;/);
  });

  it("the switch passes children through in one place; no templates, no row", () => {
    const sw = read("components/audience-templates/audiences-tab-switch.tsx");
    assert.equal(sw.match(/\{children\}/g)?.length, 1, "children rendered once, never re-parented");
    assert.match(sw, /<div className=\{onTemplates \? "hidden" : "contents"\} data-audiences-tab>\s*\{children\}\s*<\/div>/);
    assert.match(sw, /\{shown \? <AudiencesTabRow/);
    assert.match(sw, /return Boolean\(data && data\.templates\.length > 0\)/);
  });

  it("no template file imports the Audiences step or writes the draft's audiences", () => {
    for (const f of TEMPLATE_FILES) {
      const src = read(f);
      assert.doesNotMatch(src, /components\/steps\/audiences/, f);
      assert.doesNotMatch(src, /lib\/wizard\//, f);
      assert.doesNotMatch(src, /updateAudiences|updateDraft|onChange=\{.*audiences/, f);
      assert.doesNotMatch(src, /from\("campaign_drafts"\)\.(update|upsert|insert|delete)/, f);
    }
  });

  it("no template file reaches a Meta write", () => {
    // The seed reads Electric's lists with GET /act_{id}/customaudiences
    // (graph-lists.ts, guarded in the script); nothing else names the edge.
    const reads = new Set(["lib/audience-templates/graph-lists.ts", "scripts/seed-audience-templates.mts"]);
    for (const f of TEMPLATE_FILES) {
      const src = read(f);
      assert.doesNotMatch(src, /assertMetaAudienceWritesEnabled|createCustomAudience|graphPost|metaPost/i, f);
      if (!reads.has(f)) assert.doesNotMatch(src, /\/customaudiences/i, f);
      assert.doesNotMatch(src, /method: "(POST|DELETE|PUT|PATCH)"/, f);
      const metaImports = [...src.matchAll(/from "(?:@\/|\.\.\/)lib\/meta\/([^"]+)"/g)].map((m) => m[1]);
      for (const m of metaImports) assert.ok(m === "ad-account" || m === "ad-account.ts" || m === "audience-write", `${f} imports lib/meta/${m}`);
    }
    const action = read("lib/actions/audience-templates.ts");
    assert.match(action, /import \{ metaAudienceWritesEnabled \} from "@\/lib\/meta\/audience-write";/);
  });

  it("the seed's Graph guard refuses anything but GET on the customaudiences edge", () => {
    const script = read("scripts/seed-audience-templates.mts");
    assert.match(script, /if \(!isAllowedGraphRead\(url, init\?\.method\)\) \{\s*metaRefused \+= 1;\s*throw/);
    assert.doesNotMatch(read("components/audience-templates/audience-templates-panel.tsx") + read("lib/actions/audience-templates.ts"), /graph\.facebook|fetchAccountAudiences/);
  });

  it("the Audiences step's files don't know about templates", () => {
    for (const f of files("components/steps/audiences")) {
      assert.doesNotMatch(read(f), /audience-templates/, f);
    }
  });
});
