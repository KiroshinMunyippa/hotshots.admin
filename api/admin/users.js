import { logAudit } from '../../lib/logAudit.js';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabase = createClient(
    process.env.SUPABASE_ACCOUNTS_URL,
    process.env.SUPABASE_ACCOUNTS_SERVICE_KEY
  );

  try {
    const { data: users, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.status(200).json({ users });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

  if (req.method === 'PATCH') {
    const { id } = req.query; // or however you get the user ID
    const { subscription_plan, subscription_status } = req.body;
    
    // ... your existing update logic ...
    const { data: user, error } = await accounts.from('profiles')
      .update({ subscription_plan, subscription_status })
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    // 👇 ADD THIS LOGGING LINE 👇
    await logAudit(req.body.admin_email, 'Updated User', { userId: id, newPlan: subscription_plan, newStatus: subscription_status });

    return res.status(200).json({ user });
  }
