import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/dashboard/page-header";
import { createClient } from "@/lib/supabase/server";
import { listTikTokDrafts } from "@/lib/db/tiktok-drafts";

interface Props {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function TikTokIndexPage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const drafts = await listTikTokDrafts(supabase, { userId: user.id });
  const clientIds = unique(drafts.map((draft) => draft.clientId).filter(isString));
  const eventIds = unique(drafts.map((draft) => draft.eventId).filter(isString));
  const [clientsById, eventsById] = await Promise.all([
    readClients(supabase, clientIds),
    readEvents(supabase, eventIds),
  ]);

  const statusFilter = pick(sp.status);
  const clientFilter = pick(sp.client);
  const eventFilter = pick(sp.event);
  const updatedFilter = pick(sp.updated);
  const filtered = drafts.filter((draft) => {
    if (statusFilter && draft.status !== statusFilter) return false;
    if (clientFilter && draft.clientId !== clientFilter) return false;
    if (eventFilter && draft.eventId !== eventFilter) return false;
    if (updatedFilter && !matchesUpdatedFilter(draft.updatedAt, updatedFilter)) return false;
    return true;
  });

  return (
    <>
      <PageHeader
        title="TikTok campaigns"
        description="Manage TikTok campaign drafts separately from the Meta campaign library."
        actions={
          <Link href="/tiktok/new">
            <Button size="sm">
              <Plus className="h-3.5 w-3.5" />
              New TikTok campaign
            </Button>
          </Link>
        }
      />
      <main className="flex-1 px-6 py-6">
        <div className="mx-auto max-w-6xl space-y-4">
          <form className="grid gap-3 rounded-md border border-border bg-card p-4 md:grid-cols-4">
            <FilterSelect
              name="status"
              label="Status"
              value={statusFilter}
              options={["draft", "published", "archived"].map((value) => ({
                value,
                label: value,
              }))}
            />
            <FilterSelect
              name="client"
              label="Client"
              value={clientFilter}
              options={clientIds.map((id) => ({
                value: id,
                label: clientsById[id]?.name ?? id,
              }))}
            />
            <FilterSelect
              name="event"
              label="Event"
              value={eventFilter}
              options={eventIds
                .filter((id) => !clientFilter || eventsById[id]?.client_id === clientFilter)
                .map((id) => ({
                  value: id,
                  label: eventsById[id]?.name ?? id,
                }))}
            />
            <FilterSelect
              name="updated"
              label="Updated"
              value={updatedFilter}
              options={[
                { value: "7d", label: "Last 7 days" },
                { value: "30d", label: "Last 30 days" },
                { value: "older", label: "Older" },
              ]}
            />
            <div className="md:col-span-4 flex items-center gap-2">
              <Button type="submit" size="sm">
                <Search className="h-3.5 w-3.5" />
                Apply filters
              </Button>
              <Link href="/tiktok" className="text-xs text-muted-foreground hover:text-foreground">
                Clear
              </Link>
            </div>
          </form>

          {filtered.length === 0 ? (
            <section className="rounded-md border border-dashed border-border bg-card p-12 text-center">
              <p className="font-heading text-lg tracking-wide">
                No TikTok campaigns found
              </p>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                Create a TikTok draft from an event or start a blank draft.
              </p>
              <div className="mt-6 flex justify-center">
                <Link href="/tiktok/new">
                  <Button>
                    <Plus className="h-3.5 w-3.5" />
                    New TikTok campaign
                  </Button>
                </Link>
              </div>
            </section>
          ) : (
            <div className="overflow-hidden rounded-md border border-border bg-card">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="p-3">Name</th>
                    <th className="p-3">Client</th>
                    <th className="p-3">Event</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Updated</th>
                    <th className="p-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((draft) => (
                    <tr key={draft.id} className="border-t border-border">
                      <td className="p-3 font-medium">
                        {draft.campaignSetup.campaignName || "Untitled TikTok draft"}
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {draft.clientId ? (clientsById[draft.clientId]?.name ?? "—") : "—"}
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {draft.eventId ? (eventsById[draft.eventId]?.name ?? "—") : "—"}
                      </td>
                      <td className="p-3">
                        <span className="rounded-full bg-muted px-2 py-1 text-xs">
                          {draft.reviewReadyAt ? "review ready" : draft.status}
                        </span>
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {new Date(draft.updatedAt).toLocaleDateString("en-GB")}
                      </td>
                      <td className="p-3 text-right">
                        <Link href={`/tiktok-campaign/${draft.id}`}>
                          <Button variant="outline" size="sm">
                            Open wizard
                          </Button>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </>
  );
}

function FilterSelect({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value: string | null;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="space-y-1 text-sm">
      <span className="block text-xs font-medium text-muted-foreground">{label}</span>
      <select
        name={name}
        defaultValue={value ?? ""}
        className="h-9 w-full rounded-md border border-border-strong bg-background px-3 text-sm"
      >
        <option value="">All</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function pick(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() || null;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isString(value: string | null): value is string {
  return Boolean(value);
}

function matchesUpdatedFilter(updatedAt: string, filter: string): boolean {
  const ageMs = Date.now() - new Date(updatedAt).getTime();
  const days = ageMs / 86_400_000;
  if (filter === "7d") return days <= 7;
  if (filter === "30d") return days <= 30;
  if (filter === "older") return days > 30;
  return true;
}

async function readClients(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: string[],
): Promise<Record<string, { id: string; name: string }>> {
  if (ids.length === 0) return {};
  const { data, error } = await supabase
    .from("clients")
    .select("id, name")
    .in("id", ids);
  if (error) return {};
  return Object.fromEntries(
    ((data ?? []) as { id: string; name: string }[]).map((row) => [row.id, row]),
  );
}

async function readEvents(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: string[],
): Promise<Record<string, { id: string; name: string; client_id: string }>> {
  if (ids.length === 0) return {};
  const { data, error } = await supabase
    .from("events")
    .select("id, name, client_id")
    .in("id", ids);
  if (error) return {};
  return Object.fromEntries(
    ((data ?? []) as { id: string; name: string; client_id: string }[]).map((row) => [
      row.id,
      row,
    ]),
  );
}
