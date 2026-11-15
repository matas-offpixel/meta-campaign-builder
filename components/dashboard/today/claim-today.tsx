import { loadClaimToday } from "@/lib/db/releases";
import { createClient } from "@/lib/supabase/server";

/** Proposals and back-to-held claims. Hidden until migration 211 is applied. */
export async function ClaimToday() {
  const db = await createClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return null;
  try {
    const rows = await loadClaimToday(db, auth.user.id);
    if (!rows?.length) return null;
    return (
      <section className="rounded-md border border-border bg-card p-4">
        <h2 className="mb-2 font-heading text-sm tracking-wide">Claims</h2>
        <ul className="space-y-1 text-sm">
          {rows.map((row) => (
            <li key={row.id}>{row.sentence}</li>
          ))}
        </ul>
      </section>
    );
  } catch {
    return null;
  }
}
