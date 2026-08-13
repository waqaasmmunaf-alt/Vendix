(async () => {
  const session = await requireAuth();
  if (!session) return;
  const profile = await getCurrentProfile();
  renderLayout('trash', profile);

  if (profile.role !== 'admin') {
    document.querySelector('.main-content').innerHTML = '<div class="alert-error">Admin access only.</div>';
    return;
  }

  const tbody = document.getElementById('table-body');
  const errorBox = document.getElementById('error-box');

  async function load() {
    const { data, error } = await supabaseClient
      .from('imei_records')
      .select('id, imei1, status, deleted_at')
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false })
      .limit(500);

    if (error) {
      errorBox.textContent = error.message;
      errorBox.style.display = 'block';
      return;
    }

    tbody.innerHTML = data.map((r) => `
      <tr>
        <td>${escapeHtml(r.imei1)}</td>
        <td>${r.status}</td>
        <td>${new Date(r.deleted_at).toLocaleString()}</td>
        <td><button class="btn-link" data-id="${r.id}">Restore</button></td>
      </tr>
    `).join('') || '<tr><td colspan="4" class="empty-state">Trash is empty</td></tr>';

    tbody.querySelectorAll('.btn-link').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const { error: restoreErr } = await supabaseClient
          .from('imei_records')
          .update({ deleted_at: null, deleted_by: null })
          .eq('id', id);
        if (restoreErr) { alert(restoreErr.message); return; }
        await logActivity('restore', 'imei_records', id, {});
        load();
      });
    });
  }

  load();
})();
