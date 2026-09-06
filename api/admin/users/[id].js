// Add this helper function at the top of each file
async function logAudit(accounts, adminId, adminEmail, action, targetType, targetId, details) {
  await accounts.from('audit_logs').insert({
    admin_id: adminId,
    admin_email: adminEmail,
    action,
    target_type: targetType,
    target_id: targetId,
    details
  });
}

import { verifyAdmin, accountsAdmin } from '../../../lib/verifyAdmin.js';

const PLANS = ['free', 'plus', 'pro'];
const STATUSES = ['active', 'trialing', 'past_due', 'canceled'];

export default async function handler(req, res) {
  if (req.method !== 'PATCH') { res.setHeader('Allow', 'PATCH'); return res.status(405).end(); }
  await logAudit(accounts, adminUser.id, adminUser.email, 'update_user', 'user', id, { subscription_plan, subscription_status });
  const admin = await verifyAdmin(req);
  if (!admin) return res.status(403).json({ error: 'Admin access required' });

  const { subscription_plan, subscription_status } = req.body || {};
  const updates = {};
  if (subscription_plan !== undefined) {
    if (!PLANS.includes(subscription_plan)) return res.status(400).json({ error: 'Invalid plan' });
    updates.subscription_plan = subscription_plan;
  }
  if (subscription_status !== undefined) {
    if (!STATUSES.includes(subscription_status)) return res.status(400).json({ error: 'Invalid status' });
    updates.subscription_status = subscription_status;
  }
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' });
  updates.updated_at = new Date().toISOString();

  const { data, error } = await accountsAdmin.from('profiles').update(updates).eq('id', req.query.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ user: data });
}
