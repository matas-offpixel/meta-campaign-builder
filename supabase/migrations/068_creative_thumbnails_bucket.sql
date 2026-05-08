-- Public bucket for Meta ad preview images cached from Graph + CDN.
-- Populated by service-role uploads (cron + GET proxy miss path).
-- Objects are non-sensitive marketing thumbnails; public read enables
-- CDN-style URLs and keeps the Next.js proxy thin (stream from Storage).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'creative-thumbnails',
  'creative-thumbnails',
  true,
  5242880,  -- 5 MB — plenty for a card thumbnail
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do nothing;

-- Anyone may read cached thumbnails (same as a public CDN URL).
drop policy if exists "Public read creative thumbnails" on storage.objects;
create policy "Public read creative thumbnails"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'creative-thumbnails');
