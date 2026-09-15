import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const accounts = createClient(process.env.SUPABASE_ACCOUNTS_URL, process.env.SUPABASE_ACCOUNTS_SERVICE_KEY, {
    realtime: { transport: ws }
  });
  const appdata = createClient(process.env.SUPABASE_APPDATA_URL, process.env.SUPABASE_APPDATA_SERVICE_KEY, {
    realtime: { transport: ws }
  });

  try {
    const [{ count: users }, { count: paid }, { count: recipes }, { count: shared }] = await Promise.all([
      accounts.from('profiles').select('*', { count: 'exact', head: true }),
      accounts.from('profiles').select('*', { count: 'exact', head: true }).in('subscription_plan', ['plus', 'pro']),
      appdata.from('recipes').select('*', { count: 'exact', head: true }),
      appdata.from('recipes').select('*', { count: 'exact', head: true }).eq('is_shared', true)
    ]);

    res.status(200).json({
      users: users || 0,
      paid: paid || 0,
      recipes: recipes || 0,
      shared: shared || 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
