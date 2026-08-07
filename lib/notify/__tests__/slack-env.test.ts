import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isMasterKillswitchOnFromEnv,
  isChannelEnabledFromEnv,
  getWebhookUrlFromEnv,
} from "../slack.ts";

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const prev: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) prev[key] = process.env[key];
  try {
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fn();
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("master killswitch defaults off when unset", () => {
  withEnv({ ENABLE_SLACK_NOTIFICATIONS: undefined }, () => {
    assert.equal(isMasterKillswitchOnFromEnv(), false);
  });
});

test("master killswitch is on only when exactly \"1\"", () => {
  withEnv({ ENABLE_SLACK_NOTIFICATIONS: "true" }, () => {
    assert.equal(isMasterKillswitchOnFromEnv(), false);
  });
  withEnv({ ENABLE_SLACK_NOTIFICATIONS: "1" }, () => {
    assert.equal(isMasterKillswitchOnFromEnv(), true);
  });
});

test("per-channel enabled defaults to true when unset", () => {
  withEnv({ SLACK_CHANNEL_ADS_OPS_ENABLED: undefined }, () => {
    assert.equal(isChannelEnabledFromEnv("ads_ops"), true);
  });
});

test("per-channel enabled is false when explicitly \"0\" or \"false\"", () => {
  withEnv({ SLACK_CHANNEL_ADS_OPS_ENABLED: "0" }, () => {
    assert.equal(isChannelEnabledFromEnv("ads_ops"), false);
  });
  withEnv({ SLACK_CHANNEL_ADS_URGENT_ENABLED: "false" }, () => {
    assert.equal(isChannelEnabledFromEnv("ads_urgent"), false);
  });
});

test("webhook url reads the right env var per channel", () => {
  withEnv(
    {
      SLACK_WEBHOOK_ADS_OPS: "https://example.test/ops",
      SLACK_WEBHOOK_ADS_URGENT: undefined,
    },
    () => {
      assert.equal(getWebhookUrlFromEnv("ads_ops"), "https://example.test/ops");
      assert.equal(getWebhookUrlFromEnv("ads_urgent"), undefined);
    },
  );
});
