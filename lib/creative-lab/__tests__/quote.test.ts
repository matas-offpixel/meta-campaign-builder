import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { quoteTextEm, quoteWrapEm } from "../../../src/remotion/caption-style/quote-measure.ts";
import { generateCaptions } from "../writer.ts";
import type { CaptionStyle } from "../tags.ts";
import type { ServiceRoleDb } from "../load.ts";
import type { EventFacts } from "../caption-facts.ts";
import {
  acceptQuote,
  heldQuoteSentence,
  isSentenceSlice,
  leaveCaption,
  postsForQuote,
  quoteInsert,
  quoteLines,
  quotePronoun,
  returnToCaption,
  sourceChip,
  validateQuote,
  type CaptionGenerator,
} from "../quote.ts";

const WORDS = "Southampton, this one's going to be special. See you on the 27th 🔥";

const FACTS: EventFacts = {
  eventId: "evt",
  eventName: "Puzzle 4th Birthday",
  eventDate: "2026-12-27",
  venueName: "Circuit",
  venueCity: "Southampton",
  lineup: ["Enzo Siragusa", "Luke Dean"],
  allowedDates: [],
  tiers: [],
};

const generator: CaptionGenerator = { angle: "scarcity", count: 5, each: true, stage: "on_sale" };

describe("quote mode", () => {
  it("stores the words verbatim and keeps the source", () => {
    const stored = quoteInsert({
      words: `  ${WORDS}  `,
      source: "post",
      sourceText: WORDS,
      sourceRef: "https://instagram.com/p/enzo",
      artistId: "artist-enzo",
    });
    assert.equal(stored.ok, true);
    if (!stored.ok) return;
    assert.equal(stored.row.text, WORDS);
    assert.equal(stored.row.generated_by, "verbatim");
    assert.equal(stored.row.mode, "quote");
    assert.equal(stored.row.quote_source, "post");
    assert.equal(stored.row.quote_source_ref, "https://instagram.com/p/enzo");
    assert.equal(stored.row.quote_source_note, null);
    assert.equal(stored.row.quote_weight, 700);
    const typed = quoteInsert({
      words: WORDS,
      source: "typed",
      sourceNote: "said at the Fuse call",
      weight: 400,
      artistId: "artist-luke",
    });
    assert.equal(typed.ok, true);
    if (!typed.ok) return;
    assert.equal(typed.row.text, WORDS);
    assert.equal(typed.row.quote_source, "typed");
    assert.equal(typed.row.quote_source_ref, null);
    assert.equal(typed.row.quote_source_note, "said at the Fuse call");
    assert.equal(typed.row.quote_weight, 400);
    const kit = quoteInsert({
      words: "Line one",
      source: "press_kit",
      sourceText: "Line one\nLine two",
      sourceRef: "enzo-kit.txt",
      artistId: "artist-enzo",
    });
    assert.equal(kit.ok, true);
    if (!kit.ok) return;
    assert.equal(kit.row.quote_source, "press_kit");
    assert.equal(kit.row.quote_source_ref, "enzo-kit.txt");
  });

  it("refuses a rewrite and a five-line passage, and allows a sentence cut", () => {
    const source = "One sentence. Two sentence. Three sentence. Four sentence.";
    const cut = "One sentence. Two sentence. Three sentence.";
    assert.equal(isSentenceSlice(source, cut), true);
    const kept = acceptQuote({ words: cut, source: "post", sourceText: source });
    assert.equal(kept.ok, true);
    if (kept.ok) assert.equal(kept.text, cut);
    const rewritten = acceptQuote({ words: "One sentence. Two changed. Three sentence.", source: "post", sourceText: source });
    assert.equal(rewritten.ok, false);
    if (!rewritten.ok) assert.equal(rewritten.sentence, "The Lab doesn't rewrite a quote.");
    const fiveWords = Array.from({ length: 5 }, () => "x".repeat(70)).join(" ");
    const five = acceptQuote({ words: fiveWords, source: "typed" });
    assert.equal(five.ok, false);
    if (!five.ok) assert.match(five.sentence, /five lines/);
    assert.equal(quoteLines(fiveWords).length, 5);
    const emoji = acceptQuote({ words: "🔥 👊", source: "typed" });
    assert.equal(emoji.ok, false);
  });

  it("holds a scarcity quote unless a live claim covers it", () => {
    const held = validateQuote("90% sold out", FACTS);
    assert.equal(held.ok, false);
    assert.match(held.sentence ?? "", /ticket tiers/);
    const live = validateQuote("90% sold out", {
      ...FACTS,
      captionRelease: "2nd release",
      liveClaims: [{ release: "2nd release", claim: "90% sold out", live: true }],
    });
    assert.equal(live.ok, true);
    assert.equal(live.sentence, null);
  });

  it("restores the caption generator when quote mode is left", () => {
    const left = leaveCaption({ mode: "caption", generator, snapshot: generator });
    const drifted: CaptionGenerator = { angle: "lineup", count: 1, each: false, stage: "upcoming" };
    const back = returnToCaption({ ...left, generator: drifted });
    assert.deepEqual(back.generator, generator);
    assert.equal(back.mode, "caption");
  });

  it("lists a stored post caption and greys a post with none", () => {
    const posts = postsForQuote([
      { permalink: "https://instagram.com/p/one", caption: "As posted.", postedAt: "2026-10-12" },
      { permalink: "https://instagram.com/p/two", caption: null, postedAt: "2026-10-01" },
      { permalink: null, caption: "no link", postedAt: null },
    ]);
    assert.equal(posts.length, 2);
    assert.equal(posts[0]?.offered, true);
    assert.equal(posts[0]?.caption, "As posted.");
    assert.equal(posts[1]?.offered, false);
    assert.equal(posts[1]?.note, "no caption on this post");
    assert.equal(posts[1]?.caption, null);
  });

  it("offers a captioned post, greys one without, and stores the caption byte for byte", () => {
    const caption = "See you on the 27th 🔥\n";
    const permalink = "https://www.instagram.com/p/enzo/";
    const posts = postsForQuote([
      { permalink: "https://www.instagram.com/p/old/", caption: null, postedAt: "2026-09-01" },
      { permalink, caption, postedAt: "2026-10-12" },
      { permalink: "https://www.instagram.com/p/blank/", caption: "   ", postedAt: "2026-10-02" },
    ]);
    assert.equal(posts[0]?.permalink, permalink);
    assert.equal(posts[0]?.offered, true);
    assert.equal(posts[0]?.caption, caption);
    assert.equal(posts[1]?.offered, false);
    assert.equal(posts[1]?.note, "no caption on this post");
    assert.equal(posts[2]?.offered, false);
    const stored = quoteInsert({
      words: caption,
      source: "post",
      sourceText: caption,
      sourceRef: permalink,
      artistId: "artist-enzo",
    });
    assert.equal(stored.ok, true);
    if (!stored.ok) return;
    assert.equal(stored.row.text, caption);
    assert.equal(stored.row.quote_source_ref, permalink);
  });

  it("does not call the writer", async () => {
    await assert.rejects(
      () => generateCaptions({} as ServiceRoleDb, { eventId: "evt", style: "quote" as CaptionStyle, n: 1 }),
      /does not call the writer/,
    );
  });

  it("refuses a passage the font wraps to five lines, and the meter is that wrap", () => {
    const bit = "records";
    const words: string[] = [];
    while (quoteLines(words.join(" ")).length < 5) words.push(bit);
    const five = words.join(" ");
    assert.equal(quoteLines(five).length, 5);
    const refused = acceptQuote({ words: five, source: "typed" });
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.match(refused.sentence, /five lines/);
    const fitted = words.slice(0, -1).join(" ");
    const lines = quoteLines(fitted);
    assert.ok(lines.length <= 4);
    assert.equal(lines.length, quoteLines(lines.join("\n")).length);
    for (const line of lines) assert.ok(quoteTextEm(line, 700) <= quoteWrapEm() + 1e-9);
    const enzo = "Southampton, this one's going to be special. Three hours, no phone in my hand, just records I've been saving for it. See you on the 27th 🔥";
    const rendered = quoteLines(enzo);
    assert.equal(rendered.length, 4);
    assert.equal(rendered.length, quoteLines(rendered.join("\n")).length);
    assert.match(rendered[rendered.length - 1] ?? "", /🔥/);
  });

  it("uses the cleared-gate sentence", () => {
    assert.equal(
      heldQuoteSentence("Luke Dean"),
      "These are Luke Dean's own words, so they run only once they're cleared for their own channels.",
    );
    assert.equal(
      heldQuoteSentence("Luke Dean", "he/him"),
      "These are Luke Dean's own words, so they run only once he's cleared for his own channels.",
    );
    assert.equal(quotePronoun({ pronouns: "she/her" }).subject, "she's");
    assert.match(sourceChip({ source: "post", handle: "enzosiragusa", postedLabel: "12 Oct", wide: true }), /@enzosiragusa · post, 12 Oct/);
    assert.equal(sourceChip({ source: "post", handle: "enzosiragusa", postedLabel: "12 Oct", wide: false }), "● @enzosiragusa · 12 Oct");
    assert.equal(sourceChip({ source: "press_kit", wide: true }), "press kit");
  });
});
