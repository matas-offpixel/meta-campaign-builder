import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

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

const generator: CaptionGenerator = { angle: "scarcity", count: 5, pair: "each", stage: "on_sale" };

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
    const fiveWords = Array.from({ length: 6 }, () => "word".repeat(4)).join(" ");
    const five = acceptQuote({ words: fiveWords, source: "typed" });
    assert.equal(five.ok, false);
    if (!five.ok) assert.equal(five.sentence, "This quote is too long — drop a sentence from the start or end.");
    const emoji = acceptQuote({ words: "🔥 👊", source: "typed" });
    assert.equal(emoji.ok, false);
  });

  it("holds a scarcity quote unless a live claim covers it", () => {
    const held = validateQuote("90% sold out", FACTS);
    assert.equal(held.ok, false);
    assert.match(held.sentence ?? "", /isn't true of this event's tickets yet/);
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
    const drifted: CaptionGenerator = { angle: "lineup", count: 1, pair: "best", stage: "upcoming" };
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

  it("wraps a quote once at 24 and keeps a line that fits", () => {
    const luke = "Back in Southampton for this one… Closing out the year with Puzzle on 27th December. See you there";
    const lines = quoteLines(luke);
    assert.equal(lines.length, 5);
    assert.equal(lines.join(" "), luke);
    assert.equal(acceptQuote({ words: luke, source: "typed" }).ok, true);
    const sixth = `${luke} and one more sentence here`;
    const refused = acceptQuote({ words: sixth, source: "typed" });
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.equal(refused.sentence, "This quote is too long — drop a sentence from the start or end.");
    const overlay = readFileSync("components/dashboard/events/creative-lab/caption-overlay.tsx", "utf8");
    const surface = readFileSync("components/dashboard/events/creative-lab/quote-surface.tsx", "utf8");
    const composition = readFileSync("src/remotion/compositions/CaptionOnClip.tsx", "utf8");
    assert.match(surface, /lines=\{quoteLines\(words, weight\)\}/);
    assert.match(overlay, /WebkitTextStroke/);
    assert.doesNotMatch(overlay, /whitespace-pre-line/);
    assert.match(composition, /whiteSpace: "pre"/);
    assert.doesNotMatch(composition, /quoteProfile/);
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
