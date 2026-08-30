/**
 * Text-colour derivation for Approach B.
 *
 * The bug this locks down: colour was read from the `<p>`, which is correct on
 * j26-HALLOWEEN (p carries #FFFFFF) and WRONG on K26-HALLOWEEN V2 (p carries
 * #202020, white lives in a nested span). Dark text shipped on a red
 * background with no error.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertColorMatches,
  BrandCloneError,
  colorIn,
  deriveTextStyles,
  renderBodyBlock,
  renderParagraph,
} from "../brand-clone.ts";

// K26-HALLOWEEN V2 shape: dark <p>, white inner <span>.
const K26 = `<p dir="ltr" style="margin: 10px 0;color: #202020;font-family: Helvetica;font-size: 16px;">
  <span style="color:#FFFFFF">La venta general ya está activa.</span></p>`;
// j26-HALLOWEEN shape: colour on the <p> itself, no inner wrapper.
const J26 = `<p dir="ltr" style="color: #FFFFFF;font-size: 14px;margin: 10px 0;">Presale is now live.</p>`;

test("colour is taken from the innermost wrapper, not the paragraph", () => {
  const st = deriveTextStyles(K26);
  assert.equal(st.innerTag, "span");
  assert.equal(st.renderedColor, "#FFFFFF");
  // the paragraph's own dark colour is captured but must NOT be what renders
  assert.match(st.paragraph, /#202020/);
  assert.notEqual(st.renderedColor, "#202020");
});

test("a template with colour only on the paragraph still works", () => {
  const st = deriveTextStyles(J26);
  assert.equal(st.innerTag, null);
  assert.equal(st.renderedColor, "#FFFFFF");
});

test("substituted output reproduces the source nesting and colour (K26)", () => {
  const st = deriveTextStyles(K26);
  const html = renderBodyBlock("Titular", ["Uno", "Dos"], st);
  assert.match(html, /<p dir="ltr" style="[^"]*#202020[^"]*"><span style="color:#FFFFFF"><strong>Titular<\/strong><\/span><\/p>/);
  assert.equal((html.match(/<span style="color:#FFFFFF">/g) ?? []).length, 3);
  assert.deepEqual(assertColorMatches(html, st), []);
});

test("substituted output for a paragraph-coloured template has no spurious span", () => {
  const st = deriveTextStyles(J26);
  const html = renderBodyBlock("Head", ["One"], st);
  assert.ok(!html.includes("<span"));
  assert.deepEqual(assertColorMatches(html, st), []);
});

test("the old p-only logic would have produced the WRONG colour on K26", () => {
  // Regression guard: copying only the <p> style renders #202020.
  const pOnly = `<p dir="ltr" style="margin: 10px 0;color: #202020;">Texto</p>`;
  const st = deriveTextStyles(K26);
  const fails = assertColorMatches(pOnly, st);
  assert.equal(fails.length, 1);
  assert.match(fails[0], /#202020 != source #FFFFFF/i);
});

test("no colour anywhere throws rather than blanket-applying white", () => {
  assert.throws(
    () => deriveTextStyles(`<p style="margin:10px 0;font-size:16px;">plain</p>`),
    BrandCloneError,
  );
  assert.throws(() => deriveTextStyles("<div>no paragraph at all</div>"), BrandCloneError);
});

test("headline is bold inside the coloured wrapper, not outside it", () => {
  const st = deriveTextStyles(K26);
  const p = renderParagraph("Head", st, { bold: true });
  assert.ok(p.indexOf("<span") < p.indexOf("<strong>"), "strong must be nested inside span");
});

test("interpolated text is escaped", () => {
  const st = deriveTextStyles(K26);
  const p = renderParagraph('a <script>"x"', st);
  assert.ok(!p.includes("<script>"));
  assert.ok(p.includes("&lt;script&gt;"));
});

test("colorIn reads colour without matching background-color", () => {
  assert.equal(colorIn("background-color:#000;color:#FFF"), "#FFF");
  assert.equal(colorIn("background-color:#000000"), null);
});
