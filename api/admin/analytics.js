import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  
  const accounts = createClient(process.env.SUPABASE_ACCOUNTS_URL, process.env.SUPABASE_ACCOUNTS_SERVICE_KEY);
  const appdata = createClient(process.env.SUPABASE_APPDATA_URL, process.env.SUPABASE_APPDATA_SERVICE_KEY);

  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const { data: signups } = await accounts.from('profiles').select('created_at').gte('created_at', thirtyDaysAgo.toISOString());
    const { data: plans } = await accounts.from('profiles').select('subscription_plan');
    const { data: recipes } = await appdata.from('recipes').select('category, shared');

    res.status(200).json({
      signupsLast30Days: signups?.length || 0,
      planDistribution: plans?.reduce((acc, p) => { acc[p.subscription_plan] = (acc[p.subscription_plan] || 0) + 1; return acc; }, {}) || {},
      recipesByCategory: recipes?.reduce((acc, r) => { acc[r.category] = (acc[r.category] || 0) + 1; return acc; }, {}) || {},
      sharedRecipes: recipes?.filter(r => r.shared).length || 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
