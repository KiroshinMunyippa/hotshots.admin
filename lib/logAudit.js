import { createClient } from '@supabase/supabase-js';

export async function logAudit(adminEmail, action, details) {
  const accounts = createClient(
    process.env.SUPABASE_ACCOUNTS_URL, 
    process.env.SUPABASE_ACCOUNTS_SERVICE_KEY
  );

  try {
    // First, get the admin's user ID from their email
    const { data: profile } = await accounts
      .from('profiles')
      .select('id')
      .eq('email', adminEmail)
      .single();

    const adminId = profile?.id || null;

    // Insert the audit log
    const { error } = await accounts.from('audit_logs').insert({
      admin_id: adminId,
      admin_email: adminEmail,
      action: action,
      details: JSON.stringify(details)
    });

    if (error) {
      console.error('Audit log insert error:', error);
      throw error;
    }
  } catch (error) {
    console.error('Failed to write audit log:', error);
  }
}
