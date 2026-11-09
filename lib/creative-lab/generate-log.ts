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

export function generateLogLine(args: {
  eventId: string;
  mode: string;
  clips: number | null;
  writerResultCount: number;
  error: unknown;
}): string {
  return JSON.stringify({
    event: args.eventId,
    mode: args.mode,
    clips: args.clips,
    writerResultCount: args.writerResultCount,
    errorClass: generateErrorClass(args.error),
  });
}
