/** Chainable Supabase stand-in: every call is recorded; awaiting resolves via `resolve`. */
export type FakeCall = { table: string; ops: [string, unknown[]][] };

export function fakeDb(resolve: (call: FakeCall) => unknown) {
  const calls: FakeCall[] = [];
  const db = {
    from(table: string) {
      const call: FakeCall = { table, ops: [] };
      calls.push(call);
      const chain: unknown = new Proxy(
        {},
        {
          get(_target, prop) {
            if (prop === "then") {
              return (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) =>
                Promise.resolve()
                  .then(() => resolve(call))
                  .then(ok, bad);
            }
            return (...args: unknown[]) => {
              call.ops.push([String(prop), args]);
              return chain;
            };
          },
        },
      );
      return chain;
    },
  };
  return { db: db as never, calls };
}

export function op(call: FakeCall, name: string): unknown[] | undefined {
  return call.ops.find(([n]) => n === name)?.[1];
}
