export function audienceErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function settleAudienceDimension<T>(
  load: () => Promise<T>,
  fallback: T,
): Promise<{ value: T; failed: boolean; error: string | null }> {
  try {
    return { value: await load(), failed: false, error: null };
  } catch (err) {
    return {
      value: fallback,
      failed: true,
      error: audienceErrorMessage(err),
    };
  }
}
