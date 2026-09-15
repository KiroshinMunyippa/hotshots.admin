import { verifyAdmin, accountsAdmin } from '../../../lib/verifyAdmin.js';
import { appData } from '../../../lib/appData.js';
import { logAudit } from '../../../lib/logAudit.js';

export default async function handler(req, res) {
  const admin = await verifyAdmin(req);
  if (!admin) return res.status(403).json({ error: 'Admin access required' });

  // Handle /api/admin/users (no ID) - list users
  if (!req.query.id) {
    if (req.method === 'GET') {
      const { data, error } = await accountsAdmin
        .from('profiles')
        .select('id, display_name, email, subscription_plan, subscription_status, is_admin, created_at')
        .order('created_at', { ascending: false });
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ users: data });
    }
    res.setHeader('Allow', 'GET');
    return res.status(405).end();
  }

  // Handle /api/admin/users/[id] - update specific user
  const { id } = req.query;
  
  if (req.method === 'PATCH') {
    try {
      const { subscription_plan, subscription_status } = req.body;
      const { data, error } = await accountsAdmin
        .from('profiles')
        .update({ subscription_plan, subscription_status, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      
      await logAudit('Admin', 'Updated User', { userId: id, subscription_plan, subscription_status });
      
      return res.status(200).json({ user: data });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }
  
  res.setHeader('Allow', 'PATCH');
  return res.status(405).end();
}
