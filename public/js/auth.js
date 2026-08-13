// Shared auth helpers. Include supabaseClient.js before this on every page.

async function requireAuth() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    window.location.href = 'login.html';
    return null;
  }
  return session;
}

async function getCurrentProfile() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return null;
  const { data, error } = await supabaseClient
    .from('profiles')
    .select('*')
    .eq('id', session.user.id)
    .single();
  if (error) {
    console.error('Failed to load profile', error);
    return null;
  }
  return { ...data, email: session.user.email };
}

async function logout() {
  await supabaseClient.auth.signOut();
  window.location.href = 'login.html';
}

async function logActivity(action, targetTable, targetId, details) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return;
  await supabaseClient.from('activity_log').insert({
    user_id: session.user.id,
    action,
    target_table: targetTable,
    target_id: targetId ? String(targetId) : null,
    details: details || null
  });
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
