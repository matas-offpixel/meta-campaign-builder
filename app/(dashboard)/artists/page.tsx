import { redirect } from "next/navigation";
import { PageHeader } from "@/components/dashboard/page-header";
import { ArtistsList } from "@/components/dashboard/artists/artists-list";
import { countEventsByArtist, listArtists } from "@/lib/db/artists";
import { createClient } from "@/lib/supabase/server";

export default async function ArtistsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [artists, eventCounts] = await Promise.all([
    listArtists(user.id),
    countEventsByArtist(user.id),
  ]);

  const counts: Record<string, number> = {};
  for (const [k, v] of eventCounts.entries()) counts[k] = v;

  return (
    <>
      <PageHeader
        title="Artists"
        description="Master records for performers. Roster + genre data feeds the audience builder, lookalike seeds, and creative tagging."
      />
      <main className="flex-1 px-6 py-6">
        <div className="mx-auto max-w-6xl">
          <ArtistsList initialArtists={artists} eventCounts={counts} />
        </div>
      </main>
    </>
  );
}
