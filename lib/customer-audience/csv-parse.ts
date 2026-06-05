/**
 * lib/customer-audience/csv-parse.ts
 *
 * BROWSER-ONLY — never import from a Server Component or Route Handler.
 *
 * PII Safety contract:
 *   - Raw parsed values remain in memory only — never persisted.
 *   - Log counts only ("parsed N rows"), not values.
 *   - Callers must hash via hash-client.ts and discard plaintext rows promptly.
 */

import Papa from "papaparse";

// ─── Constants ────────────────────────────────────────────────────────────────

export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
export const MAX_FILES = 10;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
  rowCount: number;
}

export interface ParseError {
  file: string;
  message: string;
}

// ─── Auto-detect ──────────────────────────────────────────────────────────────

const EMAIL_HEADERS = new Set(["email", "e-mail", "mail", "email_address", "emailaddress"]);
const PHONE_HEADERS = new Set(["phone", "mobile", "tel", "telephone", "phone_number", "phonenumber", "contact"]);

export type ColumnRole = "email" | "phone" | "skip";

/**
 * Best-effort auto-detection of which column header maps to email / phone.
 * Returns a map of header → role; un-recognised columns default to "skip".
 */
export function autoDetectColumns(headers: string[]): Record<string, ColumnRole> {
  const result: Record<string, ColumnRole> = {};
  for (const h of headers) {
    const normalized = h.trim().toLowerCase().replace(/[\s_-]/g, "");
    if (EMAIL_HEADERS.has(normalized) || normalized.includes("email")) {
      result[h] = "email";
    } else if (PHONE_HEADERS.has(normalized) || normalized.includes("phone") || normalized.includes("mobile")) {
      result[h] = "phone";
    } else {
      result[h] = "skip";
    }
  }
  return result;
}

// ─── Parser ───────────────────────────────────────────────────────────────────

/**
 * Parse a CSV File in the browser using Papaparse.
 *
 * Streams via Papaparse's step callback to avoid materialising the entire
 * file in one allocation — safe for 100k+ row files.
 *
 * Throws `ParseError` for: empty files, size limit exceeded, no data rows,
 * no detectable headers.
 */
export function parseCsv(file: File): Promise<ParsedCsv> {
  return new Promise((resolve, reject) => {
    if (file.size === 0) {
      reject({ file: file.name, message: "File is empty." } satisfies ParseError);
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      reject({
        file: file.name,
        message: `File exceeds 50 MB limit (${(file.size / 1024 / 1024).toFixed(1)} MB).`,
      } satisfies ParseError);
      return;
    }

    let headers: string[] = [];
    let headersSet = false;
    const rows: Record<string, string>[] = [];

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      worker: false, // keep in main thread so we can hash in-step later
      step(result) {
        if (!headersSet) {
          headers = result.meta.fields ?? [];
          headersSet = true;
        }
        if (result.errors.length === 0) {
          rows.push(result.data as Record<string, string>);
        }
        // Silently skip malformed rows — log at call site (count only)
      },
      complete() {
        if (headers.length === 0) {
          reject({
            file: file.name,
            message: "Could not detect column headers. Ensure the first row is a header row.",
          } satisfies ParseError);
          return;
        }
        if (rows.length === 0) {
          reject({
            file: file.name,
            message: "No data rows found after the header.",
          } satisfies ParseError);
          return;
        }
        resolve({ headers, rows, rowCount: rows.length });
      },
      error(err) {
        reject({ file: file.name, message: err.message } satisfies ParseError);
      },
    });
  });
}

// ─── Multi-file merge ─────────────────────────────────────────────────────────

export interface FileParseStatus {
  file: File;
  status: "pending" | "parsing" | "done" | "error";
  rowCount?: number;
  headers?: string[];
  error?: string;
}

/**
 * Validate a list of files for the upload constraints (count + size).
 * Returns an array of human-readable error strings (empty = all OK).
 */
export function validateFiles(files: File[]): string[] {
  const errors: string[] = [];
  if (files.length > MAX_FILES) {
    errors.push(`Maximum ${MAX_FILES} files allowed (${files.length} selected).`);
  }
  for (const f of files) {
    if (!f.name.toLowerCase().endsWith(".csv")) {
      errors.push(`"${f.name}" is not a CSV file.`);
    }
    if (f.size > MAX_FILE_SIZE_BYTES) {
      errors.push(
        `"${f.name}" exceeds 50 MB (${(f.size / 1024 / 1024).toFixed(1)} MB).`,
      );
    }
  }
  return errors;
}
