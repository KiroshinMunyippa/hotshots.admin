import { verifyAdmin, accountsAdmin } from '../../../lib/verifyAdmin.js';

export default async function handler(req, res) {
  const admin = await verifyAdmin(req);
  if (!admin) return res.status(403).json({ error: 'Admin access required' });

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
