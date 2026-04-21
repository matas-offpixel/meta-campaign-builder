/**
 * lib/d2c/bird/provider.ts
 *
 * Bird.com adapter — STUB behind `FEATURE_D2C_LIVE`. Bird is the SMS
 * + WhatsApp Cloud API provider. Expected credentials:
 * `{ api_key: string, channel_id: string }` (workspace API key + the
 * channel id of the SMS or WhatsApp connector).
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
  "Bird live sends are gated behind FEATURE_D2C_LIVE — pending WhatsApp Cloud API approval.";

export class BirdProvider implements D2CProvider {
  readonly name = "bird" as const;

  async validateCredentials(
    credentials: Record<string, unknown>,
  ): Promise<ValidateD2CCredentialsResult> {
    if (!isD2CLiveEnabled()) {
      return { ok: false, error: DISABLED };
    }
    void credentials;
    throw new NotYetImplementedError(
      "Bird validateCredentials not implemented yet — see Task H follow-up.",
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
      "Bird send not implemented yet — see Task H follow-up.",
    );
  }
}

export const birdProvider = new BirdProvider();
