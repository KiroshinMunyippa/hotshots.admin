import { verifyAdmin, accountsAdmin } from '../../../lib/verifyAdmin.js';
import { logAudit } from '../logAudit.js';

export default async function handler(req, res) {
  const admin = await verifyAdmin(req);
  if (!admin) return res.status(403).json({ error: 'Admin access required' });

  const { id } = req.query;

  if (req.method === 'PATCH') {
    try {
      const { subscription_plan, subscription_status } = req.body || {};
      // Only send the fields that were actually provided, so a partial update
      // doesn't blank out the other one.
      const updates = Object.fromEntries(
        Object.entries({ subscription_plan, subscription_status }).filter(([, v]) => v !== undefined)
      );
      if (!Object.keys(updates).length) {
        return res.status(400).json({ error: 'Nothing to update' });
      }

      // Grab the current values first so the audit entry can show what changed
      // (e.g. "Plan: Free -> Plus") rather than just the new payload.
      const { data: before } = await accountsAdmin
        .from('profiles')
        .select('email, subscription_plan, subscription_status')
        .eq('id', id)
        .maybeSingle();

      const { data, error } = await accountsAdmin
        .from('profiles')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;

      // Record the account change in the audit trail (best-effort).
      await logAudit(admin.email, 'user_updated', {
        userId: id,
        email: data.email || before?.email || null,
        changes: updates,
        previous: before ? {
          subscription_plan: before.subscription_plan,
          subscription_status: before.subscription_status
        } : null
      });
      res.status(200).json({ user: data });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}
