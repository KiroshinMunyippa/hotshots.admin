# Getting the Admin portal working — step by step

This assumes you've already got the main HotShots app's two Supabase projects (Accounts + App Data) set up and running, as in the main project's `GETTING-STARTED.md`. This portal reuses both — you're not creating new databases.

## 1. Add the admin flag

1. Open the **Accounts** Supabase project (the same one the main app uses) in the SQL Editor.
2. Paste in and run `db/add-admin-flag.sql`.

## 2. Make yourself an admin

1. If you don't already have a HotShots account, sign up for one through the main app first (guest mode doesn't count — it needs a real account row in `profiles`).
2. Back in the Accounts project's SQL Editor, run:
   ```sql
   update public.profiles set is_admin = true where email = 'you@example.com';
   ```
   using the email you signed up with.

## 3. Put this project on GitHub

Same as the main app — this is a **separate repository** from HotShots itself:

```sh
git init
git add .
git commit -m "HotShots admin"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/hotshots-admin.git
git push -u origin main
```

## 4. Fill in the public config

Open `config.js` and paste in the same `SUPABASE_ACCOUNTS_URL` and anon key you used in the main app's `config.js` — this project talks to the same Accounts project.

## 5. Try it locally

```sh
npm install
npx vercel dev
```

Create a `.env` file (never commit this) with all five variables:

```
SUPABASE_ACCOUNTS_URL=https://xxxxxxxx.supabase.co
SUPABASE_ACCOUNTS_ANON_KEY=eyJ...
SUPABASE_ACCOUNTS_SERVICE_KEY=eyJ...
SUPABASE_APPDATA_URL=https://yyyyyyyy.supabase.co
SUPABASE_APPDATA_SERVICE_KEY=eyJ...
```

Restart `vercel dev`, open the local URL, and sign in with the account you flagged as admin in step 2. You should land on the Users table with a stat strip at the top.

## 6. Deploy

1. In Vercel, **Add New → Project**, import the `hotshots-admin` repo — this should be a **separate Vercel project** from the main HotShots app, not a second deployment target on the same one.
2. Add all five environment variables under **Settings → Environment Variables** before deploying.
3. Deploy. Consider putting it on a subdomain you don't link to from the public site (e.g. `admin.yourdomain.com`) rather than something guessable like `hotshots-admin.vercel.app`.

## 7. Sanity-check it

- Sign in with your admin account — you should see the dashboard, not the "not an admin" screen.
- Sign in with (or sign up as) a non-admin account — confirm you get the "not an admin account" message and can only sign out from there.
- On the Users tab, change a plan/status dropdown and hit Save; refresh and confirm it stuck.
- On the Recipes tab, hide a shared recipe, then check it disappeared from Explore in the main app; unhide it and confirm it reappears.
- Delete a test recipe and confirm it's gone from both the admin list and the main app.

## A note on safety

There's no "make me an admin" button anywhere in either app, on purpose — it's a manual SQL step so nobody can grant themselves access even if they found a way to call the API directly. Keep the list of who has `is_admin = true` short, and don't share the admin site's URL outside the people who need it.
