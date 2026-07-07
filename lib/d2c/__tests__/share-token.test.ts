import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  base64UrlEncode,
  D2C_SHARE_TOKEN_LENGTH,
  generateD2CShareToken,
  isValidD2CShareToken,
} from "../share-token.ts";

describe("base64UrlEncode", () => {
  test("url-safe, no padding", () => {
    // 0xFB 0xFF encodes to base64 "+/8=" → url-safe "-_8"
    const out = base64UrlEncode(Buffer.from([0xfb, 0xff]));
    assert.equal(out.includes("+"), false);
    assert.equal(out.includes("/"), false);
    assert.equal(out.includes("="), false);
    assert.equal(out, "-_8");
  });
});

describe("generateD2CShareToken", () => {
  test("is exactly 32 url-safe chars", () => {
    const token = generateD2CShareToken();
    assert.equal(token.length, D2C_SHARE_TOKEN_LENGTH);
    assert.match(token, /^[A-Za-z0-9_-]{32}$/);
  });
  test("deterministic with injected bytes", () => {
    const bytes = (n: number) => Buffer.alloc(n, 0);
    const token = generateD2CShareToken(bytes);
    assert.equal(token, "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".slice(0, 32));
    assert.equal(token.length, 32);
  });
});

describe("isValidD2CShareToken", () => {
  test("accepts a generated token", () => {
    assert.equal(isValidD2CShareToken(generateD2CShareToken()), true);
  });
  test("rejects too-short / illegal chars", () => {
    assert.equal(isValidD2CShareToken("short"), false);
    assert.equal(isValidD2CShareToken("has spaces and slashes/"), false);
    assert.equal(isValidD2CShareToken("../etc/passwd"), false);
  });
});
