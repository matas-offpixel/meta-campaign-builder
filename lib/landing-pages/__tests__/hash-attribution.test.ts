import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  captureAttribution,
  persistAttribution,
  readAttribution,
  type StringStorage,
} from "../attribution.ts";
import { hashEmail, hashIp, hashPhone, ipFromForwardedFor } from "../hash.ts";

const SALT = "test-salt-123456";

describe("hash helpers", () => {
  it("is deterministic and hex-shaped", () => {
    const a = hashEmail("amelia@example.com", SALT);
    assert.equal(a, hashEmail("amelia@example.com", SALT));
    assert.match(a, /^[0-9a-f]{64}$/);
  });

  it("salt changes the output (hashes are useless without the salt)", () => {
    assert.notEqual(
      hashEmail("amelia@example.com", SALT),
      hashEmail("amelia@example.com", "another-salt-99"),
    );
  });

  it("namespaces by kind — same input never collides across email/phone/ip", () => {
    const input = "+447911123456";
    const values = [hashEmail(input, SALT), hashPhone(input, SALT), hashIp(input, SALT)];
    assert.equal(new Set(values).size, 3);
  });

  it("throws loudly on a missing/short salt (never silently weak-hash PII)", () => {
    assert.throws(() => hashEmail("a@b.co", ""));
    assert.throws(() => hashPhone("+44", "short"));
  });

  it("ipFromForwardedFor takes the first hop", () => {
    assert.equal(ipFromForwardedFor("203.0.113.7, 10.0.0.1"), "203.0.113.7");
    assert.equal(ipFromForwardedFor(null), null);
    assert.equal(ipFromForwardedFor("  "), null);
  });
});

function makeStorage(): StringStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

describe("attribution capture", () => {
  it("captures allowlisted params and referrer, drops the rest", () => {
    const captured = captureAttribution(
      "?utm_source=instagram&utm_campaign=wc26&fbclid=abc&evil=1",
      "https://l.instagram.com/",
    );
    assert.deepEqual(captured.utm, {
      utm_source: "instagram",
      utm_campaign: "wc26",
      fbclid: "abc",
    });
    assert.equal(captured.referrer_url, "https://l.instagram.com/");
  });

  it("first-touch wins: a later empty capture never clobbers stored attribution", () => {
    const storage = makeStorage();
    const first = persistAttribution(
      storage,
      captureAttribution("?utm_source=tiktok", "https://tiktok.com"),
    );
    assert.equal(first.utm.utm_source, "tiktok");

    const second = persistAttribution(storage, captureAttribution("", ""));
    assert.equal(second.utm.utm_source, "tiktok");
    assert.equal(readAttribution(storage)?.utm.utm_source, "tiktok");
  });

  it("survives corrupt storage payloads", () => {
    const storage = makeStorage();
    storage.data.set("lp_attribution_v1", "{not json");
    assert.equal(readAttribution(storage), null);
    const captured = persistAttribution(
      storage,
      captureAttribution("?utm_source=meta", null),
    );
    assert.equal(captured.utm.utm_source, "meta");
  });
});
