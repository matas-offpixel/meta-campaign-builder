import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderD2CEmailHtml, type RenderD2CEmailHtmlInput } from "../email-html.ts";

/**
 * lib/d2c/render/__tests__/email-html.test.ts
 *
 * Bug D fix (2026-07-08): renderD2CEmailHtml is the single source of truth
 * for both the dashboard preview AND the real/test Mailchimp campaign HTML —
 * these tests assert its output shape against a handful of input
 * combinations (with/without artwork, with/without button), per the PR's
 * "test renderD2CEmailHtml with snapshot tests" ask.
 */

const baseInput = (): RenderD2CEmailHtmlInput => ({
  subject: "{{event_name}} tickets are live",
  bodyMarkdown: "Hey! **{{event_name}}** is on sale now.\n\nDon't miss out.",
  variables: { event_name: "Throwback Algarve" },
  artworkUrl: null,
  eventName: "Throwback Algarve",
  buttonLabel: null,
  buttonUrl: null,
});

describe("renderD2CEmailHtml", () => {
  it("substitutes variables into subject and body", () => {
    const html = renderD2CEmailHtml(baseInput());
    assert.match(html, /Throwback Algarve tickets are live/);
    assert.match(html, /<strong>Throwback Algarve<\/strong> is on sale now\./);
    assert.doesNotMatch(html, /\{\{event_name\}\}/);
  });

  it("renders a themed placeholder block when artworkUrl is absent", () => {
    const html = renderD2CEmailHtml(baseInput());
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /background-color:#c81c68/);
    assert.match(html, />Throwback Algarve</);
  });

  it("renders a hero <img> when artworkUrl is present, no fallback placeholder", () => {
    const html = renderD2CEmailHtml({
      ...baseInput(),
      artworkUrl: "https://cdn.example.com/algarve.jpg",
    });
    assert.match(html, /<img src="https:\/\/cdn\.example\.com\/algarve\.jpg"/);
    assert.match(html, /max-width:640px/);
    assert.doesNotMatch(html, /background-color:#c81c68;padding:48px/);
  });

  it("omits the CTA button entirely when buttonLabel or buttonUrl is missing", () => {
    const noLabel = renderD2CEmailHtml({
      ...baseInput(),
      buttonUrl: "https://tickets.example.com",
    });
    assert.doesNotMatch(noLabel, /<a href=/);

    const noUrl = renderD2CEmailHtml({ ...baseInput(), buttonLabel: "Buy now" });
    assert.doesNotMatch(noUrl, /<a href=/);
  });

  it("renders a >=44px tap-target CTA button with substituted url + theme colour", () => {
    const html = renderD2CEmailHtml({
      ...baseInput(),
      buttonLabel: "Sign up here",
      buttonUrl: "https://tickets.example.com/{{event_name}}",
      themeColor: "#00ff00",
    });
    assert.match(
      html,
      /<a href="https:\/\/tickets\.example\.com\/Throwback Algarve"[^>]*>Sign up here<\/a>/,
    );
    assert.match(html, /background-color:#00ff00/);
    // padding 15px top+bottom + 16px line-height = 46px >= 44px tap target.
    assert.match(html, /padding:15px 28px;line-height:16px/);
  });

  it("defaults to Throwback pink when themeColor is omitted", () => {
    const html = renderD2CEmailHtml(baseInput());
    assert.match(html, /#c81c68/);
  });

  it("auto-bolds a single-line intro paragraph (Throwback London heuristic)", () => {
    const html = renderD2CEmailHtml({
      ...baseInput(),
      bodyMarkdown: "Thanks for signing up!\n\nMore details soon.",
      variables: {},
    });
    assert.match(html, /<p><strong>Thanks for signing up!<\/strong><\/p>/);
  });

  it("does not double-bold an intro paragraph that already starts bold", () => {
    const html = renderD2CEmailHtml({
      ...baseInput(),
      bodyMarkdown: "**Welcome aboard!**\n\nMore details soon.",
      variables: {},
    });
    assert.match(html, /<p><strong>Welcome aboard!<\/strong><\/p>/);
    assert.doesNotMatch(html, /<strong><strong>/);
  });

  it("escapes HTML-unsafe characters in eventName / subject / artworkUrl / button fields", () => {
    const html = renderD2CEmailHtml({
      ...baseInput(),
      subject: "Tickets <on sale> now",
      eventName: 'Ev&ent "Name"',
      artworkUrl: null,
      buttonLabel: "<Buy> & Save",
      buttonUrl: "https://example.com?a=1&b=2",
    });
    assert.match(html, /Tickets &lt;on sale&gt; now/);
    assert.match(html, /Ev&amp;ent &quot;Name&quot;/);
    assert.match(html, /&lt;Buy&gt; &amp; Save/);
    assert.match(html, /https:\/\/example\.com\?a=1&amp;b=2/);
    assert.doesNotMatch(html, /<on sale>/);
  });

  it("renders the fixed footer note on every email", () => {
    const html = renderD2CEmailHtml(baseInput());
    assert.match(html, /Síguenos para saber más…/);
  });

  it("omits the subject eyebrow line entirely when subject is null", () => {
    const html = renderD2CEmailHtml({ ...baseInput(), subject: null });
    assert.doesNotMatch(html, /font-weight:700;">.*tickets are live/);
  });
});
