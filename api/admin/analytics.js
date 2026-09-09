import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Initialize Supabase clients
  const accounts = createClient(
    process.env.SUPABASE_ACCOUNTS_URL, 
    process.env.SUPABASE_ACCOUNTS_SERVICE_KEY
  );
  const appdata = createClient(
    process.env.SUPABASE_APPDATA_URL, 
    process.env.SUPABASE_APPDATA_SERVICE_KEY
  );

  try {
    // 🔒 SECURITY CHECK: Verify the user's authentication token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: Missing token' });
    }
    
    const token = authHeader.split(' ')[1];
    
    // Verify token and get user
    const { data: { user }, error: authError } = await accounts.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }

    //  SECURITY CHECK: Verify the user is an admin
    const { data: profile, error: profileError } = await accounts
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single();

    if (profileError || !profile?.is_admin) {
      return res.status(403).json({ error: 'Forbidden: Admin access required' });
    }

    // ✅ Fetch Analytics Data
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

    // Return analytics data
    res.status(200).json({ 
      totalUsers, 
      recentSignups: recentSignups || 0, 
      planDist, 
      catDist 
    });

  } catch (error) {
    console.error('Analytics API Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
