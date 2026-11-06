/**
 * drive-auth.ts
 *
 * Obtains a short-lived Google Drive access token via the service-account
 * JWT-bearer flow. Access tokens are cached in module scope (in-memory) with a
 * 5-minute safety margin on the TTL — mirrors dropbox-auth.ts exactly.
 *
 * Required env var (set in Vercel; never in .env.local):
 *   GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON — the full service-account JSON blob
 *     ({ client_email, private_key, … }). Treat as a secret — never log.
 *
 * We deliberately do NOT depend on googleapis / google-auth-library (package.json
 * is Ops-owned). The RS256 JWT is signed with Node's built-in crypto and
 * exchanged for an access token at Google's OAuth2 token endpoint.
 *
 * Token exchange:
 *   POST https://oauth2.googleapis.com/token
 *     grant_type = urn:ietf:params:oauth:grant-type:jwt-bearer
 *     assertion  = <signed JWT>
 *
 * In-memory cache is intentional: Vercel function instances are ephemeral and
 * short-lived, and the token mint is cheap. Cross-invocation caching would add
 * complexity with no material benefit.
 */

import { createSign } from "node:crypto";

import { DriveFetchError } from "./drive.ts";

// ─── In-memory token cache ────────────────────────────────────────────────────

interface CachedToken {
  accessToken: string;
  /** Expiry as ms since Unix epoch, already reduced by the 5-min safety margin */
  expiresAt: number;
}

let _cache: CachedToken | null = null;

const SAFETY_MARGIN_MS = 5 * 60 * 1000; // 5 minutes
const TOKEN_ENDPOINT   = "https://oauth2.googleapis.com/token";
const SCOPE            = "https://www.googleapis.com/auth/drive.readonly";
const JWT_BEARER_GRANT = "urn:ietf:params:oauth:grant-type:jwt-bearer";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

// ─── JWT signing (hand-rolled RS256) ────────────────────────────────────────────

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Builds and RS256-signs a Google service-account JWT assertion.
 *
 * Exported for testing: the fixture test verifies the header/claim shape and
 * that the signature verifies against the matching public key.
 *
 * @param sa   — service-account { client_email, private_key }
 * @param nowSeconds — issued-at time (Unix seconds); defaults to Date.now()
 * @returns the compact-serialized signed JWT (header.payload.signature)
 */
export function signServiceAccountJwt(
  sa: ServiceAccount,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: sa.client_email,
    scope: SCOPE,
    aud: sa.token_uri || TOKEN_ENDPOINT,
    iat: nowSeconds,
    exp: nowSeconds + 3600, // 1 hour — Google's max
  };

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;

  // private_key may arrive with literal "\n" escapes (env var round-tripping);
  // normalise to real newlines so the PEM parses.
  const pem = sa.private_key.replace(/\\n/g, "\n");

  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(pem);

  return `${signingInput}.${base64url(signature)}`;
}

// ─── Config loading ─────────────────────────────────────────────────────────────

/** Escape raw line breaks that sit inside JSON string literals (e.g. a PEM pasted with real newlines). */
function escapeNewlinesInStrings(input: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of input) {
    if (inString) {
      if (escaped) { escaped = false; out += ch; continue; }
      if (ch === "\\") { escaped = true; out += ch; continue; }
      if (ch === '"') { inString = false; out += ch; continue; }
      if (ch === "\n") { out += "\\n"; continue; }
      if (ch === "\r") { continue; }
      out += ch;
      continue;
    }
    if (ch === '"') inString = true;
    out += ch;
  }
  return out;
}

function tryParse(text: string): unknown {
  try {
    let value: unknown = JSON.parse(text);
    // Double-encoded: the whole object was pasted as a JSON string.
    if (typeof value === "string") value = JSON.parse(value);
    return value;
  } catch {
    return undefined;
  }
}

/**
 * Parses the env value, tolerating the common ways a key file gets mangled on
 * paste: surrounding whitespace / BOM, wrapping quotes or backticks, curly
 * quotes, a double-encoded string, real newlines inside the PEM, or base64 of
 * the whole file. Never echoes any part of the value.
 */
export function parseServiceAccountJson(raw: string): Partial<ServiceAccount> {
  const base = raw.replace(/^﻿/, "").trim();
  const candidates: string[] = [base];
  const unwrapped = base.replace(/^(['"`])([\s\S]*)\1$/, "$2").trim();
  if (unwrapped !== base) candidates.push(unwrapped);
  for (const c of [...candidates]) {
    const straight = c.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
    if (straight !== c) candidates.push(straight);
  }
  for (const c of [...candidates]) {
    const fixed = escapeNewlinesInStrings(c);
    if (fixed !== c) candidates.push(fixed);
  }
  if (/^[A-Za-z0-9+/=\s]+$/.test(base) && !base.includes("{")) {
    try {
      const decoded = Buffer.from(base.replace(/\s+/g, ""), "base64").toString("utf8").trim();
      if (decoded.startsWith("{")) candidates.push(decoded, escapeNewlinesInStrings(decoded));
    } catch { /* not base64 */ }
  }
  for (const c of candidates) {
    const value = tryParse(c);
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Partial<ServiceAccount>;
  }
  throw new DriveFetchError(
    "config_missing",
    `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON is not valid JSON — paste the full service-account key file. ${describeUnparseable(base)}`,
  );
}

/** Shape-only diagnosis: length, first/last character and where parsing stops. No key material. */
export function describeUnparseable(value: string): string {
  const first = value.charAt(0);
  const last = value.charAt(value.length - 1);
  const show = (c: string) => (c === "" ? "nothing" : /[{}\[\]"'`]/.test(c) ? `'${c}'` : c.trim() === "" ? "whitespace" : "a letter or digit");
  let where = "";
  try { JSON.parse(value); } catch (err) {
    const m = /position (\d+)/.exec(String((err as Error).message));
    if (m) where = ` Parsing stops at character ${m[1]} of ${value.length}.`;
  }
  return `The value is ${value.length} characters, starts with ${show(first)} and ends with ${show(last)}.${where}` +
    (first !== "{" ? " It should start with '{'." : "") + (last !== "}" ? " It should end with '}' — it may be cut off." : "");
}

/**
 * Parses GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON into a ServiceAccount.
 * @throws {DriveFetchError("config_missing")} when the env var is absent or malformed
 */
export function loadServiceAccount(): ServiceAccount {
  const raw = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON;
  if (!raw || !raw.trim()) {
    throw new DriveFetchError(
      "config_missing",
      "Google Drive service account not configured. Set GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON " +
        "(the full service-account JSON) in Vercel env.",
    );
  }

  const parsed = parseServiceAccountJson(raw);

  if (!parsed.client_email || !parsed.private_key) {
    throw new DriveFetchError(
      "config_missing",
      "GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON is missing client_email or private_key.",
    );
  }

  return {
    client_email: parsed.client_email,
    private_key: parsed.private_key,
    token_uri: parsed.token_uri,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns a fresh (or cached) Google Drive access token.
 *
 * Signs a service-account JWT and exchanges it via the jwt-bearer grant on
 * first call (or after TTL expiry). Subsequent calls within the TTL window
 * return the cached token without hitting the network.
 *
 * @throws {DriveFetchError("config_missing")} when the env var is absent/malformed
 * @throws {DriveFetchError("forbidden")}       when the assertion is rejected (400/401)
 * @throws {DriveFetchError("network")}          on network error or unexpected non-200 response
 */
export async function getDriveAccessToken(): Promise<string> {
  if (_cache && Date.now() < _cache.expiresAt) {
    return _cache.accessToken;
  }

  const sa = loadServiceAccount();
  const assertion = signServiceAccountJwt(sa);

  const body = new URLSearchParams({
    grant_type: JWT_BEARER_GRANT,
    assertion,
  });

  let res: Response;
  try {
    res = await fetch(sa.token_uri || TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch (err) {
    throw new DriveFetchError(
      "network",
      `Network error reaching Google token endpoint: ${(err as Error).message}`,
    );
  }

  if (res.status === 400 || res.status === 401) {
    throw new DriveFetchError(
      "forbidden",
      "Google rejected the service-account assertion — the key may have been revoked, the clock " +
        "may be skewed, or the Drive API may be disabled. Regenerate GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON " +
        "and confirm the Drive API is enabled for the project.",
    );
  }

  if (!res.ok) {
    let snippet = "";
    try { snippet = (await res.text()).slice(0, 200); } catch { /* ignore */ }
    console.error("[drive-auth] token endpoint returned unexpected status", {
      status: res.status,
      body: snippet,
    });
    throw new DriveFetchError("network", `Google token endpoint returned HTTP ${res.status}`);
  }

  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    throw new DriveFetchError("network", "Google token endpoint returned no access_token");
  }

  const expiresInMs = (data.expires_in ?? 3600) * 1000;
  _cache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + expiresInMs - SAFETY_MARGIN_MS,
  };

  console.log("[drive-auth] access token fetched", {
    expiresAt: new Date(_cache.expiresAt).toISOString(),
  });

  return _cache.accessToken;
}

/**
 * Clears the in-memory token cache. Exposed for testing only.
 */
export function _clearDriveTokenCache(): void {
  _cache = null;
}
