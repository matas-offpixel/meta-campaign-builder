import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { URL_TAGS, urlTagsFor, urlTagsReviewLine } from "../url-tags.ts";

describe("urlTagsFor", () => {
  it("tags a URL with no utm parameters", () => {
    assert.equal(urlTagsFor("https://crqln.com/adam-ten-london"), URL_TAGS);
    assert.equal(urlTagsFor("https://crqln.com/x?ref=ig&fbclid=abc"), URL_TAGS);
  });

  it("keeps the operator's own utm_source", () => {
    assert.equal(urlTagsFor("https://crqln.com/x?utm_source=x"), undefined);
  });

  it("matches utm_ keys case-insensitively, empty value included", () => {
    assert.equal(urlTagsFor("https://crqln.com/x?ref=a&UTM_Campaign="), undefined);
  });

  it("keeps a URL that already uses Meta macros", () => {
    assert.equal(urlTagsFor("https://crqln.com/x?c={{campaign.name}}"), undefined);
    assert.equal(urlTagsFor("https://crqln.com/{{ad.id}}"), undefined);
  });

  it("ignores utm-looking text in the fragment", () => {
    assert.equal(urlTagsFor("https://crqln.com/x#utm_source=x"), URL_TAGS);
    assert.equal(urlTagsFor("https://crqln.com/x?ref=a#utm_source=x"), URL_TAGS);
  });

  it("reads the query before a fragment", () => {
    assert.equal(urlTagsFor("https://crqln.com/x?utm_medium=y#top"), undefined);
  });

  it("tags a URL with a trailing ? and no parameters", () => {
    assert.equal(urlTagsFor("https://crqln.com/x?"), URL_TAGS);
    assert.equal(urlTagsFor("https://crqln.com/x?#top"), URL_TAGS);
  });

  it("does not treat a non-utm key containing utm as a utm key", () => {
    assert.equal(urlTagsFor("https://crqln.com/x?nonutm_source=a&xutm_=b"), URL_TAGS);
  });

  it("tags an empty or missing URL", () => {
    assert.equal(urlTagsFor(""), URL_TAGS);
    assert.equal(urlTagsFor(undefined), URL_TAGS);
  });

  it("review line counts ads on launching ad sets only", () => {
    const creatives = [
      { id: "a", destinationUrl: "https://crqln.com/x" },
      { id: "b", destinationUrl: "https://crqln.com/x?utm_source=mc" },
    ];
    const assignments = { s1: ["a", "b"], s2: ["a"], off: ["a", "b"] };
    assert.equal(
      urlTagsReviewLine(creatives, assignments, ["s1", "s2"]),
      "Tracking: utm tags added to 2 ads. 1 keeps its own utm tags.",
    );
    assert.equal(urlTagsReviewLine(creatives, assignments, ["s2"]), "Tracking: utm tags added to 1 ad.");
    assert.equal(
      urlTagsReviewLine(creatives, { s1: ["b"], s2: ["b"] }, ["s1", "s2"]),
      "Tracking: utm tags added to 0 ads. 2 keep their own utm tags.",
    );
    assert.equal(urlTagsReviewLine(creatives, assignments, []), null);
  });

  it("is the exact tag string with ids, not names", () => {
    assert.equal(
      URL_TAGS,
      "utm_source=meta&utm_medium=paid&utm_campaign={{campaign.id}}&utm_content={{adset.id}}&utm_term={{ad.id}}",
    );
  });
});
