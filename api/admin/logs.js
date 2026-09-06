import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const accounts = createClient(
    process.env.SUPABASE_ACCOUNTS_URL,
    process.env.SUPABASE_ACCOUNTS_SERVICE_KEY
  );

  try {
    // Fetch recent audit logs (DB changes)
    const { data: auditLogs, error: auditError } = await accounts
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);

    // Fetch recent new accounts
    const { data: newProfiles, error: profileError } = await accounts
      .from('profiles')
      .select('id, display_name, email, created_at')
      .order('created_at', { ascending: false })
      .limit(20);

    if (auditError) throw auditError;
    if (profileError) throw profileError;

    const events = [];

    if (auditLogs) {
      auditLogs.forEach(log => {
        events.push({
          type: 'db',
          label: 'Database Change',
          message: `${log.action} on ${log.target_type}`,
          detail: log.admin_email || 'System',
          time: log.created_at
        });
      });
    }

    if (newProfiles) {
      newProfiles.forEach(profile => {
        events.push({
          type: 'user',
          label: 'New Account',
          message: `${profile.display_name} joined`,
          detail: profile.email,
          time: profile.created_at
        });
      });
    }

    events.sort((a, b) => new Date(b.time) - new Date(a.time));

    res.status(200).json(events.slice(0, 30));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
