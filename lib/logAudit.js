import { createClient } from '@supabase/supabase-js';

export async function logAudit(adminEmail, action, details) {
  const accounts = createClient(
    process.env.SUPABASE_ACCOUNTS_URL, 
    process.env.SUPABASE_ACCOUNTS_SERVICE_KEY
  );

  console.log('🔍 Attempting to log audit for:', action);

  const { data, error } = await accounts.from('audit_logs').insert({
    admin_email: adminEmail || 'Unknown Admin',
    action: action,
    details: JSON.stringify(details)
  }).select();

  if (error) {
    console.error('❌ SUPABASE ERROR:', error.message, error.details);
  } else {
    console.log('✅ Audit log inserted:', data);
  }
}
