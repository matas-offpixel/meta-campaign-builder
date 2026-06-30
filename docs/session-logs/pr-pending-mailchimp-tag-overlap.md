# Session log — Mailchimp tag overlap endpoint

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/mailchimp-tag-overlap`

## Summary

Adds a one-shot admin endpoint `POST /api/admin/mailchimp-overlap` that computes
how many contacts in an "anchor" tag (e.g. "Website Sign Up") also appear in each
of N "comparison" tags (e.g. event-specific tags). Returns an overlap matrix in a
single API call: per-tag intersection size, `pct_of_anchor`, `pct_of_tag`, and a
`total_unique_across_all_tags` dedup count. Comparison-tag member sets are cached
so each tag is fetched exactly once (the naïve approach re-fetches each comparison
tag twice — once for the per-tag loop, once for the unique-count loop).

## Scope / files

- `app/api/admin/mailchimp-overlap/route.ts` — new endpoint (created)
- `lib/auth/public-routes.ts` — adds `pathname === "/api/admin/mailchimp-overlap"`
  carve-out so Bearer-only curls reach the handler before the session proxy

## Validation

- [x] tsc clean on new file (pre-existing `.next/types` + test errors unrelated)
- [ ] `npm run build`
- [ ] Manual curl after deploy (see PR body)

## Notes

- `maxDuration = 300` — 5 comparison tags × ~4 k members × ~1 s/page ≈ 30–60 s
  in practice; 300 s gives comfortable headroom.
- Member IDs are Mailchimp subscriber_hash (MD5 of email), so in-memory Set
  intersection is exact and fast with no per-member re-fetch.
- `getAllSegmentMemberIds` safety cap is 50 k — well above any foreseeable
  audience size for the Off Pixel client base.
