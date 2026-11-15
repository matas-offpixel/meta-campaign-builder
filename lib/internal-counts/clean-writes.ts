/**
 * lib/internal-counts/clean-writes.ts
 *
 * The ingest's one write boundary for text. Postgres refuses U+0000 in
 * text and jsonb ("unsupported Unicode escape sequence"), and a lone UTF-16
 * surrogate is not valid Unicode either. Email bodies, subjects, sender
 * names, PDF filenames and anything parsed from a PDF can carry either.
 *
 * cleanWrites(sb) wraps a Supabase client so every insert, upsert and
 * update payload, and every rpc argument, has those characters removed
 * from every string, keys and nested jsonb included. processMessage,
 * resolveItem and the names seed wrap their client once, so every write
 * below them goes through it. Reads are untouched.
 *
 * Relative imports only: the `node --test` runner can't resolve `@/`.
 */

// A NUL, a high surrogate not followed by a low one, or a low surrogate not preceded by a high one.
const BAD = /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function cleanText(s: string): string {
  return s.replace(BAD, "");
}

/** Strings cleaned; plain objects and arrays cleaned all the way down (keys too); anything else as it is. */
export function cleanValue<T>(value: T): T {
  if (typeof value === "string") return cleanText(value) as T;
  if (Array.isArray(value)) return value.map((v) => cleanValue(v)) as T;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [cleanText(k), cleanValue(v)])) as T;
  }
  return value;
}

const WRAPPED = Symbol("cleanWrites");
const WRITES = new Set(["insert", "upsert", "update"]);

/** The client with every write payload cleaned. Idempotent: wrapping twice wraps once. */
export function cleanWrites<T extends object>(sb: T): T {
  if ((sb as Record<symbol, unknown>)[WRAPPED]) return sb;
  return new Proxy(sb, {
    get(target, prop) {
      if (prop === WRAPPED) return true;
      const value = Reflect.get(target, prop, target) as unknown;
      if (prop === "from" && typeof value === "function") {
        return (...args: unknown[]) => wrapQuery((value as (...a: unknown[]) => object).apply(target, args));
      }
      if (prop === "rpc" && typeof value === "function") {
        return (fn: unknown, params: unknown, ...rest: unknown[]) =>
          (value as (...a: unknown[]) => unknown).call(target, fn, cleanValue(params), ...rest);
      }
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}

function wrapQuery(query: object): object {
  return new Proxy(query, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target) as unknown;
      if (typeof prop === "string" && WRITES.has(prop) && typeof value === "function") {
        return (payload: unknown, ...rest: unknown[]) => (value as (...a: unknown[]) => unknown).call(target, cleanValue(payload), ...rest);
      }
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}
