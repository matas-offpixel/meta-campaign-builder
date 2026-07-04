import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  buildLeadCommand,
  buildPixelInitCommands,
  getOrCreateEventBase,
  isValidCapiEventId,
  leadEventId,
  pageViewEventId,
} from "../pixel-events.ts";

/**
 * Client-side pixel command layer. The React components execute what
 * these builders return, so asserting on the commands IS asserting on
 * runtime pixel behaviour — without a DOM.
 */

function makeStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    store,
  };
}

describe("event id lifecycle", () => {
  it("creates a base uuid once and persists it in sessionStorage", () => {
    const storage = makeStorage();
    const first = getOrCreateEventBase(storage);
    const second = getOrCreateEventBase(storage);
    assert.equal(first, second, "base must survive re-reads (submit reload)");
    assert.equal(storage.store.size, 1);
  });

  it("PageView and Lead ids derive from the same base and validate", () => {
    const storage = makeStorage();
    const base = getOrCreateEventBase(storage);
    const pv = pageViewEventId(base);
    const lead = leadEventId(base);
    assert.ok(pv.endsWith("-pv"));
    assert.ok(lead.endsWith("-lead"));
    assert.notEqual(pv, lead);
    assert.ok(isValidCapiEventId(pv), `pv id ${pv} must pass the shared charset`);
    assert.ok(isValidCapiEventId(lead));
  });

  it("throwing storage (privacy mode) still yields a usable id", () => {
    const storage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    const base = getOrCreateEventBase(storage);
    assert.ok(isValidCapiEventId(leadEventId(base)));
  });
});

describe("pixel commands — trackSingle invariant", () => {
  const PIXEL = "111111111111111";

  it("init commands: init + PageView via trackSingle, scoped to the one pixel", () => {
    const commands = buildPixelInitCommands(PIXEL, "base-1234-pv");
    assert.deepEqual(commands, [
      ["init", PIXEL],
      ["trackSingle", PIXEL, "PageView", {}, { eventID: "base-1234-pv" }],
    ]);
  });

  it("lead command uses trackSingle with the shared event id", () => {
    assert.deepEqual(buildLeadCommand(PIXEL, "base-1234-lead"), [
      "trackSingle",
      PIXEL,
      "Lead",
      {},
      { eventID: "base-1234-lead" },
    ]);
  });

  it("no builder ever emits a plain 'track' (fires to EVERY initialised pixel)", () => {
    const all = [
      ...buildPixelInitCommands(PIXEL, "x-pv"),
      buildLeadCommand(PIXEL, "x-lead"),
    ];
    for (const command of all) {
      assert.notEqual(
        command[0],
        "track",
        "plain fbq('track') would leak events to other tenants' pixels after soft navigations",
      );
    }
  });

  it("SOURCE GUARD: pixel modules never call plain fbq('track', …) and never touch clients.meta_pixel_id or env pixels", () => {
    const root = path.join(import.meta.dirname, "..", "..", "..");
    const sources = [
      path.join(root, "lib", "landing-pages", "pixel-events.ts"),
      path.join(root, "components", "landing-pages", "meta-pixel.tsx"),
      path.join(root, "components", "landing-pages", "signup-form-block.tsx"),
    ].map((p) => ({
      p,
      // Comments legitimately DISCUSS plain 'track'; the code must not
      // contain it. Strip block + full-line comments before matching.
      text: readFileSync(p, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, ""),
    }));

    for (const { p, text } of sources) {
      assert.ok(
        !/["'`]track["'`]/.test(text),
        `${p} contains a plain 'track' literal — trackSingle only`,
      );
      assert.ok(
        !text.includes("clients.meta_pixel_id"),
        `${p} references Off/Pixel's operational pixel column`,
      );
      assert.ok(
        !/process\.env\.[A-Z_]*PIXEL/.test(text),
        `${p} sources a pixel id from an env var — tenant context only`,
      );
    }
  });
});
