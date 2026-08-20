export function throwIfTikTokTemplateDeleteFailed(
  error: { message: string } | null,
): void {
  if (!error) return;
  console.error("Supabase TikTok template delete error:", error.message);
  throw new Error(error.message);
}
