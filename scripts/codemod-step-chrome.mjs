/**
 * One-shot codemod: route every `<p>` in the drawer-mounted step files
 * through `Prose` (explanatory — hidden in a drawer) or `StatusLine`
 * (evidence — kept, as a span).
 *
 * Classification is by tone class and content, and every decision is
 * printed so the diff can be read against it. Run with `--apply`.
 *
 * Not part of the build. Delete after PR 7 removes the call sites.
 */
import { readFileSync, writeFileSync } from "node:fs";

const FILES = [
  "components/steps/audiences/page-audiences-panel.tsx",
  "components/steps/audiences/interest-groups-panel.tsx",
  "components/steps/audiences/custom-audiences-panel.tsx",
  "components/steps/audiences/saved-audiences-panel.tsx",
  "components/steps/creatives.tsx",
  "components/steps/assign-creatives.tsx",
  "components/steps/budget-schedule.tsx",
  // Steps 0, 1 and 2 render inside the drawer's `details` disclosure, and
  // the two attach pickers inside the `⊞` tab — so they are drawer-mounted
  // too and the same rule applies.
  "components/steps/account-setup.tsx",
  "components/steps/campaign-setup.tsx",
  "components/steps/optimisation-strategy.tsx",
  "components/steps/adset-picker.tsx",
  "components/steps/cross-campaign-adset-picker.tsx",
  // The live multi-campaign picker for `attach_campaign` /
  // `attach_all_adsets`, reached from campaign-setup in the `⊞` tab.
  "components/bulk-attach/campaign-multi-picker.tsx",
];

/** Evidence the operator must not lose when the sentences go. */
const STATUS_CLASS = /destructive|text-warning|amber-|text-red|text-danger/;
const STATUS_TEXT =
  /error|failed|fail\b|cannot|can't|unable|denied|expired|invalid|Loading|loading|Fetching|fetching|no results|No results|not found|Not found|missing|Missing|rate.?limit|timed out|retry|Retry|unavailable|blocked|required|Select at least|must /i;
const ALERT_CLASS = /destructive|text-red|text-danger/;

/**
 * Explanatory prose, confidently: six or more words of static English
 * with a verb, and no interpolation carrying the meaning. Anything less
 * certain stays as `Datum`, which keeps rendering — a surviving sentence
 * is cosmetic, a vanished page name is a bug.
 */
const PROSE_VERB =
  /\b(is|are|was|were|be|been|will|would|can|cannot|may|must|should|use|uses|used|add|adds|create|creates|select|selects|choose|apply|applies|copy|copies|set|sets|need|needs|start|starts|open|opens|pick|picks|combine|rely|relies|skip|skipped|replace|replaces|generate|generates|leave|leaves|keep|keeps|show|shows|means|multiplies|inherit|inherited|target|targets|reach|only|each|every|all)\b/i;

/**
 * Hand-audited corrections. Each of these reads like prose but is really
 * evidence about this draft — a permission that is missing, an account
 * that is the wrong type, a budget over the review threshold — so the
 * drawer must keep showing it. The classifier cannot tell these from
 * furniture, so they are named.
 */
const FORCE_STATUS = new Set([
  "components/steps/audiences/page-audiences-panel.tsx:1046",
  "components/steps/audiences/page-audiences-panel.tsx:1056",
  "components/steps/audiences/page-audiences-panel.tsx:1580",
  "components/steps/audiences/interest-groups-panel.tsx:402",
  "components/steps/audiences/interest-groups-panel.tsx:721",
  "components/steps/audiences/interest-groups-panel.tsx:733",
  "components/steps/audiences/interest-groups-panel.tsx:1964",
  "components/steps/creatives.tsx:978",
  "components/steps/creatives.tsx:1304",
  "components/steps/creatives.tsx:1346",
  "components/steps/creatives.tsx:1349",
  "components/steps/creatives.tsx:1529",
  "components/steps/budget-schedule.tsx:674",
  "components/steps/budget-schedule.tsx:682",
  "components/steps/budget-schedule.tsx:1613",
  "components/steps/budget-schedule.tsx:1836",
  // Empty states in the attach pickers. "No ad sets found in this
  // campaign" reads exactly like furniture and is the only thing in the
  // box — hiding it leaves the operator staring at a blank list and
  // concluding the picker is broken.
  "components/steps/adset-picker.tsx:172",
  "components/steps/adset-picker.tsx:198",
  "components/steps/adset-picker.tsx:199",
  "components/steps/adset-picker.tsx:206",
  "components/steps/adset-picker.tsx:207",
  "components/steps/adset-picker.tsx:213",
  "components/steps/adset-picker.tsx:215",
  "components/steps/cross-campaign-adset-picker.tsx:128",
  // "Wait Nh after any budget change" and the ladder cap sentences state
  // the arm the tick will actually apply, which #877 made the record.
  "components/steps/optimisation-strategy.tsx:1294",
  "components/bulk-attach/campaign-multi-picker.tsx:194",
  "components/bulk-attach/campaign-multi-picker.tsx:211",
  "components/bulk-attach/campaign-multi-picker.tsx:213",
]);

const apply = process.argv.includes("--apply");
let converted = 0;
const manifest = [];

for (const file of FILES) {
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");
  const out = [...lines];
  let touched = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    // Only the opening tag; the matching close is rewritten by name below.
    const open = line.match(/^(\s*)(\{[^<]*)?<p(\s[^>]*)?>/);
    if (!open) continue;

    // Find the matching `</p>` by scanning forward for tag balance.
    let depth = 0;
    let close = -1;
    for (let j = i; j < lines.length; j += 1) {
      depth += (lines[j].match(/<p(\s|>)/g) ?? []).length;
      depth -= (lines[j].match(/<\/p>/g) ?? []).length;
      if (depth === 0) {
        close = j;
        break;
      }
    }
    if (close === -1) {
      manifest.push({ file, line: i + 1, kind: "UNBALANCED — skipped" });
      continue;
    }

    const body = lines.slice(i, close + 1).join(" ");
    const classAttr = body.match(/className=(?:"([^"]*)"|\{`([^`]*)`\})/)?.[0] ?? "";
    const text = stripJsx(body);
    const words = text.split(" ").filter((w) => /[a-z]/i.test(w));
    const forced = FORCE_STATUS.has(`${file}:${i + 1}`);
    const isStatus = forced || STATUS_CLASS.test(classAttr) || STATUS_TEXT.test(text);
    const isProse = !isStatus && words.length >= 6 && PROSE_VERB.test(text);
    const tag = isStatus ? "StatusLine" : isProse ? "Prose" : "Datum";
    const tone = isStatus && ALERT_CLASS.test(classAttr) ? ' tone="alert"' : "";

    out[i] = out[i].replace(/<p(\s|>)/, `<${tag}${tone}$1`);
    out[close] = out[close].replace(/<\/p>/, `</${tag}>`);
    // A single-line `<p>…</p>` had both replaced above only if distinct lines.
    if (i === close) {
      out[i] = lines[i]
        .replace(/<p(\s|>)/, `<${tag}${tone}$1`)
        .replace(/<\/p>/, `</${tag}>`);
    }
    touched += 1;
    manifest.push({
      file,
      line: i + 1,
      kind: tag,
      text: stripJsx(body).slice(0, 72).trim(),
    });
    i = close;
  }

  if (touched > 0) {
    let next = out.join("\n");
    next = ensureImport(next);
    if (apply) writeFileSync(file, next);
    converted += touched;
    console.log(`${touched.toString().padStart(3)}  ${file}`);
  }
}

/** `Prose` / `StatusLine` come from one module; add the import once. */
function ensureImport(src) {
  if (src.includes('from "@/components/steps/step-surface"')) return src;
  const used = [];
  if (/<Datum[\s/>]/.test(src)) used.push("Datum");
  if (/<Prose[\s/>]/.test(src)) used.push("Prose");
  if (/<StatusLine[\s/>]/.test(src)) used.push("StatusLine");
  if (used.length === 0) return src;
  const line = `import { ${used.join(", ")} } from "@/components/steps/step-surface";`;
  const lines = src.split("\n");
  let last = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^import\s|^} from ["']/.test(lines[i])) last = i;
  }
  lines.splice(last + 1, 0, line);
  return lines.join("\n");
}

function stripJsx(s) {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/\{[^}]*\}/g, " ")
    .replace(/\s+/g, " ");
}

console.log(`\n${converted} converted${apply ? "" : " (dry run — pass --apply)"}\n`);
console.log("file:line\tkind\ttext");
for (const row of manifest) {
  console.log(`${row.file}:${row.line}\t${row.kind}\t${row.text ?? ""}`);
}
