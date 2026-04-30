#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

import { importMotionSeedTags } from "../lib/db/creative-tags.ts";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const userId = process.env.SEED_USER_ID;
const glossaryPath = resolve(
  process.cwd(),
  process.env.MOTION_GLOSSARY_PATH ??
    "docs/motion-research/01-glossary-with-creative-ids.json",
);

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Source .env.local first.",
  );
}

if (!userId) {
  throw new Error("Missing SEED_USER_ID. Pass the owner user uuid.");
}

const glossary = JSON.parse(await readFile(glossaryPath, "utf8")) as unknown;
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const result = await importMotionSeedTags(supabase, userId, glossary);

console.log(
  JSON.stringify(
    {
      user_id: userId,
      glossary_path: glossaryPath,
      ...result,
    },
    null,
    2,
  ),
);
