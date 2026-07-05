import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildBirdCredentials,
  buildMailchimpCredentials,
  parseBirdConnectionForm,
  parseMailchimpConnectionForm,
  toPublicConfig,
} from "../crm-schema.ts";

const WS = "7f3e9c2a-1111-4222-8333-444455556666";
const CH = "b41d6a58-aaaa-4bbb-8ccc-ddddeeeeffff";
const TP = "c92f0d11-2222-4333-8444-555566667777";
const KEY = "birdAccessKey_0123456789abcdefghijklmnop";

describe("parseBirdConnectionForm", () => {
  it("accepts a full valid form", () => {
    const r = parseBirdConnectionForm(
      {
        workspace_id: ` ${WS} `,
        channel_id: CH,
        api_key: KEY,
        template_project_id: TP,
        template_version_id: "LATEST",
      },
      { apiKeyConfigured: false },
    );
    assert.ok(r.ok);
    assert.deepEqual(r.value, {
      workspaceId: WS,
      channelId: CH,
      apiKey: KEY,
      templateProjectId: TP,
      templateVersionId: "latest",
    });
  });

  it("rejects non-uuid workspace/channel ids", () => {
    const r = parseBirdConnectionForm(
      {
        workspace_id: "my-workspace",
        channel_id: "whatsapp",
        api_key: KEY,
        template_project_id: "",
        template_version_id: "",
      },
      { apiKeyConfigured: false },
    );
    assert.ok(!r.ok);
    assert.ok(r.errors.workspace_id);
    assert.ok(r.errors.channel_id);
  });

  it("blank key keeps when configured, errors when not", () => {
    const base = {
      workspace_id: WS,
      channel_id: CH,
      api_key: "",
      template_project_id: "",
      template_version_id: "",
    };
    const keep = parseBirdConnectionForm(base, { apiKeyConfigured: true });
    assert.ok(keep.ok);
    assert.equal(keep.value.apiKey, null);

    const missing = parseBirdConnectionForm(base, { apiKeyConfigured: false });
    assert.ok(!missing.ok);
    assert.ok(missing.errors.api_key);
  });

  it("rejects a truncated key and a version without a project", () => {
    const short = parseBirdConnectionForm(
      {
        workspace_id: WS,
        channel_id: CH,
        api_key: "abc123",
        template_project_id: "",
        template_version_id: "",
      },
      { apiKeyConfigured: false },
    );
    assert.ok(!short.ok);
    assert.match(short.errors.api_key, /too short/);

    const orphanVersion = parseBirdConnectionForm(
      {
        workspace_id: WS,
        channel_id: CH,
        api_key: KEY,
        template_project_id: "",
        template_version_id: "latest",
      },
      { apiKeyConfigured: false },
    );
    assert.ok(!orphanVersion.ok);
    assert.ok(orphanVersion.errors.template_project_id);
  });
});

describe("buildBirdCredentials", () => {
  it("builds the exact provider-compatible blob", () => {
    const parsed = parseBirdConnectionForm(
      {
        workspace_id: WS,
        channel_id: CH,
        api_key: KEY,
        template_project_id: TP,
        template_version_id: "latest",
      },
      { apiKeyConfigured: false },
    );
    assert.ok(parsed.ok);
    // Byte-shape pin: these keys are what lib/d2c/bird/provider.ts reads.
    assert.deepEqual(buildBirdCredentials(null, parsed.value), {
      ok: true,
      blob: {
        api_key: KEY,
        workspace_id: WS,
        channel_id: CH,
        template_project_id: TP,
        template_version_id: "latest",
      },
    });
  });

  it("carries the existing key forward on keep, errors with none", () => {
    const parsed = parseBirdConnectionForm(
      {
        workspace_id: WS,
        channel_id: CH,
        api_key: "",
        template_project_id: "",
        template_version_id: "",
      },
      { apiKeyConfigured: true },
    );
    assert.ok(parsed.ok);
    assert.deepEqual(
      buildBirdCredentials({ api_key: KEY, extra: "dropped" }, parsed.value),
      { ok: true, blob: { api_key: KEY, workspace_id: WS, channel_id: CH } },
    );
    assert.deepEqual(buildBirdCredentials(null, parsed.value), {
      ok: false,
      error: "No API key available — paste one.",
    });
  });
});

describe("parseMailchimpConnectionForm", () => {
  it("derives the server prefix from the key suffix", () => {
    const r = parseMailchimpConnectionForm(
      { api_key: "notarealkeynotarealkey-US14", audience_id: "a1b2c3d4e5" },
      { apiKeyConfigured: false },
    );
    assert.ok(r.ok);
    assert.deepEqual(r.value, {
      apiKey: "notarealkeynotarealkey-US14",
      serverPrefix: "us14",
      audienceId: "a1b2c3d4e5",
    });
  });

  it("rejects keys without a datacenter suffix", () => {
    const r = parseMailchimpConnectionForm(
      { api_key: "notarealkeynotarealkey", audience_id: "" },
      { apiKeyConfigured: false },
    );
    assert.ok(!r.ok);
    assert.match(r.errors.api_key, /datacenter suffix/);
  });

  it("blank key keeps when configured; bad audience id rejected", () => {
    const keep = parseMailchimpConnectionForm(
      { api_key: "", audience_id: "" },
      { apiKeyConfigured: true },
    );
    assert.ok(keep.ok);
    assert.deepEqual(keep.value, {
      apiKey: null,
      serverPrefix: null,
      audienceId: null,
    });

    const bad = parseMailchimpConnectionForm(
      { api_key: "", audience_id: "not a list id!!" },
      { apiKeyConfigured: true },
    );
    assert.ok(!bad.ok);
    assert.ok(bad.errors.audience_id);
  });
});

describe("buildMailchimpCredentials", () => {
  it("builds the provider-compatible blob and keeps prefix with kept key", () => {
    const set = parseMailchimpConnectionForm(
      { api_key: "notarealkeynotarealkey-us14", audience_id: "" },
      { apiKeyConfigured: false },
    );
    assert.ok(set.ok);
    assert.deepEqual(buildMailchimpCredentials(null, set.value), {
      ok: true,
      blob: {
        api_key: "notarealkeynotarealkey-us14",
        server_prefix: "us14",
      },
    });

    const keep = parseMailchimpConnectionForm(
      { api_key: "", audience_id: "a1b2c3d4e5" },
      { apiKeyConfigured: true },
    );
    assert.ok(keep.ok);
    assert.deepEqual(
      buildMailchimpCredentials(
        { api_key: "old-key-1234567890-us7", server_prefix: "us7" },
        keep.value,
      ),
      {
        ok: true,
        blob: {
          api_key: "old-key-1234567890-us7",
          server_prefix: "us7",
          audience_id: "a1b2c3d4e5",
        },
      },
    );
  });
});

describe("toPublicConfig", () => {
  it("reduces the api key to a boolean and passes non-secrets through", () => {
    assert.deepEqual(
      toPublicConfig({
        api_key: KEY,
        workspace_id: WS,
        channel_id: CH,
        server_prefix: "us14",
        audience_id: "a1b2c3d4e5",
      }),
      {
        apiKeyConfigured: true,
        workspaceId: WS,
        channelId: CH,
        templateProjectId: null,
        templateVersionId: null,
        serverPrefix: "us14",
        audienceId: "a1b2c3d4e5",
      },
    );
    assert.equal(toPublicConfig(null).apiKeyConfigured, false);
  });
});
