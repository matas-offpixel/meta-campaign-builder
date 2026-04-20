import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { VERTICAL_RULES, classifyVertical } from "../verticals.ts";

describe("classifyVertical", () => {
  it("buckets music labels into music_entertainment", () => {
    assert.equal(classifyVertical("Electronic Music"), "music_entertainment");
    assert.equal(classifyVertical("DJ Sets"), "music_entertainment");
    assert.equal(classifyVertical("Hip-Hop Heads"), "music_entertainment");
    assert.equal(classifyVertical("Rock Concerts"), "music_entertainment");
  });

  it("buckets gaming labels into games", () => {
    assert.equal(classifyVertical("Mobile Gaming"), "games");
    assert.equal(classifyVertical("Esports Fans"), "games");
  });

  it("buckets lifestyle labels into lifestyle", () => {
    assert.equal(classifyVertical("Lifestyle"), "lifestyle");
    assert.equal(classifyVertical("Home Decor"), "lifestyle");
    assert.equal(classifyVertical("Wellness"), "lifestyle");
  });

  it("buckets food / drink labels", () => {
    assert.equal(classifyVertical("Food Lovers"), "food_drink");
    assert.equal(classifyVertical("Cocktail Enthusiasts"), "food_drink");
  });

  it("buckets beauty / fashion labels", () => {
    assert.equal(classifyVertical("Streetwear"), "beauty_fashion");
    assert.equal(classifyVertical("Skincare Routine"), "beauty_fashion");
    assert.equal(classifyVertical("Makeup Tutorials"), "beauty_fashion");
  });

  it("buckets travel labels", () => {
    assert.equal(classifyVertical("Travel & Tourism"), "travel");
    assert.equal(classifyVertical("Hotel Bookings"), "travel");
    assert.equal(classifyVertical("Airline Deals"), "travel");
  });

  it("buckets shopping / commerce labels", () => {
    assert.equal(classifyVertical("Shopping Apps"), "shopping_commerce");
    assert.equal(classifyVertical("Retail Deals"), "shopping_commerce");
  });

  it("buckets tech labels", () => {
    assert.equal(classifyVertical("Tech Gadgets"), "tech");
    assert.equal(classifyVertical("Software Engineers"), "tech");
  });

  it("buckets sports / fitness labels", () => {
    assert.equal(classifyVertical("Sports Fans"), "sports_fitness");
    assert.equal(classifyVertical("Yoga Enthusiasts"), "sports_fitness");
    assert.equal(classifyVertical("Gym Goers"), "sports_fitness");
  });

  it("returns null for unmatched / empty labels", () => {
    assert.equal(classifyVertical("Politics"), null);
    assert.equal(classifyVertical("Real Estate"), null);
    assert.equal(classifyVertical(""), null);
  });

  it("VERTICAL_RULES covers every TikTokVertical except 'other'", () => {
    const expected = new Set([
      "music_entertainment",
      "games",
      "lifestyle",
      "food_drink",
      "beauty_fashion",
      "travel",
      "shopping_commerce",
      "tech",
      "sports_fitness",
    ]);
    const actual = new Set(VERTICAL_RULES.map((r) => r.vertical));
    assert.deepEqual(actual, expected);
  });
});
