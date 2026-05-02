import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  classifyAdAgainstOpponents,
  extractOpponentName,
  isKnockoutStageName,
} from "../event-opponent-extraction.ts";

describe("isKnockoutStageName", () => {
  it("detects the canonical round markers", () => {
    assert.equal(isKnockoutStageName("Last 32"), true);
    assert.equal(isKnockoutStageName("LAST 16"), true);
    assert.equal(isKnockoutStageName("Round of 16"), true);
    assert.equal(isKnockoutStageName("Quarter Final"), true);
    assert.equal(isKnockoutStageName("Semi-Final"), true);
    assert.equal(isKnockoutStageName("Final"), true);
    assert.equal(isKnockoutStageName("Knockout stage"), true);
  });

  it("tolerates punctuation and spacing variants", () => {
    assert.equal(isKnockoutStageName("last-32"), true);
    assert.equal(isKnockoutStageName("LAST_32"), true);
    assert.equal(isKnockoutStageName("  last  32  "), true);
  });

  it("treats group-stage names and empties as non-knockout", () => {
    assert.equal(isKnockoutStageName("England v Croatia"), false);
    assert.equal(isKnockoutStageName("Scotland v Brazil"), false);
    assert.equal(isKnockoutStageName(""), false);
    assert.equal(isKnockoutStageName(null), false);
    assert.equal(isKnockoutStageName(undefined), false);
  });
});

describe("extractOpponentName", () => {
  it("parses the canonical 'England v Croatia' pattern", () => {
    assert.equal(extractOpponentName("England v Croatia"), "croatia");
  });

  it("accepts vs / - / x separators", () => {
    assert.equal(extractOpponentName("England vs Croatia"), "croatia");
    assert.equal(extractOpponentName("England - Croatia"), "croatia");
    assert.equal(extractOpponentName("Scotland x Brazil"), "brazil");
  });

  it("preserves multi-word opponent names", () => {
    assert.equal(extractOpponentName("England v Ivory Coast"), "ivory coast");
    assert.equal(
      extractOpponentName("Scotland vs United States"),
      "united states",
    );
  });

  it("collapses excessive whitespace", () => {
    assert.equal(
      extractOpponentName("England    v    Croatia  "),
      "croatia",
    );
  });

  it("returns stage labels for knockout-labelled events", () => {
    assert.equal(extractOpponentName("Last 32"), "last 32");
    assert.equal(extractOpponentName("England Last 32"), "last 32");
    assert.equal(extractOpponentName("England - Round of 16"), "round of 16");
    assert.equal(extractOpponentName("England Quarter Final"), "quarter final");
    assert.equal(extractOpponentName("England - Semi Final"), "semi final");
    assert.equal(extractOpponentName("England - Final"), "final");
    // Even when a separator is present, a knockout marker elsewhere
    // in the name takes precedence — operators tag TBD knockouts as
    // "England v Winner Group B - Last 16".
    assert.equal(
      extractOpponentName("England v Winner Group B - Last 16"),
      "round of 16",
    );
  });

  it("returns null when no separator is present", () => {
    assert.equal(extractOpponentName("Fan Park Opening Ceremony"), null);
    assert.equal(extractOpponentName("Pre-event tour"), null);
  });

  it("returns null for null/empty input", () => {
    assert.equal(extractOpponentName(null), null);
    assert.equal(extractOpponentName(undefined), null);
    assert.equal(extractOpponentName(""), null);
    assert.equal(extractOpponentName("   "), null);
  });

  it("is case-insensitive on the separator but lowercases output", () => {
    assert.equal(extractOpponentName("England V Croatia"), "croatia");
    assert.equal(extractOpponentName("England VS CROATIA"), "croatia");
  });
});

describe("classifyAdAgainstOpponents", () => {
  const venue = ["croatia", "ghana", "panama"] as const;

  it("returns specific match when opponent appears as a whole word", () => {
    assert.deepEqual(
      classifyAdAgainstOpponents("WC26 Croatia Static 01", venue),
      { kind: "specific", opponent: "croatia" },
    );
    assert.deepEqual(
      classifyAdAgainstOpponents("Ghana Video v2", venue),
      { kind: "specific", opponent: "ghana" },
    );
  });

  it("is case-insensitive", () => {
    assert.deepEqual(
      classifyAdAgainstOpponents("WC26 CROATIA static 01", venue),
      { kind: "specific", opponent: "croatia" },
    );
  });

  it("does NOT match substrings that share a prefix ('Brazilian' ≠ 'Brazil')", () => {
    const brazilVenue = ["brazil"] as const;
    assert.deepEqual(
      classifyAdAgainstOpponents("Brazilian Carnival Teaser", brazilVenue),
      { kind: "generic" },
    );
    assert.deepEqual(
      classifyAdAgainstOpponents("WC26 Brazil Static 01", brazilVenue),
      { kind: "specific", opponent: "brazil" },
    );
  });

  it("falls back to generic when no opponent appears in the ad name", () => {
    assert.deepEqual(
      classifyAdAgainstOpponents("WC26 Generic On-sale Hero", venue),
      { kind: "generic" },
    );
  });

  it("matches multi-word opponents as a unit", () => {
    const multi = ["ivory coast"] as const;
    assert.deepEqual(
      classifyAdAgainstOpponents("WC26 Ivory Coast Static", multi),
      { kind: "specific", opponent: "ivory coast" },
    );
    assert.deepEqual(
      classifyAdAgainstOpponents("WC26 Ivorian Sample", multi),
      { kind: "generic" },
    );
  });

  it("tie-breaks on the FIRST opponent in the venue list", () => {
    // An ad name containing both 'croatia' and 'ghana' resolves to
    // whichever appears earliest in the supplied list. Callers
    // pass opponents in the venue card's render order, so the tie
    // resolution is deterministic and operator-predictable.
    const ordered = ["croatia", "ghana"] as const;
    assert.deepEqual(
      classifyAdAgainstOpponents("Croatia + Ghana joint teaser", ordered),
      { kind: "specific", opponent: "croatia" },
    );
    // Swap order to confirm the tie-break follows the list.
    const swapped = ["ghana", "croatia"] as const;
    assert.deepEqual(
      classifyAdAgainstOpponents("Croatia + Ghana joint teaser", swapped),
      { kind: "specific", opponent: "ghana" },
    );
  });

  it("handles empty or all-blank opponent lists as generic", () => {
    assert.deepEqual(
      classifyAdAgainstOpponents("WC26 Croatia Static", []),
      { kind: "generic" },
    );
    assert.deepEqual(
      classifyAdAgainstOpponents("WC26 Croatia Static", ["", " "]),
      { kind: "generic" },
    );
  });

  it("handles empty ad name as generic", () => {
    assert.deepEqual(
      classifyAdAgainstOpponents("", venue),
      { kind: "generic" },
    );
  });

  it("escapes regex metacharacters in opponent names", () => {
    // Defensive — we don't expect special chars in opponent names,
    // but the extractor is fed raw operator-entered text, so make
    // sure an accidentally escaped character doesn't throw.
    const weird = ["côte d'ivoire"] as const;
    assert.deepEqual(
      classifyAdAgainstOpponents("WC26 Côte d'Ivoire Static", weird),
      { kind: "specific", opponent: "côte d'ivoire" },
    );
  });
});
