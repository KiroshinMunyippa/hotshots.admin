import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const accounts = createClient(process.env.SUPABASE_ACCOUNTS_URL, process.env.SUPABASE_ACCOUNTS_SERVICE_KEY);
  const appdata = createClient(process.env.SUPABASE_APPDATA_URL, process.env.SUPABASE_APPDATA_SERVICE_KEY);

  try {
    const { data: users } = await accounts.from('profiles').select('subscription_plan');
    const totalUsers = users?.length || 0;
    const planDist = users?.reduce((acc, u) => {
      acc[u.subscription_plan] = (acc[u.subscription_plan] || 0) + 1;
      return acc;
    }, {}) || {};

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const { count: recentSignups } = await accounts
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', thirtyDaysAgo.toISOString());

    const { data: recipes } = await appdata.from('recipes').select('category');
    const catDist = recipes?.reduce((acc, r) => {
      acc[r.category] = (acc[r.category] || 0) + 1;
      return acc;
    }, {}) || {};

    res.status(200).json({ totalUsers, recentSignups: recentSignups || 0, planDist, catDist });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
