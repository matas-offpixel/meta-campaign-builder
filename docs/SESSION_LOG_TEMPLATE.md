# Session log template

Copy to `docs/session-logs/pr-{number}-{branch-slug}.md` (use `pr-pending-{branch-slug}.md` until the PR exists).

## PR

- **Number:** {number or `pending`}
- **URL:** {GitHub PR URL when known}
- **Branch:** `{branch-name}`

## Summary

{One short paragraph: what shipped and why.}

## Scope / files

- {Bullet list of main paths or concerns}

## Validation

- [ ] `npx tsc --noEmit`
- [ ] `npm run build` (when applicable)
- [ ] `npm test` (when applicable)

## Notes

{Optional: follow-ups, risks, or lessons learned.}
