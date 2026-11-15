-- Asset bank issue 3. The five claim_trigger_kind values. 222 uses them.
-- Applied by Matas from main after merge. This file removes nothing.

alter type public.claim_trigger_kind add value if not exists 'roll_call';
alter type public.claim_trigger_kind add value if not exists 'velocity';
alter type public.claim_trigger_kind add value if not exists 'price_rise_date';
alter type public.claim_trigger_kind add value if not exists 'countdown_pct';
alter type public.claim_trigger_kind add value if not exists 'lineup_add';
