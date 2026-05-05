type TypedSupabaseClient = {
  from: (table: string) => {
    select: (columns: string) => unknown;
    insert: (payload: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }>;
    update: (payload: Record<string, unknown>) => {
      eq: (column: string, value: unknown) => PromiseLike<{ error: { message: string } | null }>;
    };
  };
};

export function metaAudienceIdempotencyKey(audienceId: string, userId: string) {
  return `mca:${audienceId}:${userId}`;
}

export async function withMetaAudienceWriteIdempotency(
  supabase: TypedSupabaseClient,
  args: {
    idempotencyKey: string;
    userId: string;
    audienceId: string;
  },
  run: () => Promise<string>,
): Promise<string> {
  const lookup = supabase
    .from("meta_audience_write_idempotency")
    .select("meta_audience_id") as {
    eq: (column: string, value: unknown) => {
      maybeSingle: () => Promise<{
        data: { meta_audience_id?: string | null } | null;
        error: { message: string } | null;
      }>;
    };
  };
  const { data: existing, error: lookupError } = await lookup
    .eq("idempotency_key", args.idempotencyKey)
    .maybeSingle();
  if (lookupError) throw new Error(lookupError.message);
  const cached = (existing as { meta_audience_id?: string | null } | null)
    ?.meta_audience_id;
  if (cached) return cached;

  if (!existing) {
    const { error: insertError } = await supabase
      .from("meta_audience_write_idempotency")
      .insert({
        idempotency_key: args.idempotencyKey,
        user_id: args.userId,
        audience_id: args.audienceId,
      });
    if (insertError) throw new Error(insertError.message);
  }

  const metaAudienceId = await run();
  const { error: updateError } = await supabase
    .from("meta_audience_write_idempotency")
    .update({ meta_audience_id: metaAudienceId })
    .eq("idempotency_key", args.idempotencyKey);
  if (updateError) throw new Error(updateError.message);
  return metaAudienceId;
}
