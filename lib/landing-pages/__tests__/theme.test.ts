import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildThemeStyle,
  DEFAULT_LANDING_THEME,
  resolveTheme,
} from "../theme.ts";

describe("resolveTheme", () => {
  it("returns complete bright defaults for empty/missing theme (no crashes)", () => {
    for (const input of [null, undefined, {}] as const) {
      const theme = resolveTheme(input, input);
      assert.deepEqual(theme, DEFAULT_LANDING_THEME);
    }
  });

  it("merges with event-overrides > client-theme > defaults precedence", () => {
    const theme = resolveTheme(
      { primary_color: "#111111", accent_color: "#222222" },
      { primary_color: "#333333" },
    );
    assert.equal(theme.primary_color, "#333333"); // override wins
    assert.equal(theme.accent_color, "#222222"); // client wins over default
    assert.equal(theme.bg_color, DEFAULT_LANDING_THEME.bg_color); // default
  });

  it("an INVALID override falls back to the client value, not the default", () => {
    const theme = resolveTheme(
      { primary_color: "#abc123" },
      { primary_color: "red;} body{display:none" },
    );
    assert.equal(theme.primary_color, "#abc123");
  });

  it("sanitises hostile values in every slot", () => {
    const hostile = {
      primary_color: "url(javascript:alert(1))",
      font_family: 'Comic"; } * { display: none } @import "x',
      logo_url: "javascript:alert(1)",
      thank_you_message: "",
    };
    const theme = resolveTheme(hostile, null);
    assert.equal(theme.primary_color, DEFAULT_LANDING_THEME.primary_color);
    assert.equal(theme.font_family, DEFAULT_LANDING_THEME.font_family);
    assert.equal(theme.logo_url, null);
    assert.equal(theme.thank_you_message, DEFAULT_LANDING_THEME.thank_you_message);
  });

  it("accepts legitimate color formats and https logo urls", () => {
    const theme = resolveTheme(
      {
        primary_color: "rgb(255, 80, 40)",
        secondary_color: "hsl(210deg 40% 30%)",
        bg_color: "#ffeedd",
        logo_url: "https://cdn.example.com/logo.png",
        thank_you_message: "See you in Mallorca ☀️",
      },
      null,
    );
    assert.equal(theme.primary_color, "rgb(255, 80, 40)");
    assert.equal(theme.secondary_color, "hsl(210deg 40% 30%)");
    assert.equal(theme.logo_url, "https://cdn.example.com/logo.png");
    assert.equal(theme.thank_you_message, "See you in Mallorca ☀️");
  });
});

describe("buildThemeStyle", () => {
  it("emits every --lp-* var and nothing else", () => {
    const style = buildThemeStyle(DEFAULT_LANDING_THEME);
    assert.deepEqual(Object.keys(style).sort(), [
      "--lp-accent-color",
      "--lp-bg-color",
      "--lp-font-family",
      "--lp-primary-color",
      "--lp-secondary-color",
      "--lp-text-color",
    ]);
    for (const value of Object.values(style)) {
      assert.equal(typeof value, "string");
      assert.ok(value.length > 0);
    }
  });
});
