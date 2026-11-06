/**
 * GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON paste tolerance.
 *
 * The production value failed JSON.parse on 6 Nov 2026 after a manual paste
 * into Vercel. loadServiceAccount now accepts the usual paste mangles and,
 * when it still cannot parse, says what shape the value has without echoing
 * any of it.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { DriveFetchError } from "../drive.ts";
import { describeUnparseable, loadServiceAccount, parseServiceAccountJson } from "../drive-auth.ts";

const KEY = {
  type: "service_account",
  project_id: "off-pixel-dashboard",
  client_email: "reader@off-pixel-dashboard.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\nSECRETLINE1\nSECRETLINE2\n-----END PRIVATE KEY-----\n",
  token_uri: "https://oauth2.googleapis.com/token",
};
const FILE = JSON.stringify(KEY, null, 2);

function ok(value: string) {
  const parsed = parseServiceAccountJson(value);
  assert.equal(parsed.client_email, KEY.client_email);
  assert.ok(String(parsed.private_key).includes("BEGIN PRIVATE KEY"));
}

describe("parseServiceAccountJson", () => {
  it("accepts the key file as downloaded", () => ok(FILE));
  it("accepts surrounding whitespace and a BOM", () => ok(`﻿  ${FILE}\n\n`));
  it("accepts wrapping double quotes", () => ok(`"${FILE}"`));
  it("accepts wrapping single quotes and backticks", () => {
    ok(`'${FILE}'`);
    ok(`\`${FILE}\``);
  });
  it("accepts a double-encoded JSON string", () => ok(JSON.stringify(FILE)));
  it("accepts real line breaks inside the private key", () => ok(FILE.replace(/\\n/g, "\n")));
  it("accepts Windows line breaks inside the private key", () => ok(FILE.replace(/\\n/g, "\r\n")));
  it("accepts curly quotes", () => ok(FILE.replace(/"/g, (_m, i: number) => (i % 2 ? "“" : "”"))));
  it("accepts base64 of the whole file", () => ok(Buffer.from(FILE).toString("base64")));
});

describe("loadServiceAccount errors", () => {
  const saved = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON;
  afterEach(() => {
    if (saved === undefined) delete process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON;
    else process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON = saved;
  });

  it("reads a pasted value with real line breaks", () => {
    process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON = FILE.replace(/\\n/g, "\n");
    assert.equal(loadServiceAccount().client_email, KEY.client_email);
  });

  it("a cut-off value says so and never echoes key material", () => {
    process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON = FILE.slice(0, 120);
    assert.throws(
      () => loadServiceAccount(),
      (err: unknown) => {
        assert.ok(err instanceof DriveFetchError);
        assert.equal(err.code, "config_missing");
        assert.match(err.message, /not valid JSON/);
        assert.match(err.message, /120 characters/);
        assert.match(err.message, /cut off/);
        assert.doesNotMatch(err.message, /SECRETLINE|PRIVATE KEY|reader@/);
        return true;
      },
    );
  });

  it("a blank value is reported as not configured", () => {
    process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON = "   ";
    assert.throws(() => loadServiceAccount(), (err: unknown) => err instanceof DriveFetchError && /not configured/.test(err.message));
  });

  it("describeUnparseable reports shape only", () => {
    const text = describeUnparseable("client_email=x");
    assert.match(text, /14 characters/);
    assert.match(text, /should start with '\{'/);
    assert.doesNotMatch(text, /client_email/);
  });
});
