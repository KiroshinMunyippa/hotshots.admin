import { verifyAdmin, accountsAdmin } from '../../lib/verifyAdmin.js';
import { appData } from '../../lib/appData.js';

export default async function handler(req, res) {
  const admin = await verifyAdmin(req);
  if (!admin) return res.status(403).json({ error: 'Admin access required' });
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).end(); }

  const [{ count: userCount }, { count: recipeCount }, { count: sharedCount }, { count: paidCount }] = await Promise.all([
    accountsAdmin.from('profiles').select('id', { count: 'exact', head: true }),
    appData.from('recipes').select('id', { count: 'exact', head: true }),
    appData.from('recipes').select('id', { count: 'exact', head: true }).eq('is_shared', true),
    accountsAdmin.from('profiles').select('id', { count: 'exact', head: true }).neq('subscription_plan', 'free')
  ]);

  return res.status(200).json({ users: userCount || 0, recipes: recipeCount || 0, shared: sharedCount || 0, paid: paidCount || 0 });
}
