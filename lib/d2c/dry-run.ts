/**
 * lib/d2c/dry-run.ts
 *
 * Single source of truth for the D2C dry-run path. Every provider
 * delegates here when `FEATURE_D2C_LIVE` is off so the safety
 * invariant — *no live sends until the flag flips* — is checked in
 * one place.
 *
 * The route layer also forces `dry_run: true` on the persisted row
 * regardless, but having the safety here too means a caller bypassing
 * the route (e.g. a one-off script importing `provider.send`) still
 * can't send live mail.
 */

import type {
  D2CMessage,
  D2CProviderName,
  SendResult,
} from "./types.ts";

interface DryRunSummary {
  channel: D2CMessage["channel"];
  audienceKeys: string[];
  variableKeys: string[];
  bodyChars: number;
  subject: string | null;
}

function describeAudience(audience: Record<string, unknown>): string[] {
  return Object.keys(audience).sort();
}

export function performDryRun(
  provider: D2CProviderName,
  message: D2CMessage,
): SendResult {
  const summary: DryRunSummary = {
    channel: message.channel,
    audienceKeys: describeAudience(message.audience),
    variableKeys: Object.keys(message.variables).sort(),
    bodyChars: message.bodyMarkdown.length,
    subject: message.subject ?? null,
  };

  // Single, predictable log line per dry-run. Greppable in Vercel logs.
  console.warn(
    `[DRY RUN] d2c send via ${provider} channel=${summary.channel} ` +
      `audience=${JSON.stringify(summary.audienceKeys)} ` +
      `vars=${JSON.stringify(summary.variableKeys)} ` +
      `bodyChars=${summary.bodyChars}` +
      (summary.subject ? ` subject="${summary.subject}"` : ""),
  );

  return {
    ok: true,
    dryRun: true,
    providerJobId: null,
    details: { dryRun: true, summary },
  };
}
