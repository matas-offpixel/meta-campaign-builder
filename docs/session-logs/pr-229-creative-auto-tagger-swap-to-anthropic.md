# Session log

## PR

- **Number:** 229
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/229
- **Branch:** `creative/auto-tagger-swap-to-anthropic`

## Summary

Swaps the Motion creative auto-tagger from OpenAI `gpt-4o-mini` to Anthropic `claude-haiku-4-5-20251001` while keeping the existing cron-side sidecar, `ENABLE_AI_AUTOTAG` flag, assignment `model_version` traceability, and validation gate behaviour.

## Scope / files

- `lib/intelligence/auto-tagger.ts` now uses Anthropic Messages with a forced tool call whose schema carries the closed taxonomy enums.
- `app/api/cron/refresh-active-creatives/route.ts` constructs Anthropic from `ANTHROPIC_API_KEY` under the existing feature flag.
- `scripts/validate-ai-tagging.ts` uses the same Anthropic model and preserves the JSON output shape for the accuracy gate.
- `package.json` / lockfile replace `openai` with `@anthropic-ai/sdk`.
- `CLAUDE.md` documents `ANTHROPIC_API_KEY` for the ops env batch.

## Validation

- [x] `npx tsc --noEmit`
- [x] `npm test`
- [x] `npm run lint -- lib/intelligence/auto-tagger.ts lib/intelligence/__tests__/auto-tagger.test.ts app/api/cron/refresh-active-creatives/route.ts scripts/validate-ai-tagging.ts package.json` (exited 0; ESLint warned `package.json` is ignored by config)

## Notes

Migrations / infra state: N/A, no DB change. Post-merge, confirm `ANTHROPIC_API_KEY` is set in Vercel Production + Preview. Leave `OPENAI_API_KEY` in place for one week as rollback safety, then remove once stable.
