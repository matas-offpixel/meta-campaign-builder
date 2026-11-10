/**
 * The rung-1 split, as a pure function so migration 225 can be checked
 * without running SQL. A position-1 row that is still the 211 seed becomes
 * "{release} live", later rows move down one (their ids stay), and position 2
 * is the new selling-fast rung. An already-split ladder is left alone with
 * no notice. Anything else is named and left untouched. Nothing is deleted.
 */

export const RUNG1_SEED_TEMPLATE = "{release} live · selling fast";
export const RUNG1_LIVE_TEMPLATE = "{release} live";
export const RUNG2_TEMPLATE = "{release} selling fast";

export type StoredRung = {
  id: string;
  clientId: string;
  clientName: string;
  userId: string;
  position: number;
  triggerKind: string;
  triggerValue: string;
  claimTemplate: string;
  options: Record<string, unknown>;
};

export type SplitResult = {
  rows: StoredRung[];
  notices: string[];
};

function sameOptions(options: Record<string, unknown>, expected: Record<string, unknown>): boolean {
  const left = Object.keys(options).sort();
  const right = Object.keys(expected).sort();
  if (left.length !== right.length) return false;
  return left.every((key, index) => key === right[index] && options[key] === expected[key]);
}

function isSeed(rung: StoredRung | undefined): boolean {
  return Boolean(
    rung &&
      rung.triggerKind === "state" &&
      rung.triggerValue === "on_sale" &&
      rung.claimTemplate === RUNG1_SEED_TEMPLATE &&
      sameOptions(rung.options, { days: 0 }),
  );
}

function isAlreadySplit(rows: readonly StoredRung[]): boolean {
  const first = rows.find((row) => row.position === 1);
  const second = rows.find((row) => row.position === 2);
  return Boolean(
    first?.claimTemplate === RUNG1_LIVE_TEMPLATE &&
      second &&
      second.triggerKind === "state" &&
      second.triggerValue === "selling_fast" &&
      second.claimTemplate === RUNG2_TEMPLATE,
  );
}

export function splitLadders(rows: readonly StoredRung[]): SplitResult {
  const notices: string[] = [];
  const byClient = new Map<string, StoredRung[]>();
  for (const row of rows) {
    const list = byClient.get(row.clientId) ?? [];
    list.push(row);
    byClient.set(row.clientId, list);
  }
  const out: StoredRung[] = [];
  for (const list of byClient.values()) {
    const name = list[0]?.clientName ?? "unknown";
    if (isAlreadySplit(list)) {
      out.push(...list);
      continue;
    }
    const first = list.find((row) => row.position === 1);
    if (!isSeed(first)) {
      notices.push(name);
      out.push(...list);
      continue;
    }
    out.push({ ...first!, claimTemplate: RUNG1_LIVE_TEMPLATE });
    for (const row of list) {
      if (row.position >= 2) out.push({ ...row, position: row.position + 1 });
    }
    out.push({
      id: `split-${first!.clientId}`,
      clientId: first!.clientId,
      clientName: name,
      userId: first!.userId,
      position: 2,
      triggerKind: "state",
      triggerValue: "selling_fast",
      claimTemplate: RUNG2_TEMPLATE,
      options: { days: 0, or_earlier_sold_out: true },
    });
  }
  return { rows: out, notices };
}
