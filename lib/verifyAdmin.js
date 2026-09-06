import { createClient } from '@supabase/supabase-js';

// Two different Accounts-project clients, on purpose:
// - `accountsAuth` (anon key) only ever asks "is this token valid, and whose is it?"
// - `accountsAdmin` (service key) is the only thing allowed to read someone else's
//   `is_admin` flag, since Row Level Security on `profiles` only lets a user read
//   their own row.
const accountsAuth = createClient(process.env.SUPABASE_ACCOUNTS_URL, process.env.SUPABASE_ACCOUNTS_ANON_KEY);
export const accountsAdmin = createClient(process.env.SUPABASE_ACCOUNTS_URL, process.env.SUPABASE_ACCOUNTS_SERVICE_KEY, {
  auth: { persistSession: false }
});

export async function verifyAdmin(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;

  const { data, error } = await accountsAuth.auth.getUser(token);
  if (error || !data?.user) return null;

  const { data: profile } = await accountsAdmin.from('profiles').select('is_admin, display_name, email').eq('id', data.user.id).single();
  if (!profile?.is_admin) return null;

  return { id: data.user.id, ...profile };
}
