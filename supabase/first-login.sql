-- ════════════════════════════════════════════════════════════════════════════
-- Listing Video Studio — create your FIRST login (the Super Admin)
--
-- Run AFTER supabase/setup.sql, in the Supabase dashboard → SQL Editor → New query → Run.
-- The result shows a one-time setup code (valid 60 minutes). Then open
--   https://<your-app>.vercel.app/setup
-- enter the code, your company name, your name, email and password.
--
-- Only a hash of the code is stored. Running this again replaces an unused code.
-- After setup is complete it refuses to run (add everyone else from Admin → People).
-- ════════════════════════════════════════════════════════════════════════════
with bytes as (
  select extensions.gen_random_bytes(30) as r
), letters as (
  -- the app's code alphabet (no 0/O/1/I)
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (get_byte(r, i) % 32) + 1, 1), '' order by i) as raw
  from bytes, generate_series(0, 29) as i
), code as (
  select concat_ws('-', substr(raw, 1, 5), substr(raw, 6, 5), substr(raw, 11, 5), substr(raw, 16, 5), substr(raw, 21, 5), substr(raw, 26, 5)) as code
  from letters
)
select code as "Your one-time setup code",
       public.bootstrap_create_token(encode(sha256(convert_to('lvs-setup:' || code, 'UTF8')), 'hex'), 60) as "Valid until"
from code;
