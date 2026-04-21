/**
 * lib/d2c/klaviyo/provider.ts
 *
 * Klaviyo adapter — STUB behind `FEATURE_D2C_LIVE`. Same structure as
 * the Mailchimp stub. Expected credential shape: `{ api_key: string }`
 * (Klaviyo uses a private API key with `pk_*` prefix).
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
  "Klaviyo live sends are gated behind FEATURE_D2C_LIVE — pending OAuth approval.";

export class KlaviyoProvider implements D2CProvider {
  readonly name = "klaviyo" as const;

  async validateCredentials(
    credentials: Record<string, unknown>,
  ): Promise<ValidateD2CCredentialsResult> {
    if (!isD2CLiveEnabled()) {
      return { ok: false, error: DISABLED };
    }
    void credentials;
    throw new NotYetImplementedError(
      "Klaviyo validateCredentials not implemented yet — see Task H follow-up.",
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
      "Klaviyo send not implemented yet — see Task H follow-up.",
    );
  }
}

export const klaviyoProvider = new KlaviyoProvider();
