import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("--warning-foreground token", () => {
  it("is defined in both colour schemes and mapped for Tailwind", () => {
    const css = readFileSync(new URL("../../../app/globals.css", import.meta.url), "utf8");
    const root = css.match(/:root\s*\{([\s\S]*?)\n\}/);
    const dark = css.match(/\.dark\s*\{([\s\S]*?)\n\}/);
    const theme = css.match(/@theme inline\s*\{([\s\S]*?)\n\}/);
    assert.ok(root?.[1].includes("--warning-foreground:"), "missing in :root");
    assert.ok(dark?.[1].includes("--warning-foreground:"), "missing in .dark");
    assert.ok(
      theme?.[1].includes("--color-warning-foreground: var(--warning-foreground)"),
      "missing @theme mapping",
    );
  });
});
