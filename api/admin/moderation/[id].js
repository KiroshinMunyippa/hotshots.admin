import { verifyAdmin } from '../../../lib/verifyAdmin.js';
import { appData } from '../../../lib/appData.js';
import { logAudit } from '../logAudit.js';

export default async function handler(req, res) {
  const admin = await verifyAdmin(req);
  if (!admin) return res.status(403).json({ error: 'Admin access required' });
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

  const { id } = req.query;
  const { status } = req.body || {};
  if (!status) return res.status(400).json({ error: 'Missing status' });

  try {
    const { data, error } = await appData.from('recipe_reports').update({ status }).eq('id', id).select().single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Report not found' });

    await logAudit(admin.email, 'report_status_changed', { reportId: id, status });
    res.status(200).json({ report: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
