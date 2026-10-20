import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { BannerbearProvider, buildBannerbearModifications } from "../provider.ts";
import { CreativeProviderDisabledError, type CreativeTemplate } from "../../types.ts";

const baseTemplate = (): CreativeTemplate => ({
  id: "7c9e0000-0000-4000-8000-000000000001",
  user_id: "u1",
  name: "Fan park",
  provider: "bannerbear",
  external_template_id: "bb-template-uid",
  fields_jsonb: [
    { key: "headline", label: "Headline", type: "text", required: true },
    { key: "bg_image", label: "Background", type: "image", required: true },
  ],
  channel: "feed",
  aspect_ratios: ["1:1"],
  notes: null,
  created_at: "2020-01-01T00:00:00.000Z",
  updated_at: "2020-01-01T00:00:00.000Z",
});

let origFetch: typeof globalThis.fetch;
let origKey: string | undefined;
let origFeature: string | undefined;

beforeEach(() => {
  origFetch = globalThis.fetch;
  origKey = process.env.BANNERBEAR_API_KEY;
  origFeature = process.env.FEATURE_BANNERBEAR;
});

afterEach(() => {
  globalThis.fetch = origFetch;
  if (origKey === undefined) delete process.env.BANNERBEAR_API_KEY;
  else process.env.BANNERBEAR_API_KEY = origKey;
  if (origFeature === undefined) delete process.env.FEATURE_BANNERBEAR;
  else process.env.FEATURE_BANNERBEAR = origFeature;
});

test("constructor: missing BANNERBEAR_API_KEY throws CreativeProviderDisabledError", () => {
  delete process.env.BANNERBEAR_API_KEY;
  process.env.BANNERBEAR_API_KEY = "";
  assert.throws(
    () => {
      new BannerbearProvider();
    },
    (e) => e instanceof CreativeProviderDisabledError,
  );
});

test("buildBannerbearModifications maps text and image fields", () => {
  const t = baseTemplate();
  const m = buildBannerbearModifications(t, {
    headline: "Line up",
    bg_image: "https://cdn.test/bg.png",
  });
  assert.deepEqual(m, [
    { name: "headline", text: "Line up" },
    { name: "bg_image", image_url: "https://cdn.test/bg.png" },
  ]);
});

test("render() sends modifications in POST body (mock fetch)", async () => {
  process.env.BANNERBEAR_API_KEY = "bb_test_key";
  process.env.FEATURE_BANNERBEAR = "true";

  let postBody: unknown;
  globalThis.fetch = (async (url, init) => {
    if (String(url).endsWith("/v2/images") && init && (init as RequestInit).method === "POST") {
      postBody = JSON.parse(String((init as RequestInit).body));
      return new Response(JSON.stringify({ uid: "image-job-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("not used", { status: 500 });
  }) as typeof fetch;

  const p = new BannerbearProvider();
  const r = await p.render(baseTemplate(), {
    headline: "A",
    bg_image: "https://x/y.jpg",
  });
  assert.equal(r.jobId, "image-job-1");
  assert.equal(r.status, "rendering");
  assert.equal((postBody as { template: string }).template, "bb-template-uid");
  assert.equal((postBody as { webhook_url: unknown }).webhook_url, null);
  const mod = (postBody as { modifications: unknown[] }).modifications;
  assert.deepEqual(mod, [
    { name: "headline", text: "A" },
    { name: "bg_image", image_url: "https://x/y.jpg" },
  ]);
});

test("pollRender: pending → rendering", async () => {
  process.env.BANNERBEAR_API_KEY = "bb_test_key";
  process.env.FEATURE_BANNERBEAR = "true";
  globalThis.fetch = (async (url) => {
    if (String(url).includes("/v2/images/poll-1")) {
      return new Response(
        JSON.stringify({ status: "pending", image_url_png: null }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response("nope", { status: 500 });
  }) as typeof fetch;

  const p = new BannerbearProvider();
  const j = await p.pollRender("poll-1");
  assert.equal(j.status, "rendering");
  assert.equal(j.assetUrl, null);
});

test("pollRender: completed → done with image_url_png", async () => {
  process.env.BANNERBEAR_API_KEY = "bb_test_key";
  process.env.FEATURE_BANNERBEAR = "true";
  globalThis.fetch = (async (url) => {
    if (String(url).includes("/v2/images/poll-2")) {
      return new Response(
        JSON.stringify({
          status: "completed",
          image_url_png: "https://cdn.bb/out.png",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response("nope", { status: 500 });
  }) as typeof fetch;

  const p = new BannerbearProvider();
  const j = await p.pollRender("poll-2");
  assert.equal(j.status, "done");
  assert.equal(j.assetUrl, "https://cdn.bb/out.png");
});

test("pollRender: failed → failed with error", async () => {
  process.env.BANNERBEAR_API_KEY = "bb_test_key";
  process.env.FEATURE_BANNERBEAR = "true";
  globalThis.fetch = (async (url) => {
    if (String(url).includes("/v2/images/poll-3")) {
      return new Response(
        JSON.stringify({
          status: "failed",
          error_message: "bad layer",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response("nope", { status: 500 });
  }) as typeof fetch;

  const p = new BannerbearProvider();
  const j = await p.pollRender("poll-3");
  assert.equal(j.status, "failed");
  assert.equal(j.errorMessage, "bad layer");
});
