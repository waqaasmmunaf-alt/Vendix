(async () => {
  const session = await requireAuth();
  if (!session) return;
  const profile = await getCurrentProfile();
  renderLayout('manage-uploads', profile);

  if (profile.role !== 'admin') {
    document.querySelector('.main-content').innerHTML = '<div class="alert-error">Admin access only.</div>';
    return;
  }

  const errorBox = document.getElementById('error-box');
  const successBox = document.getElementById('success-box');

  function showError(msg) {
    successBox.style.display = 'none';
    errorBox.textContent = msg;
    errorBox.style.display = 'block';
  }
  function showSuccess(msg) {
    errorBox.style.display = 'none';
    successBox.textContent = msg;
    successBox.style.display = 'block';
  }

  const typeLabels = { ops_export: 'Sales File', activation_check: 'Activation Check', combined_report: 'Combined Report' };

  async function load() {
    const { data, error } = await supabaseClient
      .from('upload_batches')
      .select('*, profiles(name)')
      .order('uploaded_at', { ascending: false });

    if (error) { showError(error.message); return; }

    document.getElementById('table-body').innerHTML = data.map((b) => `
      <tr>
        <td>${escapeHtml(b.file_name)}</td>
        <td>${typeLabels[b.upload_type] || b.upload_type}</td>
        <td>${escapeHtml(b.profiles?.name || 'Unknown')}</td>
        <td>${new Date(b.uploaded_at).toLocaleString()}</td>
        <td>${b.row_count}</td>
        <td>${b.new_count ?? '—'}</td>
        <td>${b.duplicate_count ?? '—'}</td>
        <td><button class="btn-link-danger" data-id="${b.id}" data-type="${b.upload_type}">Delete Permanently</button></td>
      </tr>
    `).join('') || '<tr><td colspan="8" class="empty-state">No uploads yet</td></tr>';

    document.querySelectorAll('.btn-link-danger').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const type = btn.dataset.type;
        const warning = type === 'activation_check'
          ? 'This will revert those records back to Unactivated (the underlying sale records are NOT deleted). Continue?'
          : 'This will PERMANENTLY delete every record created by this upload. This cannot be undone. Continue?';
        if (!confirm(warning)) return;

        const { data, error } = await supabaseClient.rpc('hard_delete_batch', { p_batch_id: id });
        if (error) { showError(error.message); return; }
        showSuccess(`Done — ${data.recordsAffected} record(s) affected.`);
        load();
      });
    });
  }

  document.getElementById('delete-all-btn').addEventListener('click', async () => {
    const typed = prompt('This permanently deletes ALL uploaded IMEI records and upload history. Customers and settings are kept. Type DELETE ALL to confirm:');
    if (typed !== 'DELETE ALL') {
      if (typed !== null) showError('Confirmation text did not match — nothing was deleted.');
      return;
    }
    const { data, error } = await supabaseClient.rpc('hard_delete_all_uploads');
    if (error) { showError(error.message); return; }
    showSuccess(`Deleted ${data.recordsDeleted} record(s) across ${data.batchesDeleted} upload(s).`);
    load();
  });

  load();
})();
