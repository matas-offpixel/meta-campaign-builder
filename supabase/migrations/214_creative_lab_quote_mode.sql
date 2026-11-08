-- Migration 214 — Creative Lab quote mode.
--
-- Write only. Not applied from this branch. A quote is the artist's own
-- words. The Lab stores them verbatim and never writes or paraphrases one (Q1).
--
-- Column names follow the build list (mode, quote_source, quote_source_ref,
-- quote_source_note). quote_weight is HQ1's per-quote 700 / 400 toggle, which
-- that list left out. artist_id keeps one artist's words out of another
-- artist's round; captions have no artist column today.

alter table creative_lab_captions
  add column if not exists mode text not null default 'caption',
  add column if not exists quote_source text,
  add column if not exists quote_source_ref text,
  add column if not exists quote_source_note text,
  add column if not exists quote_weight smallint,
  add column if not exists artist_id uuid references creative_lab_artists (id) on delete set null;

alter table creative_lab_captions drop constraint if exists creative_lab_captions_mode_check;
alter table creative_lab_captions
  add constraint creative_lab_captions_mode_check
  check (mode in ('caption', 'quote'));

alter table creative_lab_captions drop constraint if exists creative_lab_captions_quote_source_check;
alter table creative_lab_captions
  add constraint creative_lab_captions_quote_source_check
  check (quote_source is null or quote_source in ('press_kit', 'post', 'typed'));

alter table creative_lab_captions drop constraint if exists creative_lab_captions_quote_weight_check;
alter table creative_lab_captions
  add constraint creative_lab_captions_quote_weight_check
  check (quote_weight is null or quote_weight in (700, 400));

alter table creative_lab_captions drop constraint if exists creative_lab_captions_quote_fields_check;
alter table creative_lab_captions
  add constraint creative_lab_captions_quote_fields_check
  check (
    (mode = 'caption' and quote_source is null and quote_weight is null)
    or (mode = 'quote' and quote_source is not null and quote_weight in (700, 400))
  );

do $$
declare r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = any (con.conkey)
    where con.conrelid = 'creative_lab_captions'::regclass
      and con.contype = 'c'
      and att.attname = 'style'
      and array_length(con.conkey, 1) = 1
  loop
    execute format('alter table creative_lab_captions drop constraint %I', r.conname);
  end loop;
end $$;

alter table creative_lab_captions
  add constraint creative_lab_captions_style_check
  check (style in (
    'lineup', 'question', 'scarcity', 'social_proof',
    'venue', 'whats_next', 'artist_first_person', 'experience', 'four_line', 'pov',
    'quote'
  ));

comment on column creative_lab_captions.mode is
  'caption or quote. A quote is the artist''s own words. The Lab never writes or paraphrases one (Q1). Existing rows stay captions.';
comment on column creative_lab_captions.quote_source is
  'Where a quote came from: press_kit, post, or typed. Null on a caption.';
comment on column creative_lab_captions.quote_source_ref is
  'The post permalink or the press-kit file name. Null when the quote was typed.';
comment on column creative_lab_captions.quote_source_note is
  'Where and when, for a typed quote. Null for a post or a press kit.';
comment on column creative_lab_captions.quote_weight is
  'HQ1. 700 or 400, the only weights a quote may use. Null on a caption. The build list omitted this column; the per-quote toggle needs it.';
comment on column creative_lab_captions.artist_id is
  'The artist a quote belongs to, so it enters only that artist''s round. Null on a caption. Not in the build list; without it a quote would pair onto every artist on the event.';
