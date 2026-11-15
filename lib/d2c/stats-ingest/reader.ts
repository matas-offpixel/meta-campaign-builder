/**
 * lib/d2c/stats-ingest/reader.ts
 *
 * A GET-only reader with a call counter, over the shared Bird and
 * Mailchimp fetch helpers. The ingest only ever reads: there is no
 * method here that sends a body, so a PATCH, POST or DELETE can't be
 * made through it. No Content-Type is set on these bodyless GETs.
 *
 * Relative imports only (node --test).
 */

import { BirdHttpError, birdJson } from "../bird/client.ts";
import { MailchimpHttpError, mailchimpJson } from "../mailchimp/client.ts";

export interface StatsReader {
  get<T>(path: string): Promise<T>;
  /** GETs made so far. */
  readonly calls: number;
}

export class StatsReadError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "StatsReadError";
    this.status = status;
  }
}

/** The status of a reader error (0 when it isn't an HTTP error). */
export function statusOf(err: unknown): number {
  if (err instanceof StatsReadError) return err.status;
  if (err instanceof BirdHttpError || err instanceof MailchimpHttpError) return err.status;
  return 0;
}

/** A short, key-free error line for run logs. */
export function errorLine(err: unknown): string {
  const status = statusOf(err);
  const text = err instanceof Error ? err.message : String(err);
  return (status ? `HTTP ${status}: ` : "") + text.replace(/\s+/g, " ").slice(0, 200);
}

export function birdReader(apiKey: string): StatsReader {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async get<T>(path: string): Promise<T> {
      calls += 1;
      return birdJson<T>(apiKey, path, { method: "GET" });
    },
  };
}

export function mailchimpReader(serverPrefix: string, apiKey: string): StatsReader {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async get<T>(path: string): Promise<T> {
      calls += 1;
      return mailchimpJson<T>(serverPrefix, apiKey, path, { method: "GET" });
    },
  };
}
