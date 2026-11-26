/**
 * Rename one live Meta campaign, ad set or ad (the connector's rename, M3b).
 *
 * POST /{id} { name }. Nothing else changes and nothing spends, so there is
 * no switch beyond the connector's own (mcp:meta, Matas's yes). Every
 * write is on meta_write_idempotency as `object_name_update` with
 * `{ required: true }`, keyed on the ask. The app has no rename path for a
 * live object, so this is the one place that writes a name.
 *
 * The Graph call is passed in, so tests run on fakes.
 */

import { withMetaWriteIdempotency, type MetaWriteContext } from "./write-idempotency.ts";

/** Meta's limit on campaign, ad set and ad names. */
export const MAX_META_NAME = 400;

export type ObjectNameGraph = {
  postName(objectId: string, name: string): Promise<void>;
};

export async function writeObjectName(args: {
  ledger: MetaWriteContext;
  graph: ObjectNameGraph;
  kind: "campaign" | "adset" | "ad";
  objectId: string;
  name: string;
  key: string;
}): Promise<string> {
  if (!/^\d+$/.test(args.objectId)) throw new Error(`not a Meta id: ${args.objectId}`);
  const name = args.name.trim();
  if (!name || [...name].length > MAX_META_NAME) throw new Error("bad name");
  return withMetaWriteIdempotency(
    args.ledger,
    "object_name_update",
    { kind: args.kind, object_id: args.objectId, name, key: args.key },
    async () => {
      await args.graph.postName(args.objectId, name);
      return args.objectId;
    },
    { required: true },
  );
}
