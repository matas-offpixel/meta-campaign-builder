---
alwaysApply: true
---

# Off/Pixel Dashboard — project context

Repo path: /Users/liebus/meta-campaign-builder
Branch policy: work on feature branches off main. Auto-push rule (.cursor/rules/auto-push.mdc) applies only after I approve merges.

This thread owns the DASHBOARD layer only. The Meta Campaign Creator lives in the same repo and is managed by a different Cursor thread. Treat creator files as read-only unless I explicitly say otherwise.

Stack (confirmed): Next.js 16.2.1, React 19.2.4, TypeScript strict, Tailwind v4, Supabase SSR + JS, lucide-react. AGENTS.md explicitly warns this is a non-standard Next.js version — read node_modules/next/dist/docs/ before using unfamiliar patterns.

Auth: Supabase magic-link, single user session shared across both products. Session refresh + guard in proxy.ts via lib/supabase/proxy.ts. Public routes in lib/auth/public-routes.ts.

Database: Supabase Postgres. Schema in supabase/schema.sql. Migrations in supabase/migrations/. RLS per user_id on every user-owned table. Never write SQL that bypasses RLS.

Product philosophy: operational hub for a marketing agency running event promoters and brands. Event-first, not campaign-first. The dashboard is the source of truth for clients + events + workflow + reporting. The creator is a tool called by the dashboard, not the other way around. Long term it should learn from historical event outcomes.
