-- Migration 272 — a client's parent client (a sub-brand under its promoter)
--
-- Off/Pixel MCP M3d-a, create_client(name, parent_client?): a sub-brand
-- (XMPL Sub-brand under XMPL Promoter) is its own client row, linked to the
-- client it sits under. Until now the app had no client-to-client link: a
-- promoter's brands were event codes under one client. This column is that
-- link and nothing reads it yet; no existing row is changed.
--
-- 1. clients.parent_client_id: nullable, the parent's id. Deleting the
--    parent clears the link (ON DELETE SET NULL), never the sub-brand.
-- 2. A CHECK keeps a client from being its own parent.
-- 3. An index for "the sub-brands of this client".
--
-- RLS is unchanged: clients' owner policies cover the new column, and the
-- MCP writes it as the service role with the caller's own user_id on the
-- row (the same as the form's insert).
--
-- Additive only. Not applied from this branch. Ops applies from the PR head.

alter table public.clients
  add column if not exists parent_client_id uuid
    references public.clients (id) on delete set null;

alter table public.clients
  drop constraint if exists clients_parent_not_self;

alter table public.clients
  add constraint clients_parent_not_self
  check (parent_client_id is null or parent_client_id <> id);

create index if not exists clients_parent_client_id_idx
  on public.clients (parent_client_id)
  where parent_client_id is not null;

comment on column public.clients.parent_client_id is
  'The client this one is a sub-brand of (XMPL Sub-brand under XMPL Promoter). Null for a top-level client. Set by create_client (Off/Pixel MCP M3d-a); read by nothing yet.';
