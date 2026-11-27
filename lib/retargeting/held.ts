/**
 * lib/retargeting/held.ts — clients the connector's retargeting leaves alone
 * for now (Matas, 27 Nov: "don't touch any Louder / Parable shows for now").
 * plan_retargeting("live") leaves their shows out (with one line saying so),
 * and plan_retargeting on one of their shows and create_show_campaigns refuse.
 * The 08:00 read and the on-sale refresh don't read this list.
 *
 * One constant, by client id: lifting a hold is deleting its row. No
 * migration, no env.
 *
 * Pure. Relative imports only (node:test).
 */

export const HELD_CLIENTS: readonly { id: string; name: string }[] = [{ id: "9d4ebdfe-f062-4e4d-8982-1947829667b8", name: "Louder / Parable" }];

export const HELD_CLIENT_IDS: ReadonlySet<string> = new Set(HELD_CLIENTS.map((row) => row.id));

/** PENDING DESIGN: plan_retargeting on one held show, and create_show_campaigns. */
export function heldRefusal(client: string): string {
  return `${client} is held for now. Nothing was changed.`;
}

/** PENDING DESIGN: the line at the top of plan_retargeting("live") while a client is held. */
export function heldLine(clients: readonly string[]): string {
  return `${clients.join(", ")} ${clients.length === 1 ? "is" : "are"} held for now, so ${clients.length === 1 ? "its" : "their"} shows are left out.`;
}
