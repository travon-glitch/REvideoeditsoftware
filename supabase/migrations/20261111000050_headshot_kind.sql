-- Stage 11: agent headshots are their own kind of brand asset.
-- (Its own migration: a new enum value can't be used in the transaction that adds it.)
alter type public.asset_kind add value if not exists 'headshot';
