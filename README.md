# HotShots Admin

A separate, internal-only dashboard for managing HotShots users and recipes. It talks to the same two Supabase projects as the main app but with elevated (service-role) access, so it's deployed as its own site rather than bundled into the consumer app.

## Architecture

- **Its own Vercel project**, its own domain (e.g. `admin.hotshots.app`), separate from the main app's deployment. Nothing in the public HotShots bundle references this code at all.
- **Sign-in reuses the Accounts Supabase project** — an admin is just a normal HotShots account with `profiles.is_admin = true`. There's no separate admin login system to maintain.
- **`/api/admin/*` routes** hold the actual privileged logic. They check the caller's token, look up `is_admin` with the Accounts project's service-role key (regular users can only read their own profile row, so checking someone else's flag needs elevated access even for the admin's own check), and only then touch data.
- **Recipes and users live in different databases** (App Data vs Accounts), so `api/admin/recipes/index.js` does the author lookup as a second query and stitches the two together in code — there's no SQL join across separate Supabase projects.

## What it can do today

- **Users**: see every account, their plan and subscription status, and override either one (for support requests, comps, refunds) with a couple of clicks.
- **Recipes**: see every recipe in the app (shared or private), who made it, its rating, hide it from Explore without deleting it, or delete it outright.
- A small stat strip (total users, total recipes, how many are shared, how many are on a paid plan) at the top of both screens.

## One-time setup

1. Run `db/add-admin-flag.sql` in the **same Accounts Supabase project** the main app already uses — this just adds the `is_admin` column to `profiles`.
2. Sign up for a normal HotShots account through the main app (or use one you already have), then in the Accounts project's SQL editor:
   ```sql
   update public.profiles set is_admin = true where email = 'you@example.com';
   ```
   There's deliberately no button anywhere to grant admin access — it's a manual database step only.
3. Fill in `config.js` with the Accounts project's URL and anon key (same values the main app uses).
4. `npm install`.

## Environment variables (Vercel)

| Variable | From |
|---|---|
| `SUPABASE_ACCOUNTS_URL` | Accounts project → Project Settings → API → Project URL |
| `SUPABASE_ACCOUNTS_ANON_KEY` | Accounts project → Project Settings → API → anon/public key |
| `SUPABASE_ACCOUNTS_SERVICE_KEY` | Accounts project → Project Settings → API → **service_role** key (secret) |
| `SUPABASE_APPDATA_URL` | App Data project → Project Settings → API → Project URL |
| `SUPABASE_APPDATA_SERVICE_KEY` | App Data project → Project Settings → API → **service_role** key (secret) |

## Run locally / deploy

Same as the main app:

```sh
npm install
npx vercel dev   # local
npx vercel        # deploy
```

Deploy this as its **own** Vercel project, not as part of the main app's project, and put it on a domain or subdomain you don't advertise publicly.
