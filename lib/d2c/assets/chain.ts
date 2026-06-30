/**
 * lib/d2c/assets/chain.ts
 *
 * Pure artwork-resolution chain. No I/O — each step is an async thunk that
 * resolves to a URL or null. Kept dependency-free so the fallback logic is
 * unit-testable without Supabase / Bird (see __tests__/asset-resolver.test.ts).
 */

export class AssetUnresolvedError extends Error {
  readonly eventId: string;
  constructor(eventId: string, message?: string) {
    super(
      message ??
        `Could not resolve artwork for event ${eventId} via any source (event copy, asset queue, Bird media). Manual override required.`,
    );
    this.name = "AssetUnresolvedError";
    this.eventId = eventId;
  }
}

export type ArtworkStep = () => Promise<string | null>;

function isUsableUrl(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Runs each step in order, returning the first non-empty URL. A step that
 * throws is treated as a miss (logged by the caller) so one failing source
 * never blocks the rest of the chain. Throws AssetUnresolvedError if all
 * steps miss.
 */
export async function resolveArtworkChain(
  eventId: string,
  steps: ArtworkStep[],
): Promise<string> {
  for (const step of steps) {
    let result: string | null = null;
    try {
      result = await step();
    } catch {
      result = null;
    }
    if (isUsableUrl(result)) return result.trim();
  }
  throw new AssetUnresolvedError(eventId);
}
