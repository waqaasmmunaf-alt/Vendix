(async () => {
  const session = await requireAuth();
  if (!session) return;
  const profile = await getCurrentProfile();
  renderLayout('audit-log', profile);

  if (profile.role !== 'admin') {
    document.querySelector('.main-content').innerHTML = '<div class="alert-error">Admin access only.</div>';
    return;
  }

  const { data, error } = await supabaseClient
    .from('activity_log')
    .select('*, profiles(name, email:id)')
    .order('created_at', { ascending: false })
    .limit(200);

  const errorBox = document.getElementById('error-box');
  if (error) {
    errorBox.textContent = error.message;
    errorBox.style.display = 'block';
    return;
  }

  document.getElementById('table-body').innerHTML = data.map((l) => `
    <tr>
      <td>${new Date(l.created_at).toLocaleString()}</td>
      <td>${escapeHtml(l.profiles?.name || 'Unknown')}</td>
      <td>${l.action}</td>
      <td>${l.target_table} ${l.target_id ? `#${l.target_id}` : ''}</td>
      <td><code class="details-json">${escapeHtml(JSON.stringify(l.details))}</code></td>
    </tr>
  `).join('') || '<tr><td colspan="5" class="empty-state">No activity yet</td></tr>';
})();
