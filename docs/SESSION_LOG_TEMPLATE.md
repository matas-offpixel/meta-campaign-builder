# PR #{N} — {title}

## Summary
2-3 lines on what this PR does and why.

## Files changed
- `path/to/file.ts` — one-line semantic description (what, not how)

## Validation
- `tsc`: clean / N new errors
- `lint`: {N errors, M unchanged from main, K new in this PR's files}
- `tests`: {N/M passed; new tests added: ...}
- `build`: clean / failed

## Decisions I made that deviated from the prompt
- {decision} — because {constraint}; alternate considered: {...}

## Migrations / infra state
- Local applied: y/n
- Prod applied: y/n (flag for Cowork to apply via Supabase MCP)
- New env vars required: ...
- Cache / snapshot state touched: ...

## Post-merge verification
- What to check after Vercel deploys
- Expected propagation / cron windows / stale-marker actions

## Surprising findings (out of scope, worth a follow-up)
- ...

## Type signatures of new public exports
- `export function foo(x: X): Y`

## "I would have done X but stuck to spec"
- ...
