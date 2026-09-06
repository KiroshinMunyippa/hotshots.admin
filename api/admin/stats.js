import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const accounts = createClient(
    process.env.SUPABASE_ACCOUNTS_URL,
    process.env.SUPABASE_ACCOUNTS_SERVICE_KEY
  );

  const appdata = createClient(
    process.env.SUPABASE_APPDATA_URL,
    process.env.SUPABASE_APPDATA_SERVICE_KEY
  );

  try {
    const [{ count: users }, { count: recipes }, { count: shared }, { count: paid }] = await Promise.all([
      accounts.from('profiles').select('*', { count: 'exact', head: true }),
      appdata.from('recipes').select('*', { count: 'exact', head: true }),
      appdata.from('recipes').select('*', { count: 'exact', head: true }).eq('is_shared', true),
      accounts.from('profiles').select('*', { count: 'exact', head: true }).in('subscription_plan', ['plus', 'pro'])
    ]);

    res.status(200).json({
      users: users || 0,
      recipes: recipes || 0,
      shared: shared || 0,
      paid: paid || 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
