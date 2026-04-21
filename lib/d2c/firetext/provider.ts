/**
 * lib/d2c/firetext/provider.ts
 *
 * Firetext SMS adapter — STUB behind `FEATURE_D2C_LIVE`. UK SMS
 * provider. Expected credentials: `{ api_key: string, sender: string }`
 * (sender = the alphanumeric sender id agreed with Firetext).
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
  "Firetext live sends are gated behind FEATURE_D2C_LIVE — pending sender id confirmation.";

export class FiretextProvider implements D2CProvider {
  readonly name = "firetext" as const;

  async validateCredentials(
    credentials: Record<string, unknown>,
  ): Promise<ValidateD2CCredentialsResult> {
    if (!isD2CLiveEnabled()) {
      return { ok: false, error: DISABLED };
    }
    void credentials;
    throw new NotYetImplementedError(
      "Firetext validateCredentials not implemented yet — see Task H follow-up.",
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
      "Firetext send not implemented yet — see Task H follow-up.",
    );
  }
}

export const firetextProvider = new FiretextProvider();
