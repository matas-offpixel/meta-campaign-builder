import { OAuth2Client } from "google-auth-library";

import {
  customerIdForGoogleAdsApi,
  GOOGLE_ADS_LOGIN_CUSTOMER_ID,
} from "./oauth.ts";
import { classifyGoogleAdsRetry, parseGoogleAdsError } from "./retry.ts";
export { GOOGLE_ADS_CHUNK_CONCURRENCY } from "./constants.ts";

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
type GoogleAdsFetch = typeof fetch;
type GoogleAdsAuthClient = {
  setCredentials(credentials: { refresh_token: string }): void;
  getAccessToken(): Promise<{ token?: string | null }>;
};
type GoogleAdsAuthFactory = () => GoogleAdsAuthClient;

interface GoogleAdsRestListAccessibleCustomersResponse {
  resourceNames?: string[];
  resource_names?: string[];
}

interface GoogleAdsRestSearchResponse {
  results?: unknown[];
}

export class GoogleAdsClient {
  private readonly config: GoogleAdsClientConfig;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly fetcher: GoogleAdsFetch;
  private readonly authFactory: GoogleAdsAuthFactory;

  constructor(
    config = requireGoogleAdsClientConfig(),
    options: {
      sleep?: (ms: number) => Promise<void>;
      fetcher?: GoogleAdsFetch;
      authFactory?: GoogleAdsAuthFactory;
    } = {},
  ) {
    this.config = config;
    this.sleep = options.sleep ?? sleep;
    this.fetcher = options.fetcher ?? fetch;
    this.authFactory = options.authFactory ?? (() => new OAuth2Client({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    }));
  }

  async listAccessibleCustomers(refreshToken: string): Promise<string[]> {
    const res = await this.executeWithRetry(
      () => this.request<GoogleAdsRestListAccessibleCustomersResponse>({
        refreshToken,
        path: "/customers:listAccessibleCustomers",
        method: "GET",
      }),
      "customers:listAccessibleCustomers",
    );
    return (res.resourceNames ?? res.resource_names ?? [])
      .map((name) => name.replace(/^customers\//, ""));
  }

  async query<T>(
    credentials: GoogleAdsCustomerCredentials,
    gaql: string,
  ): Promise<T> {
    const customerId = customerIdForGoogleAdsApi(credentials.customerId);
    return this.executeQueryWithRetry<T>(
      async (query) => {
        const res = await this.request<GoogleAdsRestSearchResponse>({
          refreshToken: credentials.refreshToken,
          path: `/customers/${customerId}/googleAds:search`,
          method: "POST",
          loginCustomerId: credentials.loginCustomerId,
          body: { query },
        });
        return normalizeGoogleAdsRestRowKeys(res.results ?? []) as T;
      },
      gaql,
    );
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
        const details = googleAdsInvalidArgumentDetails(err);
        if (details) {
          console.error(
            "[googleAds] INVALID_ARGUMENT details:",
            JSON.stringify(details, null, 2),
          );
        }
        console.error("[googleAds] request failed", {
          label,
          attempt,
          errorName: errorConstructorName(err),
          errorKeys: err && typeof err === "object" ? Object.keys(err) : [],
          error: safeStringify(err),
        });
        if (!decision.retry) throw toGoogleAdsApiError(err);
        console.warn(
          `[googleAds] retry ${attempt + 1}/${MAX_ATTEMPTS - 1} after ${decision.delayMs}ms: ${label} (reason: ${decision.kind})`,
        );
        await this.sleep(decision.delayMs);
      }
    }
    throw toGoogleAdsApiError(lastError);
  }

  private async request<T>(input: {
    refreshToken: string;
    path: string;
    method: "GET" | "POST";
    loginCustomerId?: string | null;
    body?: Record<string, unknown>;
  }): Promise<T> {
    const auth = this.authFactory();
    auth.setCredentials({ refresh_token: input.refreshToken });
    const accessToken = await auth.getAccessToken();
    const token = accessToken.token;
    if (!token) throw new Error("Google OAuth refresh token did not return an access token.");

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "developer-token": this.config.developerToken,
    };
    const loginCustomerId = customerIdForGoogleAdsApi(
      input.loginCustomerId ?? GOOGLE_ADS_LOGIN_CUSTOMER_ID,
    );
    if (loginCustomerId) headers["login-customer-id"] = loginCustomerId;
    if (input.method === "POST") headers["Content-Type"] = "application/json";

    const response = await this.fetcher(`https://googleads.googleapis.com/v23${input.path}`, {
      method: input.method,
      headers,
      body: input.body ? JSON.stringify(input.body) : undefined,
      cache: "no-store",
    });
    const json = await response.json().catch(async () => ({
      error: { message: await response.text() },
    }));
    if (!response.ok) {
      throw { response: { status: response.status, data: json } };
    }
    return json as T;
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

function normalizeGoogleAdsRestRowKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeGoogleAdsRestRowKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      camelToSnake(key),
      normalizeGoogleAdsRestRowKeys(entry),
    ]),
  );
}

function camelToSnake(value: string): string {
  return value.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`);
}

function errorConstructorName(error: unknown): string {
  if (!error || typeof error !== "object") return typeof error;
  return error.constructor?.name ?? "unknown";
}

function googleAdsInvalidArgumentDetails(error: unknown): unknown[] | null {
  const response = (error as { response?: { data?: { error?: { status?: string; details?: unknown } } } } | null)?.response;
  if (response?.data?.error?.status !== "INVALID_ARGUMENT") return null;
  return Array.isArray(response.data.error.details) ? response.data.error.details : [];
}

function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(value, (_key, next) => {
      if (typeof next === "object" && next !== null) {
        if (seen.has(next)) return "[Circular]";
        seen.add(next);
      }
      return next;
    }) ?? String(value);
  } catch {
    return String(value);
  }
}
