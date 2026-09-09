import { createClient } from '@supabase/supabase-js';

export async function logAudit(adminEmail, action, details) {
  console.log('🔍 [logAudit] Function called for action:', action);
  
  const accounts = createClient(
    process.env.SUPABASE_ACCOUNTS_URL, 
    process.env.SUPABASE_ACCOUNTS_SERVICE_KEY
  );

  const { data, error } = await accounts.from('audit_logs').insert({
    admin_email: adminEmail || 'Unknown Admin',
    action: action,
    details: JSON.stringify(details)
  }).select();

  if (error) {
    console.error('❌ [logAudit] SUPABASE ERROR:', error.message, error.details);
  } else {
    console.log('✅ [logAudit] Audit log inserted successfully:', data);
  }
}
