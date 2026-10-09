import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { createDefaultAsset, createDefaultCreative, createDefaultDraft } from "../../campaign-defaults.ts";
import { planToGoogleDraft } from "../adapters/google.ts";
import { creativeDraftFingerprint } from "../creative-intake-apply.ts";
import { singleGroupKey, type IntakeSendAsset } from "../creative-intake.ts";
import {
  applyCopy,
  applyCopyToGoogleTree,
  DRAWER_COPY_NOTE,
  META_COPY_LAUNCHED_NOTE,
  sendAfterApplyIsNoop,
  TIKTOK_COPY_LAUNCHED_NOTE,
} from "../copy-apply.ts";
import { factCorpus, unsupportedFact, type CopyEventFacts } from "../copy-facts.ts";
import { fetchEventPage, isBlockedIp } from "../copy-fetch.ts";
import { COPY_LIMITS, fitLimit, fitTikTok } from "../copy-limits.ts";
import { scrapeHtml } from "../copy-scrape.ts";
import { buildSuggestions, keywordsFromEvent, MML_COPY_MODEL } from "../copy-suggest.ts";
import { IDLE_PLAN_LAUNCH, type CampaignPlan } from "../types.ts";
import { createDefaultTikTokDraft } from "../../types/tiktok-draft.ts";

const event = (): CopyEventFacts => ({
  name: "CamelPhat",
  artist: "CamelPhat",
  venue: "Printworks",
  city: "London",
  date: "2026-10-24",
  ticketDate: "",
  saleDate: "2026-09-01",
  price: "44.50",
  capacity: "",
  clientName: "Night",
});

describe("fact check", () => {
  const corpus = () => factCorpus("CamelPhat at Printworks. Tickets £44.50.", event());

  it("keeps a line whose price, date and names are in the source", () => {
    assert.equal(unsupportedFact("CamelPhat at Printworks on 24 Oct, tickets £44.50", corpus()), null);
  });

  it("drops a venue the page and the event do not name", () => {
    assert.match(unsupportedFact("CamelPhat at Fabric", corpus()) ?? "", /Fabric/);
  });

  it("drops a price, a capacity and sold out when the source has none", () => {
    assert.match(unsupportedFact("Tickets £12", corpus()) ?? "", /12/);
    assert.match(unsupportedFact("Capacity 2000", corpus()) ?? "", /capacity/i);
    assert.match(unsupportedFact("Sold out", corpus()) ?? "", /sold out/);
    assert.match(unsupportedFact("Last tickets", corpus()) ?? "", /last ticket/);
  });

  it("allows a capacity that is on the event row", () => {
    const withCapacity = factCorpus("", { ...event(), capacity: "2000" });
    assert.equal(unsupportedFact("Capacity 2000", withCapacity), null);
  });
});

describe("channel limits", () => {
  it("trims a headline at a word boundary and drops a word that cannot fit", () => {
    const long = "CamelPhat at Printworks this October night out";
    const fitted = fitLimit(long, COPY_LIMITS.metaHeadline);
    assert.ok(fitted);
    assert.ok(fitted.length <= 40);
    assert.equal(fitted.includes(" "), true);
    assert.equal(fitLimit("Supercalifragilisticexpialidocious night", 10), null);
  });

  it("keeps TikTok text inside 1–100 and never returns a longer line", () => {
    const over = `${"word ".repeat(40)}end`;
    const fitted = fitTikTok(over);
    assert.ok(fitted);
    assert.ok(fitted.length <= 100);
    assert.ok(fitted.length >= 1);
    assert.equal(fitTikTok(""), null);
  });

  it("drops an unsupported fact and a line over the limit, and caps the counts", () => {
    const raw = JSON.stringify({
      metaPrimary: ["CamelPhat at Printworks", "Sold out tonight", "Only £12 left"],
      metaHeadlines: ["CamelPhat at Printworks this October night out"],
      metaDescriptions: ["Printworks London"],
      tiktok: [`${"CamelPhat ".repeat(30)}`],
      googleHeadlines: ["CamelPhat", "Fabric"],
      googleDescriptions: ["Printworks London"],
    });
    const built = buildSuggestions(raw, factCorpus("", event()));
    assert.ok(built.suggestions.metaPrimary.includes("CamelPhat at Printworks"));
    assert.equal(built.suggestions.metaPrimary.some((line) => /sold out|£12|12/i.test(line)), false);
    assert.ok(built.suggestions.metaHeadlines[0]);
    assert.ok(built.suggestions.metaHeadlines[0].length <= 40);
    assert.ok(built.suggestions.tiktok[0]);
    assert.ok(built.suggestions.tiktok[0].length <= 100);
    assert.deepEqual(built.suggestions.googleHeadlines, ["CamelPhat"]);
    assert.match(built.droppedLine, /^dropped \d+: unsupported fact/);
    assert.equal(MML_COPY_MODEL, "claude-haiku-4-5");
  });

  it("keywords are the event name, artist and venue, and nothing invented", () => {
    assert.deepEqual(
      keywordsFromEvent({ name: "CamelPhat", artist: "CamelPhat", venue: "Printworks" }).map((row) => row.keyword),
      ["camelphat", "printworks"],
    );
    const notes = keywordsFromEvent(event()).map((row) => row.notes).join(" ");
    assert.equal(/tickets|free|jobs/.test(notes), false);
  });
});

describe("page fetch and scrape", () => {
  it("refuses private, loopback and link-local addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.0.4", "172.16.0.1", "169.254.169.254", "::1", "fe80::1"]) {
      assert.equal(isBlockedIp(ip), true, ip);
    }
    assert.equal(isBlockedIp("93.184.216.34"), false);
  });

  it("refuses a private address before the request, including after a redirect", async () => {
    let calls = 0;
    const blocked = await fetchEventPage("http://127.0.0.1/tickets", {
      lookup: async () => ["127.0.0.1"],
      fetch: async () => {
        calls += 1;
        return new Response("no", { status: 200, headers: { "content-type": "text/html" } });
      },
    });
    assert.equal(blocked.ok, false);
    assert.match(blocked.ok ? "" : blocked.reason, /private/i);
    assert.equal(calls, 0);

    const redirected = await fetchEventPage("https://tickets.example/event", {
      lookup: async (host) => (host === "internal.example" ? ["10.0.0.8"] : ["93.184.216.34"]),
      fetch: async () =>
        new Response(null, { status: 302, headers: { location: "https://internal.example/secret" } }),
    });
    assert.equal(redirected.ok, false);
    assert.match(redirected.ok ? "" : redirected.reason, /private/i);
  });

  it("reads title, meta, open graph and a JSON-LD event", () => {
    const page = scrapeHtml(`<!doctype html><html><head>
      <title>CamelPhat</title>
      <meta name="description" content="At Printworks">
      <meta property="og:title" content="CamelPhat">
      <meta property="og:description" content="London">
      <meta property="og:image" content="https://cdn.example/art.jpg">
      <script type="application/ld+json">
        {"@type":"Event","name":"CamelPhat","startDate":"2026-10-24","location":{"@type":"Place","name":"Printworks"},"offers":{"price":"44.50","priceCurrency":"GBP"},"performer":{"@type":"Person","name":"CamelPhat"}}
      </script>
    </head><body>Tickets fan@secret.example</body></html>`);
    assert.equal(page.title, "CamelPhat");
    assert.equal(page.description, "At Printworks");
    assert.equal(page.ogTitle, "CamelPhat");
    assert.equal(page.ogImage, "https://cdn.example/art.jpg");
    assert.equal(page.event?.location, "Printworks");
    assert.equal(page.event?.price, "44.50");
    assert.equal(page.event?.priceCurrency, "GBP");
    assert.equal(page.event?.performer, "CamelPhat");
    assert.equal(page.text.includes("fan@secret.example"), false);
  });
});

function metaCreative(id: string) {
  const creative = createDefaultCreative();
  creative.id = id;
  creative.name = "Creative";
  creative.identity = { pageId: "page-1", instagramAccountId: "ig-1", instagramActorId: "ig-1" };
  const asset = createDefaultAsset("4:5");
  asset.registryAssetId = "asset-1";
  creative.assetVariations = [{ id: "var-1", name: "Variation 1", assets: [asset] }];
  return creative;
}

describe("apply", () => {
  const asset: IntakeSendAsset = { id: "asset-1", mediaKind: "image", bucket: "4:5", groupId: null };

  it("writes ticked copy onto an MML creative, then Send is a no-op", () => {
    const draft = createDefaultDraft();
    const creative = metaCreative("creative-1");
    draft.creatives = [creative];
    const before = creativeDraftFingerprint(creative);
    const applied = applyCopy({
      meta: draft,
      tiktok: null,
      owned: [{ key: singleGroupKey("asset-1"), creativeId: "creative-1", fingerprint: before, draftFingerprint: before }],
      selection: {
        metaPrimary: ["CamelPhat at Printworks", "London"],
        metaHeadline: "CamelPhat",
        metaDescription: "Printworks",
        tiktok: "",
        googleHeadlines: [],
        googleDescriptions: [],
        url: "https://tickets.example/event",
        cta: "book_now",
      },
      across: { caption: true, url: true, cta: true, headline: true, description: true },
      metaLaunched: false,
      tiktokLaunched: false,
    });
    const written = applied.meta?.creatives[0];
    assert.deepEqual(written?.captions.map((row) => row.text), ["CamelPhat at Printworks", "London"]);
    assert.equal(written?.headline, "CamelPhat");
    assert.equal(written?.headline.length <= 40, true);
    const stamped = applied.fingerprints[0];
    assert.ok(stamped);
    assert.equal(
      sendAfterApplyIsNoop({
        assets: [asset],
        owned: {
          key: stamped.key,
          creativeId: stamped.creativeId,
          fingerprint: stamped.fingerprint,
          draftFingerprint: stamped.fingerprint,
        },
      }),
      true,
    );
  });

  it("leaves a drawer edit and a drawer-made creative, and a launched channel", () => {
    const draft = createDefaultDraft();
    const owned = metaCreative("owned");
    const stranger = metaCreative("stranger");
    stranger.headline = "Drawer made";
    draft.creatives = [owned, stranger];
    const stored = creativeDraftFingerprint(owned);
    const applied = applyCopy({
      meta: draft,
      tiktok: null,
      owned: [{ key: "k", creativeId: "owned", fingerprint: stored, draftFingerprint: `${stored}-edited` }],
      selection: {
        metaPrimary: ["CamelPhat"],
        metaHeadline: "CamelPhat",
        metaDescription: "Printworks",
        tiktok: "",
        googleHeadlines: [],
        googleDescriptions: [],
        url: "",
        cta: "book_now",
      },
      across: { caption: true, url: false, cta: false, headline: true, description: true },
      metaLaunched: false,
      tiktokLaunched: false,
    });
    assert.equal(applied.meta?.creatives.find((row) => row.id === "owned")?.headline, "");
    assert.equal(applied.meta?.creatives.find((row) => row.id === "stranger")?.headline, "Drawer made");
    assert.ok(applied.notes.includes(DRAWER_COPY_NOTE));

    const launched = applyCopy({
      meta: draft,
      tiktok: null,
      owned: [{ key: "k", creativeId: "owned", fingerprint: stored, draftFingerprint: stored }],
      selection: {
        metaPrimary: ["CamelPhat"],
        metaHeadline: "CamelPhat",
        metaDescription: "",
        tiktok: "",
        googleHeadlines: [],
        googleDescriptions: [],
        url: "",
        cta: "book_now",
      },
      across: { caption: true, url: false, cta: false, headline: true, description: false },
      metaLaunched: true,
      tiktokLaunched: false,
    });
    assert.equal(launched.meta?.creatives[0]?.headline, "");
    assert.ok(launched.notes.includes(META_COPY_LAUNCHED_NOTE));
  });

  it("writes TikTok text within 100 characters on a routed creative only", () => {
    const draft = createDefaultTikTokDraft("tt-1");
    const blank = {
      id: "routed",
      name: "Routed",
      mode: "VIDEO_REFERENCE" as const,
      baseName: "Routed",
      videoId: null,
      videoUrl: null,
      thumbnailUrl: null,
      durationSeconds: null,
      title: null,
      sparkPostId: null,
      caption: "",
      adText: "",
      displayName: "",
      landingPageUrl: "",
      cta: null,
      musicId: null,
    };
    draft.creatives.items = [
      { ...blank, derivedFrom: "registry:asset-1" },
      { ...blank, id: "drawer", derivedFrom: undefined, adText: "Leave me", caption: "Leave me" },
    ];
    const long = `${"CamelPhat ".repeat(20)}Printworks`;
    const applied = applyCopy({
      meta: null,
      tiktok: draft,
      owned: [],
      selection: {
        metaPrimary: [],
        metaHeadline: "",
        metaDescription: "",
        tiktok: long,
        googleHeadlines: [],
        googleDescriptions: [],
        url: "https://tickets.example/event",
        cta: "book_now",
      },
      across: { caption: true, url: true, cta: false, headline: false, description: false },
      metaLaunched: false,
      tiktokLaunched: false,
    });
    const routed = applied.tiktok?.creatives.items.find((row) => row.id === "routed");
    const drawer = applied.tiktok?.creatives.items.find((row) => row.id === "drawer");
    assert.ok(routed);
    assert.ok(routed.adText.length >= 1 && routed.adText.length <= 100);
    assert.equal(routed.landingPageUrl, "https://tickets.example/event");
    assert.equal(drawer?.adText, "Leave me");

    const launched = applyCopy({
      meta: null,
      tiktok: draft,
      owned: [],
      selection: {
        metaPrimary: [],
        metaHeadline: "",
        metaDescription: "",
        tiktok: "CamelPhat",
        googleHeadlines: [],
        googleDescriptions: [],
        url: "",
        cta: "book_now",
      },
      across: { caption: true, url: false, cta: false, headline: false, description: false },
      metaLaunched: false,
      tiktokLaunched: true,
    });
    assert.equal(launched.tiktok?.creatives.items[0]?.adText, "");
    assert.ok(launched.notes.includes(TIKTOK_COPY_LAUNCHED_NOTE));
  });

  it("seeds Google headlines and event keywords, and leaves an operator field and a pushed plan", () => {
    const plan: CampaignPlan = {
      id: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      name: "CamelPhat",
      status: "draft",
      intent: {
        eventId: "33333333-3333-4333-8333-333333333333",
        objectiveIntent: "purchase",
        target: { value: null, unit: null },
        budget: { totalDaily: 10, metaDaily: 8, tiktokDaily: 1, googleDaily: 1 },
        destinationUrl: "https://tickets.example/event",
        audienceClusterRef: null,
        creativeSetRef: null,
        startDate: "2026-10-01",
        endDate: "2026-10-24",
        startTime: null,
        endTime: null,
      },
      launches: { meta: IDLE_PLAN_LAUNCH, tiktok: IDLE_PLAN_LAUNCH, google: IDLE_PLAN_LAUNCH },
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    };
    const tree = planToGoogleDraft(plan);
    tree.plan.geo_targets = [{ location: "London", resolved_resource_name: "geoTargetConstants/1006886" }];
    const rsa = tree.campaigns[0].ad_groups[0].rsas[0];
    rsa.headlines = [...rsa.headlines, { text: "Operator wrote this", pin_position: 1 }];
    tree.campaigns[0].ad_groups[0].keywords = [
      {
        id: "kw-op",
        ad_group_id: tree.campaigns[0].ad_groups[0].id,
        keyword: "operator term",
        match_type: "EXACT",
        est_cpc_low: null,
        est_cpc_high: null,
        intent: null,
        notes: null,
        pushed_resource_name: null,
        created_at: "2026-10-01T00:00:00.000Z",
      },
    ];
    const seeded = applyCopyToGoogleTree(tree, {
      headlines: ["CamelPhat", "Printworks"],
      descriptions: ["CamelPhat at Printworks"],
      keywords: keywordsFromEvent(event()),
    });
    const next = seeded.tree.campaigns[0].ad_groups[0].rsas[0];
    assert.ok(next.headlines.every((row) => row.text.length <= 30));
    assert.ok(next.descriptions.every((row) => row.text.length <= 90));
    assert.ok(next.headlines.some((row) => row.text === "Operator wrote this"));
    assert.deepEqual(seeded.tree.plan.geo_targets, tree.plan.geo_targets);
    const keywords = seeded.tree.campaigns[0].ad_groups[0].keywords.map((row) => row.keyword);
    assert.ok(keywords.includes("operator term"));
    assert.ok(keywords.includes("camelphat"));
    assert.ok(keywords.includes("printworks"));
    assert.equal(keywords.some((keyword) => keyword.includes("tickets")), false);
    const negatives = seeded.tree.plan_negatives.map((row) => row.keyword);
    assert.ok(negatives.includes("free"));
    assert.ok(negatives.includes("jobs"));
    assert.ok(negatives.includes("lyrics"));

    const pushed = planToGoogleDraft(plan);
    pushed.plan.status = "pushed";
    pushed.plan.pushed_at = "2026-10-02T00:00:00.000Z";
    const before = JSON.stringify(pushed.campaigns[0].ad_groups[0].rsas[0].headlines);
    const skipped = applyCopyToGoogleTree(pushed, {
      headlines: ["CamelPhat"],
      descriptions: [],
      keywords: [],
    });
    assert.equal(JSON.stringify(skipped.tree.campaigns[0].ad_groups[0].rsas[0].headlines), before);
    assert.match(skipped.note ?? "", /pushed/);
  });
});

describe("migration 194", () => {
  it("is idempotent and owner-only, and stores no unbounded page text", () => {
    const sql = readFileSync("supabase/migrations/194_mml_copy.sql", "utf8");
    assert.match(sql, /create table if not exists campaign_plan_copy/);
    assert.match(sql, /auth\.uid\(\) = user_id/);
    assert.match(sql, /char_length\(page_text\) <= 8000/);
    assert.match(sql, /enable row level security/);
    assert.match(sql, /if not exists/);
  });
});
