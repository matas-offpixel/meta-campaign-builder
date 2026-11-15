/**
 * Every table and column Creative Lab reads must exist on the generated
 * Database type. The in-memory test database accepts any column, which is
 * how artists.client_id shipped: the roster table has no such column.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function tree(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? tree(path) : [path];
  });
}

function strip(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function constants(source: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of source.matchAll(/const\s+([A-Z0-9_]+)\s*=\s*"([^"]+)"/g)) out.set(match[1], match[2]);
  return out;
}

function chainColumns(tail: string, named: Map<string, string>): string[] {
  const columns: string[] = [];
  const selected = tail.match(/\.select\(\s*(?:"([^"]*)"|([A-Z0-9_]+))\s*\)/);
  const raw = selected?.[1] ?? (selected?.[2] ? named.get(selected[2]) : undefined);
  if (raw && raw !== "*") {
    for (const part of raw.split(",")) {
      const column = part.trim().split(":")[0]?.trim();
      if (column) columns.push(column);
    }
  }
  for (const match of tail.matchAll(/\.(?:eq|in|not|lte|lt|gte|gt|order)\(\s*"([a-z0-9_]+)"/g)) columns.push(match[1]);
  return columns;
}

function reads(source: string): Map<string, Set<string>> {
  const text = strip(source);
  const named = constants(text);
  const found = new Map<string, Set<string>>();
  const add = (table: string, columns: string[]) => {
    const set = found.get(table) ?? new Set<string>();
    for (const column of columns) set.add(column);
    found.set(table, set);
  };
  const sites: { index: number; table: string; column?: string }[] = [];
  for (const match of text.matchAll(/(?:\bdb|\bdeps\.db|\bserviceRoleDb)\.from\(\s*"([a-z0-9_]+)"\s*\)/g)) {
    sites.push({ index: match.index + match[0].length, table: match[1] });
  }
  for (const match of text.matchAll(/\b(?:table|q)\(\s*[^,]+,\s*"([a-z0-9_]+)"\s*\)/g)) {
    sites.push({ index: match.index + match[0].length, table: match[1] });
  }
  for (const match of text.matchAll(/\b(?:list|many|one|rowsOf)\(\s*[^,]+,\s*"([a-z0-9_]+)"\s*,\s*("([a-z0-9_]+)"|[^,)]+)/g)) {
    sites.push({ index: match.index + match[0].length, table: match[1], column: match[3] ?? "id" });
  }
  for (const site of sites) {
    const rest = text.slice(site.index, site.index + 700);
    const next = rest.search(/\b(?:from|table|q|list|many|one|rowsOf)\(/);
    const tail = (next > 0 ? rest.slice(0, next) : rest).split(";")[0] ?? "";
    add(site.table, [...(site.column ? [site.column] : []), ...chainColumns(tail, named)]);
  }
  return found;
}

function typeRows(source: string): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  for (const match of source.matchAll(/\n {6}([a-z0-9_]+): \{\n {8}Row: \{([^}]*)\}/g)) {
    const columns = new Set<string>();
    for (const column of match[2].matchAll(/\n\s+([a-z0-9_]+)\??:/g)) columns.add(column[1]);
    tables.set(match[1], columns);
  }
  return tables;
}

describe("creative lab schema guard", () => {
  it("reads only tables and columns in database.types.ts", () => {
    const files = tree("lib/creative-lab").filter((path) => path.endsWith(".ts") && !path.includes("__tests__"));
    const types = typeRows(readFileSync("lib/db/database.types.ts", "utf8"));
    const missing: string[] = [];
    for (const path of files) {
      for (const [table, columns] of reads(readFileSync(path, "utf8"))) {
        const known = types.get(table);
        if (!known) {
          missing.push(`${path} reads ${table}, which is not in database.types.ts`);
          continue;
        }
        for (const column of columns) {
          if (!known.has(column)) missing.push(`${path} reads ${table}.${column}`);
        }
      }
    }
    assert.deepEqual(missing, []);
  });
});
