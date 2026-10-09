/**
 * Fetch the event page for Suggest. http and https only. DNS is resolved
 * before the request and again after every redirect. Every IANA
 * special-purpose address is refused, including mapped and compatible
 * forms once they are written as IPv4. The connection uses only those
 * vetted addresses (undici does not resolve the name again). At most
 * 3 redirects, 8s, 2MB, and text/html only.
 */

import type { LookupOptions } from "node:dns";
import { BlockList, isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { Agent, fetch as undiciFetch, type Dispatcher } from "undici";

export const COPY_FETCH_TIMEOUT_MS = 8000;
export const COPY_FETCH_MAX_BYTES = 2 * 1024 * 1024;
export const COPY_FETCH_MAX_REDIRECTS = 3;

export type DnsLookup = (hostname: string) => Promise<string[]>;

type LookupAddress = { address: string; family: number };
type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/** The lookup undici's connect uses. It returns the vetted addresses and does not call DNS. */
export type PinnedLookup = (hostname: string, options: LookupOptions, callback: LookupCallback) => void;

/**
 * IANA IPv4 Special-Purpose Address Registry (2025-10-09), plus 224.0.0.0/4
 * multicast. 255.255.255.255/32 is also inside 240.0.0.0/4.
 */
const IPV4_SUBNETS: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.31.196.0", 24],
  ["192.52.193.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["192.175.48.0", 24],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

/**
 * IANA IPv6 Special-Purpose Address Registry, plus deprecated site-local
 * fec0::/10 and multicast ff00::/8. Mapped and compatible forms are
 * normalised to IPv4 before this list is consulted, so ::ffff:0:0/96 is
 * not blocked as a whole.
 */
const IPV6_SUBNETS: ReadonlyArray<readonly [string, number]> = [
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["100:0:0:1::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["2620:4f:8000::", 48],
  ["3fff::", 20],
  ["5f00::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
];

const ipv4Block = new BlockList();
for (const [network, prefix] of IPV4_SUBNETS) ipv4Block.addSubnet(network, prefix, "ipv4");
ipv4Block.addAddress("255.255.255.255", "ipv4");

const ipv6Block = new BlockList();
ipv6Block.addAddress("::", "ipv6");
ipv6Block.addAddress("::1", "ipv6");
for (const [network, prefix] of IPV6_SUBNETS) ipv6Block.addSubnet(network, prefix, "ipv6");

function padGroup(group: string): string {
  return group.padStart(4, "0");
}

/** Eight hextets, or null when the text is not an IPv6 address. */
function expandIpv6(input: string): string[] | null {
  let value = input;
  if (value.includes(".")) {
    const lastColon = value.lastIndexOf(":");
    const dotted = value.slice(lastColon + 1);
    const octets = dotted.split(".").map((part) => Number(part));
    if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
      return null;
    }
    const hi = ((octets[0] << 8) | octets[1]).toString(16);
    const lo = ((octets[2] << 8) | octets[3]).toString(16);
    value = `${value.slice(0, lastColon)}:${hi}:${lo}`;
  }
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if (head.some((group) => group.length === 0) || tail.some((group) => group.length === 0)) return null;
  if (halves.length === 1) {
    if (head.length !== 8) return null;
    return head.map(padGroup);
  }
  const missing = 8 - head.length - tail.length;
  if (missing < 0) return null;
  return [...head, ...Array.from({ length: missing }, () => "0"), ...tail].map(padGroup);
}

function ipv4FromHextets(hi: string, lo: string): string | null {
  const high = Number.parseInt(hi, 16);
  const low = Number.parseInt(lo, 16);
  if (!Number.isFinite(high) || !Number.isFinite(low)) return null;
  return `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
}

/**
 * IPv4-mapped (`::ffff:a.b.c.d`, `::ffff:7f00:1`) and IPv4-compatible
 * (`::a.b.c.d`, `::7f00:1`) forms become the embedded IPv4 address.
 */
function embeddedIpv4(value: string): string | null {
  const dottedMapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value);
  if (dottedMapped) return dottedMapped[1];
  const dottedCompatible = /^::(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value);
  if (dottedCompatible) return dottedCompatible[1];
  if (!value.includes(":")) return null;
  const groups = expandIpv6(value);
  if (!groups) return null;
  const zero = (group: string) => group === "0000";
  const mapped = groups.slice(0, 5).every(zero) && groups[5] === "ffff";
  const compatible = groups.slice(0, 6).every(zero);
  if (!mapped && !compatible) return null;
  return ipv4FromHextets(groups[6], groups[7]);
}

interface CanonicalIp {
  address: string;
  family: 4 | 6;
}

function canonicalIp(raw: string): CanonicalIp | null {
  const value = raw.trim().toLowerCase().replace(/^\[|\]$/g, "").split("%")[0] ?? "";
  if (!value) return null;
  const embedded = embeddedIpv4(value);
  if (embedded) {
    if (isIP(embedded) !== 4) return null;
    return { address: embedded, family: 4 };
  }
  const kind = isIP(value);
  if (kind === 4) return { address: value, family: 4 };
  if (kind === 6) return { address: value, family: 6 };
  return null;
}

function blocked(ip: CanonicalIp): boolean {
  if (ip.family === 4) return ipv4Block.check(ip.address, "ipv4");
  return ipv6Block.check(ip.address, "ipv6");
}

export function isBlockedIp(address: string): boolean {
  const ip = canonicalIp(address);
  if (!ip) return true;
  return blocked(ip);
}

export async function publicAddresses(hostname: string, resolve: DnsLookup = defaultLookup): Promise<string[]> {
  let addresses: string[];
  try {
    addresses = await resolve(hostname);
  } catch {
    throw new Error(`Could not resolve ${hostname}`);
  }
  if (addresses.length === 0) throw new Error(`Could not resolve ${hostname}`);
  const vetted: string[] = [];
  for (const address of addresses) {
    const ip = canonicalIp(address);
    if (!ip || blocked(ip)) throw new Error(`${hostname} resolves to a private address`);
    vetted.push(ip.address);
  }
  return vetted;
}

function pinnedConnectLookup(addresses: readonly string[]): PinnedLookup {
  const records: LookupAddress[] = addresses.map((address) => ({
    address,
    family: isIP(address) === 6 ? 6 : 4,
  }));
  return (_hostname, options, callback) => {
    if (records.length === 0) {
      callback(Object.assign(new Error("No vetted address"), { code: "ENOTFOUND" }), []);
      return;
    }
    if (options.all) {
      callback(null, records);
      return;
    }
    callback(null, records[0].address, records[0].family);
  };
}

function pinnedAgent(addresses: readonly string[]): Agent {
  return new Agent({ connect: { lookup: pinnedConnectLookup(addresses) } });
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

type FetchInit = {
  redirect: "manual";
  signal: AbortSignal;
  headers: { accept: string };
  dispatcher: Dispatcher;
};

type FetchLike = (url: string, init: FetchInit) => Promise<Response>;

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
 * Follow redirects by hand so each hop is resolved, then connected to
 * those addresses only. SNI and Host stay the hostname.
 */
export async function fetchEventPage(
  rawUrl: string,
  deps: { lookup?: DnsLookup; fetch?: FetchLike } = {},
): Promise<FetchedPage | FetchFailure> {
  const resolve = deps.lookup ?? defaultLookup;
  const request = deps.fetch ?? (undiciFetch as unknown as FetchLike);
  let current = parseHttpUrl(rawUrl.trim());
  if (!current) return { ok: false, reason: "Only an http or https URL can be fetched" };
  try {
    for (let hop = 0; hop <= COPY_FETCH_MAX_REDIRECTS; hop++) {
      const addresses = await publicAddresses(current.hostname, resolve);
      const agent = pinnedAgent(addresses);
      try {
        const response = await request(current.toString(), {
          redirect: "manual",
          signal: AbortSignal.timeout(COPY_FETCH_TIMEOUT_MS),
          headers: { accept: "text/html" },
          dispatcher: agent,
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
      } finally {
        await agent.close();
      }
    }
    return { ok: false, reason: "Too many redirects" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Fetch failed";
    if (/timeout|aborted/i.test(message)) return { ok: false, reason: "The page took longer than 8s" };
    return { ok: false, reason: message };
  }
}
