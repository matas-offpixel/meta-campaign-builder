/**
 * No part of a token or secret reaches console output (Matas, 27 Nov: the
 * token lookup logged the first 12 characters of his Facebook token on every
 * call). Any slice, substring or substr of a variable named like a token,
 * secret, password or API key in app/, lib/, scripts/ or components/ fails
 * this test, as does a prefix=… or token_prefix log field, unless it's on the
 * short list below of uses that aren't a secret (a word token, the operator's
 * own share-link label in the dashboard).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SLICE = /\b\w*(?:Token|token|Secret|secret|Password|password|ApiKey|apiKey|api_key)\b[!?]?\.(?:slice|substring|substr)\(/;
const PREFIX_FIELD = /\btoken_prefix\b|prefix=\$\{[\w.!?]*(?:[Tt]oken|[Ss]ecret|[Kk]ey)/;

/** Not secrets: a parsed word called token, and the operator's own share-link label shown in the dashboard (never logged). */
const ALLOWED: Record<string, RegExp> = {
  "lib/creative-lab/caption-facts.ts": /MONTHS\[token\.slice\(0, 3\)\.toLowerCase\(\)\]/,
  "components/wizard/mml-step-audiences.tsx": /token\.charAt\(0\)\.toUpperCase\(\) \+ token\.slice\(1\)/,
  "components/wizard/mml-step-budget.tsx": /token\.charAt\(0\)\.toUpperCase\(\) \+ token\.slice\(1\)/,
  "components/dashboard/clients/rollout/client-rollout-view.tsx": /\{row\.shareToken\.slice\(0, 6\)\}…/,
  "components/dashboard/clients/share-dashboard-button.tsx": /share\.token\.slice\(0, 12\) \+ "…"/,
};

function walk(dir: string): string[] {
  const out: string[] = [];
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    const full = join(dir, name);
    if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) continue;
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx|mts|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

test("no slice of a token or secret, and no prefix= / token_prefix field, outside the short allowed list", () => {
  const hits: string[] = [];
  for (const file of ["app", "lib", "scripts", "components"].flatMap(walk)) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (!SLICE.test(line) && !PREFIX_FIELD.test(line)) return;
      if (ALLOWED[file]?.test(line)) return;
      hits.push(`${file}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  assert.deepEqual(hits, []);
});

test("the token lookup logs its source, age and expiry, never the token", () => {
  const src = readFileSync("lib/meta/server-token.ts", "utf8");
  assert.match(src, /`\[resolveToken\] source=db` \+\n\s+` updated_at=\$\{updatedAt \?\? "unknown"\}` \+\n\s+` expires_at=\$\{expiresAt \?\? "unknown"\}` \+\n\s+` expires_in_h=\$\{expiresInH\}` \+\n\s+` expired=\$\{isExpired\}`/);
  assert.match(src, /`\[resolveToken\] source=env`/);
  assert.doesNotMatch(src, /tok\.length|envToken\.length|prefix=/);
});
