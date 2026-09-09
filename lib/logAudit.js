import { createClient } from '@supabase/supabase-js';

export async function logAudit(adminEmail, action, details) {
  const accounts = createClient(
    process.env.SUPABASE_ACCOUNTS_URL, 
    process.env.SUPABASE_ACCOUNTS_SERVICE_KEY
  );

  console.log('📝 logAudit called with:', { adminEmail, action, details });

  try {
    // Try to get admin_id from email
    let adminId = null;
    if (adminEmail && adminEmail !== 'Admin') {
      const { data: profile, error: profileError } = await accounts
        .from('profiles')
        .select('id')
        .eq('email', adminEmail)
        .single();
      
      if (profileError) {
        console.warn('Could not find profile for email:', adminEmail, profileError);
      } else {
        adminId = profile?.id || null;
      }
    }

    console.log('Inserting audit log with adminId:', adminId);

    // Insert the audit log
    const { data, error } = await accounts.from('audit_logs').insert({
      admin_id: adminId,
      admin_email: adminEmail,
      action: action,
      details: JSON.stringify(details)
    }).select();

    if (error) {
      console.error('❌ Audit log insert failed:', error);
      throw error;
    }

    console.log('✅ Audit log inserted successfully:', data);
  } catch (error) {
    console.error('❌ Failed to write audit log:', error.message);
    // Don't throw - we don't want to break the main action
  }
}
