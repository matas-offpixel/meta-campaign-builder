import type { PlanTemplateEventSource } from "./library.ts";

export async function loadPlanTemplateEventSource(
  supabase: unknown,
  eventId: string,
  userId: string,
): Promise<PlanTemplateEventSource | null> {
  const client = supabase as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, value: string) => {
          eq: (col: string, value: string) => {
            maybeSingle: () => Promise<{
              data: {
                event_date?: string | null;
                presale_at?: string | null;
                general_sale_at?: string | null;
                ticket_url?: string | null;
                signup_url?: string | null;
              } | null;
            }>;
          };
        };
      };
    };
  };
  const { data } = await client
    .from("events")
    .select("event_date, presale_at, general_sale_at, ticket_url, signup_url")
    .eq("id", eventId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return null;
  return {
    eventDate: data.event_date ?? null,
    presaleAt: data.presale_at ?? null,
    generalSaleAt: data.general_sale_at ?? null,
    ticketUrl: data.ticket_url ?? null,
    signupUrl: data.signup_url ?? null,
  };
}
