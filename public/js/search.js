(async () => {
  const session = await requireAuth();
  if (!session) return;
  const profile = await getCurrentProfile();
  renderLayout('search', profile);

  const errorBox = document.getElementById('error-box');
  const results = document.getElementById('results');

  document.getElementById('search-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.style.display = 'none';
    results.innerHTML = '<div class="loading">Searching...</div>';

    const imei = document.getElementById('imei-input').value.trim();

    const { data, error } = await supabaseClient
      .from('imei_records')
      .select(`
        *, customers(name, rtm_categories(name)),
        upload_batch:upload_batches!imei_records_upload_batch_id_fkey(file_name, uploaded_at),
        activation_batch:upload_batches!imei_records_activation_batch_id_fkey(file_name, uploaded_at)
      `)
      .eq('imei1', imei)
      .order('created_at', { ascending: false });

    if (error) {
      errorBox.textContent = error.message;
      errorBox.style.display = 'block';
      results.innerHTML = '';
      return;
    }

    if (!data.length) {
      results.innerHTML = '<div class="alert-error">No records found for this IMEI</div>';
      return;
    }

    results.innerHTML = data.map((r) => `
      <div class="result-card">
        <h3>IMEI: ${escapeHtml(r.imei1)}</h3>
        <div class="detail-grid">
          <div><strong>Status:</strong> <span class="badge badge-${r.status}">${r.status}</span></div>
          <div><strong>Customer:</strong> ${escapeHtml(r.customers?.name)}</div>
          <div><strong>RTM Category:</strong> ${escapeHtml(r.customers?.rtm_categories?.name || 'Uncategorized')}</div>
          <div><strong>Location:</strong> ${escapeHtml(r.location)}</div>
          <div><strong>Description:</strong> ${escapeHtml(r.description)}</div>
          <div><strong>Shipment Date:</strong> ${r.date_of_shipment || '—'}</div>
          <div><strong>Apple Week / Qtr / Year (Shipment):</strong> ${escapeHtml(r.apple_week) || '—'} / ${escapeHtml(r.apple_qtr) || '—'} / ${escapeHtml(r.apple_year) || '—'}</div>
          <div><strong>Uploaded via:</strong> ${escapeHtml(r.upload_batch?.file_name)} (${r.upload_batch?.uploaded_at ? r.upload_batch.uploaded_at.slice(0, 10) : '—'})</div>
          <div><strong>Activated Date:</strong> ${r.activated_date || '—'}</div>
          <div><strong>Apple Week / Qtr / Year (Activation):</strong> ${escapeHtml(r.activated_apple_week) || '—'} / ${escapeHtml(r.activated_apple_qtr) || '—'} / ${escapeHtml(r.activated_apple_year) || '—'}</div>
          <div><strong>Activation file:</strong> ${escapeHtml(r.activation_batch?.file_name) || '—'}</div>
          <div><strong>Remark:</strong> ${escapeHtml(r.activation_remark) || '—'}</div>
          <div><strong>Duplicate flag:</strong> ${r.is_duplicate ? 'Yes' : 'No'}</div>
        </div>
      </div>
    `).join('');
  });
})();
