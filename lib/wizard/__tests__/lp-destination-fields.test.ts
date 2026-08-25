import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { WIZARD_CREATE_AFFORDANCE_BANS } from "../lp-destination.ts";
import { WIZARD_DESTINATION_URL_FIELDS } from "../lp-destination-fields.ts";

/**
 * Guard: every destination-URL input in the Meta + TikTok wizards must
 * be listed in WIZARD_DESTINATION_URL_FIELDS and wired to
 * EventPageDestination (picker + paste). That component no longer
 * exposes page creation. A new input that isn't listed fails this test
 * so half-attributed funnels cannot ship unnoticed.
 */

const REPO = process.cwd();

function source(rel: string): string {
  return readFileSync(join(REPO, rel), "utf8");
}

const DESTINATION_LABEL = /label="((?:Destination URL|Landing page URL)[^"]*)"/g;

describe("wizard destination-URL field coverage", () => {
  it("lists exactly the four launch-flow fields (bulk-attach / umbrella out of scope)", () => {
    assert.equal(WIZARD_DESTINATION_URL_FIELDS.length, 4);
    assert.deepEqual(
      WIZARD_DESTINATION_URL_FIELDS.map((f) => f.id),
      [
        "meta-creative-destination-url",
        "meta-existing-ig-destination-url",
        "meta-existing-fb-destination-url",
        "tiktok-creative-landing-page-url",
      ],
    );
  });

  it("every listed field is wired in its file (fieldId + EventPageDestination)", () => {
    for (const field of WIZARD_DESTINATION_URL_FIELDS) {
      const src = source(field.file);
      assert.match(
        src,
        /EventPageDestination/,
        `${field.file} must mount EventPageDestination`,
      );
      assert.ok(
        src.includes(`fieldId="${field.id}"`),
        `${field.file} must wire fieldId="${field.id}"`,
      );
      assert.ok(
        src.includes(`label="${field.label}"`),
        `${field.file} must still expose label="${field.label}"`,
      );
    }
  });

  it("every Destination URL / Landing page URL label in those files is a listed field", () => {
    const files = [...new Set(WIZARD_DESTINATION_URL_FIELDS.map((f) => f.file))];
    const labels: string[] = [];
    for (const file of files) {
      const src = source(file);
      for (const match of src.matchAll(DESTINATION_LABEL)) {
        labels.push(`${file} :: ${match[1]}`);
      }
    }
    assert.equal(
      labels.length,
      WIZARD_DESTINATION_URL_FIELDS.length,
      `ungarded destination-URL label(s):\n${labels.join("\n")}`,
    );
  });

  it("EventPageDestination and the four fields expose no create affordance", () => {
    const picker = "components/wizard/event-page-destination.tsx";
    const files = [picker, ...new Set(WIZARD_DESTINATION_URL_FIELDS.map((f) => f.file))];
    for (const file of files) {
      const src = source(file);
      for (const ban of WIZARD_CREATE_AFFORDANCE_BANS) {
        assert.ok(
          !src.includes(ban),
          `${file} must not contain create affordance ${JSON.stringify(ban)}`,
        );
      }
    }
    const pickerSrc = source(picker);
    assert.ok(
      !pickerSrc.includes('method: "POST"') && !pickerSrc.includes("method: 'POST'"),
      `${picker} must not POST to create a landing page`,
    );
  });

  it("no wizard route can create or publish a page_events row", () => {
    const writeBan =
      /\.from\(\s*["']page_events["']\s*\)[\s\S]{0,200}\.(insert|update|upsert)/;
    const publishBan =
      /status:\s*["']live["'][\s\S]{0,80}page_events|page_events[\s\S]{0,80}status:\s*["']live["']/;
    const files = [
      ...walkTs("app/api/wizard"),
      "lib/db/event-landing-page.ts",
      "components/wizard/event-page-destination.tsx",
    ];
    for (const file of files) {
      const src = source(file);
      assert.doesNotMatch(
        src,
        writeBan,
        `${file} must not insert/update/upsert page_events`,
      );
      assert.doesNotMatch(
        src,
        publishBan,
        `${file} must not publish a page_events row`,
      );
      assert.doesNotMatch(
        src,
        /ensureRenderablePageForOwnedEvent/,
        `${file} must not call the deleted wizard ensure/write path`,
      );
    }
    const route = source("app/api/wizard/event-landing-page/route.ts");
    assert.doesNotMatch(
      route,
      /export async function POST/,
      "wizard event-landing-page route must be GET-only",
    );
  });
});

function walkTs(relDir: string): string[] {
  const abs = join(REPO, relDir);
  const out: string[] = [];
  for (const name of readdirSync(abs)) {
    const rel = `${relDir}/${name}`;
    const st = statSync(join(REPO, rel));
    if (st.isDirectory()) out.push(...walkTs(rel));
    else if (name.endsWith(".ts") || name.endsWith(".tsx")) out.push(rel);
  }
  return out;
}
