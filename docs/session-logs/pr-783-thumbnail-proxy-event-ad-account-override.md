## PR

- **Number:** 783
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/783
- **Branch:** `cursor/thumbnail-proxy-event-ad-account-override`

## Summary

Creative-thumbnail proxy auth only checked `clients.meta_ad_account_id`, so ads in per-event override accounts 403'd (Electric Brixton share / NX26-DJEZ, 2026-08-18). Validate against client default ∪ DISTINCT `events.meta_ad_account_id` for that client. URL shape unchanged.

## Scope / files

- `lib/meta/thumbnail-ad-account-allowlist.ts` — pure merge / set-match / injectable loader
- `lib/meta/thumbnail-proxy-server.ts` — `verifyAdAccountForThumbnail` accepts `string | string[]`
- `lib/meta/creative-thumbnail-get.ts` — both auth paths load the full allowlist
- `lib/meta/__tests__/thumbnail-ad-account-allowlist.test.ts`

## Validation

- [x] `node --test lib/meta/__tests__/thumbnail-ad-account-allowlist.test.ts`
- [ ] Share page Top Creatives tiles for NX26-DJEZ load (no letter-tile fallback from 403)

## Notes

- Reproducer: client default `1073273492854557`, NX events override `606252931141334`.
- `#772`–`#776` sweep missed this surface; dashboard session path had the same bug.
