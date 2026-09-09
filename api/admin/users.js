// import { logAudit } from './logAudit.js';  <-- COMMENT THIS OUT
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  const supabase = createClient(
    process.env.SUPABASE_ACCOUNTS_URL,
    process.env.SUPABASE_ACCOUNTS_SERVICE_KEY
  );

  if (req.method === 'GET') {
    try {
      const { data: users, error } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return res.status(200).json({ users });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  if (req.method === 'PATCH') {
    const { id } = req.query;
    const { subscription_plan, subscription_status, admin_email } = req.body;
    
    try {
      const { data: user, error } = await supabase
        .from('profiles')
        .update({ subscription_plan, subscription_status })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      // await logAudit(admin_email || 'Admin', 'Updated User', {  <-- COMMENT THIS OUT
      //   userId: id, 
      //   newPlan: subscription_plan, 
      //   newStatus: subscription_status 
      // });

      return res.status(200).json({ user });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
