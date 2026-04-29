import "server-only";

import { GoogleAdsApi, type Customer } from "google-ads-api";

import {
  customerIdForGoogleAdsApi,
  GOOGLE_ADS_LOGIN_CUSTOMER_ID,
} from "./oauth";
import { classifyGoogleAdsRetry, parseGoogleAdsError } from "./retry";

/**
 * Google Ads reporting runs under its own tiny concurrency budget. Do not share
 * Meta/TikTok knobs here: each platform has independent rate-limit behaviour.
 */
export const GOOGLE_ADS_CHUNK_CONCURRENCY = 1;

const MAX_ATTEMPTS = 5;

export class GoogleAdsApiError extends Error {
  readonly code?: number | string;
  readonly status?: string;
  readonly httpStatus?: number;

  constructor(
    message: string,
    options: { code?: number | string; status?: string; httpStatus?: number } = {},
  ) {
    super(message);
    this.name = "GoogleAdsApiError";
    this.code = options.code;
    this.status = options.status;
    this.httpStatus = options.httpStatus;
  }
}

export interface GoogleAdsClientConfig {
  developerToken: string;
  clientId: string;
  clientSecret: string;
}

export interface GoogleAdsCustomerCredentials {
  customerId: string;
  refreshToken: string;
  loginCustomerId?: string | null;
}

type QueryRunner<T> = (gaql: string) => Promise<T>;

export class GoogleAdsClient {
  private readonly api: GoogleAdsApi;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    config = requireGoogleAdsClientConfig(),
    options: { sleep?: (ms: number) => Promise<void> } = {},
  ) {
    this.api = new GoogleAdsApi({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      developer_token: config.developerToken,
    });
    this.sleep = options.sleep ?? sleep;
  }

  async listAccessibleCustomers(refreshToken: string): Promise<string[]> {
    const res = await this.executeWithRetry(
      () => this.api.listAccessibleCustomers(refreshToken),
      "customers:listAccessibleCustomers",
    );
    return (res.resource_names ?? []).map((name) => name.replace(/^customers\//, ""));
  }

  async query<T>(
    credentials: GoogleAdsCustomerCredentials,
    gaql: string,
  ): Promise<T> {
    const customer = this.customer(credentials);
    return this.executeQueryWithRetry<T>((query) => customer.query<T>(query), gaql);
  }

  private customer(credentials: GoogleAdsCustomerCredentials): Customer {
    return this.api.Customer({
      customer_id: customerIdForGoogleAdsApi(credentials.customerId),
      refresh_token: credentials.refreshToken,
      login_customer_id: customerIdForGoogleAdsApi(
        credentials.loginCustomerId ?? GOOGLE_ADS_LOGIN_CUSTOMER_ID,
      ),
    });
  }

  private async executeQueryWithRetry<T>(
    runner: QueryRunner<T>,
    gaql: string,
  ): Promise<T> {
    return this.executeWithRetry(() => runner(gaql), "GoogleAdsService.Search");
  }

  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    label: string,
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      try {
        return await operation();
      } catch (err) {
        lastError = err;
        const decision = classifyGoogleAdsRetry({ error: err, attempt });
        if (!decision.retry) throw toGoogleAdsApiError(err);
        console.warn(
          `[googleAds] retry ${attempt + 1}/${MAX_ATTEMPTS - 1} after ${decision.delayMs}ms: ${label} (reason: ${decision.kind})`,
        );
        await this.sleep(decision.delayMs);
      }
    }
    throw toGoogleAdsApiError(lastError);
  }
}

export function requireGoogleAdsClientConfig(): GoogleAdsClientConfig {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  if (!developerToken) throw new Error("GOOGLE_ADS_DEVELOPER_TOKEN is not configured.");
  if (!clientId) throw new Error("GOOGLE_ADS_CLIENT_ID is not configured.");
  if (!clientSecret) throw new Error("GOOGLE_ADS_CLIENT_SECRET is not configured.");
  return { developerToken, clientId, clientSecret };
}

function toGoogleAdsApiError(error: unknown): GoogleAdsApiError {
  if (error instanceof GoogleAdsApiError) return error;
  const parsed = parseGoogleAdsError(error);
  return new GoogleAdsApiError(parsed.message, {
    code: parsed.code,
    status: parsed.status,
    httpStatus: parsed.httpStatus,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
