/**
 * SQL for the interest_clusters seed migrations (182 seed, 183 library).
 * The rows JSON is embedded verbatim between $seed$ tags so the migration
 * and its docs/analysis source file can be compared byte for byte.
 */

export const OPERATOR_EMAIL = "matas@offpixel.co.uk";

export function clusterSeedMigrationSql(opts: {
  number: number;
  header: readonly string[];
  source: "seed" | "library";
  rowsJson: string;
}): string {
  const tag = `migration ${opts.number}`;
  return [
    ...opts.header.map((line) => (line ? `-- ${line}` : "--")),
    "",
    "do $$",
    "declare",
    "  v_user_id uuid;",
    "begin",
    `  select id into v_user_id from auth.users where email = '${OPERATOR_EMAIL}' limit 1;`,
    "  if v_user_id is null then",
    `    raise notice '${tag}: operator user not found, no clusters seeded';`,
    "    return;",
    "  end if;",
    "",
    "  insert into interest_clusters (user_id, name, vertical, interests, evidence, source, unresolved)",
    "  select",
    "    v_user_id,",
    "    s ->> 'name',",
    "    s ->> 'vertical',",
    "    s -> 'interests',",
    "    s -> 'evidence',",
    `    '${opts.source}',`,
    "    coalesce(s -> 'unresolved', '[]'::jsonb)",
    "  from jsonb_array_elements($seed$",
    opts.rowsJson.trimEnd(),
    "$seed$::jsonb) as s",
    "  on conflict (user_id, name) do nothing;",
    "end $$;",
    "",
    "notify pgrst, 'reload schema';",
    "",
  ].join("\n");
}

/** The JSON between the $seed$ tags of a generated migration. */
export function embeddedSeedJson(sql: string): unknown {
  const start = sql.indexOf("jsonb_array_elements($seed$");
  const end = sql.indexOf("$seed$::jsonb");
  if (start < 0 || end < 0) throw new Error("no $seed$ block");
  return JSON.parse(sql.slice(start + "jsonb_array_elements($seed$".length, end));
}
