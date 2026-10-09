/**
 * Fetch the event page for Suggest. http and https only. DNS is resolved
 * before the request and again after every redirect; a private, loopback
 * or link-local address is refused. At most 3 redirects, 8s, 2MB, and
 * text/html only.
 */

import { lookup } from "node:dns/promises";

export const COPY_FETCH_TIMEOUT_MS = 8000;
export const COPY_FETCH_MAX_BYTES = 2 * 1024 * 1024;
export const COPY_FETCH_MAX_REDIRECTS = 3;

export type DnsLookup = (hostname: string) => Promise<string[]>;

export function isBlockedIp(address: string): boolean {
  let value = address.trim().toLowerCase().replace(/^\[|\]$/g, "");
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
  if (mapped) value = mapped[1];
  if (value.includes(":")) {
    if (value === "::" || value === "::1") return true;
    const head = value.split(":")[0] ?? "";
    const n = Number.parseInt(head || "0", 16);
    if (!Number.isFinite(n)) return true;
    if (n >= 0xfe80 && n <= 0xfebf) return true;
    if (n >= 0xfc00 && n <= 0xfdff) return true;
    return false;
  }
  const parts = value.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

export async function publicAddresses(hostname: string, resolve: DnsLookup = defaultLookup): Promise<string[]> {
  let addresses: string[];
  try {
    addresses = await resolve(hostname);
  } catch {
    throw new Error(`Could not resolve ${hostname}`);
  }
  if (addresses.length === 0) throw new Error(`Could not resolve ${hostname}`);
  for (const address of addresses) {
    if (isBlockedIp(address)) throw new Error(`${hostname} resolves to a private address`);
  }
  return addresses;
}

async function defaultLookup(hostname: string): Promise<string[]> {
  const rows = await lookup(hostname, { all: true, verbatim: true });
  return rows.map((row) => row.address);
}

export interface FetchedPage {
  ok: true;
  url: string;
  html: string;
}

export interface FetchFailure {
  ok: false;
  reason: string;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

function parseHttpUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (!url.hostname) return null;
  return url;
}

async function readCapped(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > COPY_FETCH_MAX_BYTES) {
    throw new Error("Page is larger than 2MB");
  }
  if (!response.body) {
    const text = await response.text();
    if (Buffer.byteLength(text) > COPY_FETCH_MAX_BYTES) throw new Error("Page is larger than 2MB");
    return text;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > COPY_FETCH_MAX_BYTES) {
      await reader.cancel();
      throw new Error("Page is larger than 2MB");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Follow redirects by hand so each hop is resolved before it is requested.
 */
export async function fetchEventPage(
  rawUrl: string,
  deps: { lookup?: DnsLookup; fetch?: FetchLike } = {},
): Promise<FetchedPage | FetchFailure> {
  const resolve = deps.lookup ?? defaultLookup;
  const request = deps.fetch ?? fetch;
  let current = parseHttpUrl(rawUrl.trim());
  if (!current) return { ok: false, reason: "Only an http or https URL can be fetched" };
  try {
    for (let hop = 0; hop <= COPY_FETCH_MAX_REDIRECTS; hop++) {
      await publicAddresses(current.hostname, resolve);
      const response = await request(current.toString(), {
        redirect: "manual",
        signal: AbortSignal.timeout(COPY_FETCH_TIMEOUT_MS),
        headers: { accept: "text/html" },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) return { ok: false, reason: "Redirect had no location" };
        if (hop === COPY_FETCH_MAX_REDIRECTS) return { ok: false, reason: "Too many redirects" };
        const next = parseHttpUrl(new URL(location, current).toString());
        if (!next) return { ok: false, reason: "Redirect left http and https" };
        current = next;
        continue;
      }
      if (!response.ok) return { ok: false, reason: `Page returned ${response.status}` };
      const type = response.headers.get("content-type") ?? "";
      if (!type.toLowerCase().includes("text/html")) {
        return { ok: false, reason: "Page is not HTML" };
      }
      const html = await readCapped(response);
      return { ok: true, url: current.toString(), html };
    }
    return { ok: false, reason: "Too many redirects" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Fetch failed";
    if (/timeout|aborted/i.test(message)) return { ok: false, reason: "The page took longer than 8s" };
    return { ok: false, reason: message };
  }
}
