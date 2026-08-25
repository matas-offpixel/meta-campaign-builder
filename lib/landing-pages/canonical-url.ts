import { fanPath, fanUrl } from "../admin/pages-list.ts";

/**
 * lib/landing-pages/canonical-url.ts
 *
 * The URL the LP system itself treats as canonical for an event page.
 * Path form reuses `fanUrl` / `fanPath` (admin copy + open-in-tab) — do
 * not hand-build `/l/…` elsewhere.
 *
 * Custom-host form: this repo has no `custom_domains` table (confirmed
 * 2026-08-25 against production). The resolver still accepts an explicit
 * host so a future row can win without a second URL builder. Never invent
 * `www.` — Vercel "include apex and www" will serve www without a row,
 * and fans then hit `/login`.
 */

export type CanonicalLandingPage =
  | { kind: "none" }
  | { kind: "path"; url: string; path: string }
  | { kind: "custom"; url: string; host: string };

export interface ResolveCanonicalLandingPageInput {
  hasPage: boolean;
  clientSlug: string | null;
  eventSlug: string | null;
  publicOrigin: string;
  /** Configured vanity host only. Null = no custom domain. Never invent www. */
  customHost: string | null;
}

/** Strip protocol, path, port-less trailing dots/slashes. Do not add www. */
export function normalizeCustomHost(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  let host = raw.trim().toLowerCase();
  if (!host) return null;
  host = host.replace(/^https?:\/\//, "");
  host = host.split("/")[0] ?? "";
  host = host.replace(/\.$/, "");
  return host || null;
}

export function resolveCanonicalLandingPage(
  input: ResolveCanonicalLandingPageInput,
): CanonicalLandingPage {
  if (!input.hasPage) return { kind: "none" };

  const customHost = normalizeCustomHost(input.customHost);
  if (customHost) {
    return {
      kind: "custom",
      host: customHost,
      url: `https://${customHost}`,
    };
  }

  const clientSlug = input.clientSlug?.trim() ?? "";
  const eventSlug = input.eventSlug?.trim() ?? "";
  if (!clientSlug || !eventSlug) return { kind: "none" };

  return {
    kind: "path",
    path: fanPath(clientSlug, eventSlug),
    url: fanUrl(input.publicOrigin, clientSlug, eventSlug),
  };
}

export function canonicalLandingPageUrl(
  resolved: CanonicalLandingPage,
): string | null {
  return resolved.kind === "none" ? null : resolved.url;
}
