-- Run this in the ACCOUNTS Supabase project (the same one from db/accounts-schema.sql).
-- Adds the flag the admin portal checks before letting anyone in.

alter table public.profiles add column is_admin boolean not null default false;

-- Promote yourself to admin after signing up through the main HotShots app once:
-- update public.profiles set is_admin = true where email = 'you@example.com';
--
-- There is deliberately no UI or API route to grant admin access -- it's a
-- manual SQL step only, so someone can't grant themselves admin through
-- the app even if they found a way to call the API directly.
