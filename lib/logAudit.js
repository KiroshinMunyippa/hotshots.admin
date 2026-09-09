import { createClient } from '@supabase/supabase-js';

export async function logAudit(adminEmail, action, details) {
  const accounts = createClient(
    process.env.SUPABASE_ACCOUNTS_URL, 
    process.env.SUPABASE_ACCOUNTS_SERVICE_KEY
  );

  try {
    await accounts.from('audit_logs').insert({
      admin_email: adminEmail,
      action: action,
      details: JSON.stringify(details) // Converts the details object into text for the database
    });
  } catch (error) {
    // If logging fails, we don't want to break the main action, so just log to console
    console.error('Failed to write audit log:', error);
  }
}
