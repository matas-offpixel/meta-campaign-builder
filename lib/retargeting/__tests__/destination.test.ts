/**
 * Matas, 27 Nov: create_show_campaigns(destination: { link, url_tags }) — the
 * link replaces every copied ad's website URL, url_tags goes on the creative
 * as Meta takes it (the braces literal), copy and creative stay as they are.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { creativeWithDestination, DestinationRefused, destinationKey, DESTINATION_WORDS, validateDestination } from "../destination.ts";

const RUDIMENTAL = { link: "https://www.rudimental-newcastle.com/", url_tags: "ref=meta&utm_source=meta&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{adset.name}}&utm_term={{ad.name}}" };
const dest = { link: RUDIMENTAL.link, urlTags: RUDIMENTAL.url_tags };

test("validateDestination: Rudimental's link and parameters pass as written; a bad one is refused", () => {
  assert.deepEqual(validateDestination(RUDIMENTAL), { ok: true, destination: dest });
  assert.deepEqual(validateDestination({ link: "https://example.co.uk/x" }), { ok: true, destination: { link: "https://example.co.uk/x", urlTags: null } });
  assert.deepEqual(validateDestination(undefined), { ok: true, destination: null });
  for (const link of ["http://www.rudimental-newcastle.com/", "rudimental-newcastle.com", "https://localhost/", "https://a b.com/"]) assert.deepEqual(validateDestination({ link }), { ok: false, reason: DESTINATION_WORDS.badLink }, link);
  for (const url_tags of ["?utm_source=meta", "utm_source", "utm source=meta", "a=1&&b=2", "a=1#x"]) assert.deepEqual(validateDestination({ link: RUDIMENTAL.link, url_tags }), { ok: false, reason: DESTINATION_WORDS.badTags }, url_tags);
  assert.notEqual(destinationKey(dest), destinationKey({ ...dest, urlTags: null }));
  assert.equal(destinationKey(null), "");
});

test("a video creative: its button's link is the new one, its type, video, thumbnail, copy and identity kept; url_tags replaced, braces literal", () => {
  const out = creativeWithDestination(
    { object_story_spec: { page_id: "1001", instagram_user_id: "ig1", video_data: { video_id: "v1", image_hash: "h1", message: "Rudimental live", title: "Tickets", call_to_action: { type: "BOOK_TRAVEL", value: { link: "https://www.skiddle.com/e/1" } } } }, url_tags: "utm_source=old" },
    dest,
    "Rudimental · announce",
  );
  // The app's strict set: Meta's creative enhancements off on every new creative.
  assert.ok((out as { degrees_of_freedom_spec?: unknown }).degrees_of_freedom_spec);
  delete (out as { degrees_of_freedom_spec?: unknown }).degrees_of_freedom_spec;
  assert.deepEqual(out, {
    name: "Rudimental · announce",
    object_story_spec: { page_id: "1001", instagram_user_id: "ig1", video_data: { video_id: "v1", image_hash: "h1", message: "Rudimental live", title: "Tickets", call_to_action: { type: "BOOK_TRAVEL", value: { link: dest.link } } } },
    url_tags: RUDIMENTAL.url_tags,
  });
  assert.ok(!JSON.stringify(out).includes("%7B"), "braces never encoded");
});

test("an image creative: the link and its button's link replaced, copy and image kept; a carousel is refused (the strict set leaves out its cards)", () => {
  const out = creativeWithDestination(
    { object_story_spec: { page_id: "1001", link_data: { link: "https://www.skiddle.com/e/1", image_hash: "h1", message: "Lineup out now", name: "Rudimental", call_to_action: { type: "LEARN_MORE", value: { link: "https://www.skiddle.com/e/1" } } } }, url_tags: "utm_source=old" },
    { link: dest.link, urlTags: null },
    "Lineup",
  ) as { object_story_spec: { link_data: Record<string, unknown> }; url_tags?: string };
  assert.deepEqual(out.object_story_spec.link_data, { image_hash: "h1", message: "Lineup out now", name: "Rudimental", link: dest.link, call_to_action: { type: "LEARN_MORE", value: { link: dest.link } } });
  assert.equal(out.url_tags, undefined, "no url_tags given: none set, the source's not carried");
  assert.ok(!JSON.stringify(out).includes("skiddle.com"), "no old link left");
  const carousel = { object_story_spec: { page_id: "1001", link_data: { link: "https://www.skiddle.com/e/1", child_attachments: [{ link: "https://www.skiddle.com/e/1", image_hash: "h1" }] } } };
  assert.throws(() => creativeWithDestination(carousel, dest, "Cards"), (err: unknown) => err instanceof DestinationRefused && err.kind === "carousel");
});

test("a per-placement creative: link_urls' website URL replaced (its display URL dropped), every asset, label and rule kept", () => {
  const src = {
    object_story_spec: { page_id: "1001", instagram_user_id: "ig1" },
    asset_feed_spec: {
      bodies: [{ text: "Rudimental live" }],
      videos: [{ video_id: "v1", adlabels: [{ id: "l1", name: "feed" }] }, { video_id: "v2", adlabels: [{ id: "l2", name: "story" }] }],
      link_urls: [{ website_url: "https://www.skiddle.com/e/1", display_url: "skiddle.com" }],
      asset_customization_rules: [{ customization_spec: { publisher_platforms: ["instagram"] }, video_label: { id: "l2", name: "story" } }],
    },
  };
  const out = creativeWithDestination(src, dest, "Rudimental · announce") as { url_tags: string; asset_feed_spec: Record<string, unknown> };
  assert.deepEqual(out.asset_feed_spec.link_urls, [{ website_url: dest.link }]);
  assert.deepEqual(out.asset_feed_spec.bodies, src.asset_feed_spec.bodies);
  // Labels go by name on a new creative.
  assert.deepEqual(out.asset_feed_spec.videos, [{ video_id: "v1", adlabels: [{ name: "feed" }] }, { video_id: "v2", adlabels: [{ name: "story" }] }]);
  assert.deepEqual(out.asset_feed_spec.asset_customization_rules, [{ customization_spec: { publisher_platforms: ["instagram"] }, video_label: { name: "story" } }]);
  assert.equal(out.url_tags, RUDIMENTAL.url_tags);
});

test("a creative built from a post can't take a new link; one with nothing to rebuild is refused too", () => {
  assert.throws(() => creativeWithDestination({ object_story_id: "1001_555" }, dest, "A post"), (err: unknown) => err instanceof DestinationRefused && err.kind === "from_post");
  assert.throws(() => creativeWithDestination({}, dest, "Nothing"), (err: unknown) => err instanceof DestinationRefused && err.kind === "unknown");
});

test("design's words (27 Nov, on #1409): the plan line shows the full link and url_tags as they'll run, never cut or encoded; the refusals and reasons", () => {
  assert.equal(DESTINATION_WORDS.line(dest), "Destination: https://www.rudimental-newcastle.com/ · URL parameters ref=meta&utm_source=meta&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{adset.name}}&utm_term={{ad.name}}");
  assert.equal(DESTINATION_WORDS.line({ link: dest.link, urlTags: null }), "Destination: https://www.rudimental-newcastle.com/");
  assert.equal(DESTINATION_WORDS.oneShow, "Refused: a destination is for one show at a time, so give one event code. Nothing was changed.");
  assert.equal(DESTINATION_WORDS.madeWithOther("NX26-RUDIMENTAL", dest), "Refused: NX26-RUDIMENTAL’s ads are already made with https://www.rudimental-newcastle.com/ as their destination, and create_show_campaigns doesn’t change ads that are made. Nothing was changed.");
  assert.equal(DESTINATION_WORDS.madeWithOther("NX26-RUDIMENTAL", null), "Refused: NX26-RUDIMENTAL’s ads are already made with the copied ads’ own links, and create_show_campaigns doesn’t change ads that are made. Nothing was changed.");
  assert.equal(DESTINATION_WORDS.fromPost("Rudimental · announce"), "Rudimental · announce runs from a post, so its link is the post’s and can’t be changed");
  assert.equal(DESTINATION_WORDS.carousel("Lineup"), "Lineup is a carousel, so its link can’t be changed without losing its cards");
  assert.equal(DESTINATION_WORDS.unread("Lineup"), "Lineup’s creative couldn’t be read for the new link");
  assert.equal(DESTINATION_WORDS.badLink, "Refused: the destination link must be a full https:// web address. Nothing was changed.");
  assert.equal(DESTINATION_WORDS.badTags, "Refused: url_tags must be URL parameters like utm_source=meta&utm_medium=paid, with no “?” in front. Nothing was changed.");
});
