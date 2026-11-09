/** One line for a Generate call, so a failure is visible in the Vercel log. */

export function generateErrorClass(error: unknown): string | null {
  if (error == null) return null;
  if (error instanceof Error) {
    const message = error.message.trim();
    if (!message) return error.name;
    return message.split(":")[0]!.slice(0, 120);
  }
  return "unknown";
}

export type GenerateYield = {
  rejects: Record<string, number>;
  duplicates: number;
  candidates: number;
};

export function emptyYield(): GenerateYield {
  return { rejects: {}, duplicates: 0, candidates: 0 };
}

/** One count per code on a dropped candidate. The same code twice on one candidate counts once. */
export function noteReject(yieldStats: GenerateYield, errors: readonly { code: string }[]): void {
  const seen = new Set<string>();
  for (const error of errors) {
    if (!error.code || seen.has(error.code)) continue;
    seen.add(error.code);
    yieldStats.rejects[error.code] = (yieldStats.rejects[error.code] ?? 0) + 1;
  }
}

export function generateLogLine(args: {
  eventId: string;
  mode: string;
  clips: number | null;
  writerResultCount: number;
  error: unknown;
  yield?: GenerateYield;
}): string {
  const counted = args.yield ?? emptyYield();
  return JSON.stringify({
    event: args.eventId,
    mode: args.mode,
    clips: args.clips,
    writerResultCount: args.writerResultCount,
    errorClass: generateErrorClass(args.error),
    rejects: counted.rejects,
    duplicates: counted.duplicates,
    candidates: counted.candidates,
  });
}
