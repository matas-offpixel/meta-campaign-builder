/**
 * lib/d2c/mailchimp/provider.ts
 *
 * Mailchimp adapter — STUB. Both `validateCredentials` and `send` are
 * gated behind `FEATURE_D2C_LIVE`. With the flag off, `send` returns
 * a dry-run result via the shared helper; `validateCredentials`
 * returns an explicit `live mode disabled` error so the connections
 * UI surfaces the gate clearly instead of silently storing
 * unverified credentials.
 *
 * Real implementation lands when Mailchimp OAuth approval clears.
 * Expected credential shape: `{ api_key: string, server_prefix: string }`.
 */

import { performDryRun } from "@/lib/d2c/dry-run";
import {
  isD2CLiveEnabled,
  NotYetImplementedError,
  type D2CConnection,
  type D2CMessage,
  type D2CProvider,
  type SendResult,
  type ValidateD2CCredentialsResult,
} from "@/lib/d2c/types";

const DISABLED =
  "Mailchimp live sends are gated behind FEATURE_D2C_LIVE — pending OAuth approval.";

export class MailchimpProvider implements D2CProvider {
  readonly name = "mailchimp" as const;

  async validateCredentials(
    credentials: Record<string, unknown>,
  ): Promise<ValidateD2CCredentialsResult> {
    if (!isD2CLiveEnabled()) {
      return { ok: false, error: DISABLED };
    }
    void credentials;
    throw new NotYetImplementedError(
      "Mailchimp validateCredentials not implemented yet — see Task H follow-up.",
    );
  }

  async send(
    connection: D2CConnection,
    message: D2CMessage,
  ): Promise<SendResult> {
    if (!isD2CLiveEnabled()) {
      return performDryRun(this.name, message);
    }
    void connection;
    throw new NotYetImplementedError(
      "Mailchimp send not implemented yet — see Task H follow-up.",
    );
  }
}

export const mailchimpProvider = new MailchimpProvider();
