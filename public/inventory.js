(async () => {
  const session = await requireAuth();
  if (!session) return;
  const profile = await getCurrentProfile();
  renderLayout('inventory', profile);
  const isAdmin = profile.role === 'admin';

  const PAGE_SIZE = 100;
  let page = 0;
  let total = 0;

  const statusEl = document.getElementById('filter-status');
  const searchEl = document.getElementById('filter-search');
  const dupEl = document.getElementById('filter-duplicate');
  const tbody = document.getElementById('table-body');
  const errorBox = document.getElementById('error-box');
  const pageInfo = document.getElementById('page-info');
  const prevBtn = document.getElementById('prev-btn');
  const nextBtn = document.getElementById('next-btn');

  function buildQuery(withRange = true) {
    let q = supabaseClient
      .from('imei_records')
      .select('id, imei1, location, date_of_shipment, status, activated_date, is_duplicate, apple_week, apple_qtr, apple_year, activated_apple_week, activated_apple_qtr, activated_apple_year, customers(name, rtm_categories(name))', { count: 'exact' })
      .is('deleted_at', null)
      .order('date_of_shipment', { ascending: false, nullsFirst: false });

    if (statusEl.value) q = q.eq('status', statusEl.value);
    if (dupEl.value === 'true') q = q.eq('is_duplicate', true);
    if (searchEl.value.trim()) q = q.or(`imei1.ilike.%${searchEl.value.trim()}%,serial_no.ilike.%${searchEl.value.trim()}%`);
    if (withRange) q = q.range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    return q;
  }

  async function loadRecords() {
    errorBox.style.display = 'none';
    const { data, error, count } = await buildQuery(true);
    if (error) {
      errorBox.textContent = error.message;
      errorBox.style.display = 'block';
      return;
    }
    total = count || 0;

    tbody.innerHTML = data.map((r) => `
      <tr class="${r.is_duplicate ? 'row-flagged' : ''}">
        <td>${escapeHtml(r.imei1)}</td>
        <td>${escapeHtml(r.customers?.name || '')}</td>
        <td>${escapeHtml(r.customers?.rtm_categories?.name || 'Uncategorized')}</td>
        <td>${escapeHtml(r.location)}</td>
        <td>${r.date_of_shipment || ''}</td>
        <td>${r.apple_week ? escapeHtml(r.apple_week) + ' / ' + escapeHtml(r.apple_qtr) : '—'}</td>
        <td><span class="badge badge-${r.status}">${r.status}</span></td>
        <td>${r.activated_date || '—'}</td>
        <td>${r.is_duplicate ? 'Yes' : ''}</td>
        <td>${isAdmin ? `<button class="btn-link-danger" data-id="${r.id}">Delete</button>` : ''}</td>
      </tr>
    `).join('') || '<tr><td colspan="9" class="empty-state">No records match this filter</td></tr>';

    const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
    pageInfo.textContent = `Page ${page + 1} of ${totalPages} (${total} records)`;
    prevBtn.disabled = page <= 0;
    nextBtn.disabled = page + 1 >= totalPages;

    tbody.querySelectorAll('.btn-link-danger').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Move this record to Trash?')) return;
        const id = btn.dataset.id;
        const { error: delErr } = await supabaseClient
          .from('imei_records')
          .update({ deleted_at: new Date().toISOString(), deleted_by: session.user.id })
          .eq('id', id);
        if (delErr) { alert(delErr.message); return; }
        await logActivity('delete', 'imei_records', id, {});
        loadRecords();
      });
    });
  }

  [statusEl, dupEl].forEach((el) => el.addEventListener('change', () => { page = 0; loadRecords(); }));
  let searchTimeout;
  searchEl.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => { page = 0; loadRecords(); }, 400);
  });
  prevBtn.addEventListener('click', () => { if (page > 0) { page--; loadRecords(); } });
  nextBtn.addEventListener('click', () => { page++; loadRecords(); });

  document.getElementById('export-btn').addEventListener('click', async () => {
    const btn = document.getElementById('export-btn');
    btn.disabled = true;
    btn.textContent = 'Preparing export...';
    try {
      const { data, error } = await buildQuery(false).limit(50000);
      if (error) throw new Error(error.message);
      if (!data.length) { alert('No records match this filter'); return; }

      const rows = data.map((r) => ({
        'IMEI 1': r.imei1,
        'Location': r.location,
        'Date of Shipment': r.date_of_shipment,
        'Apple Week (Shipment)': r.apple_week,
        'Apple Qtr (Shipment)': r.apple_qtr,
        'Apple Year (Shipment)': r.apple_year,
        'Customer': r.customers?.name || '',
        'RTM Category': r.customers?.rtm_categories?.name || 'Uncategorized',
        'Status': r.status,
        'Activated Date': r.activated_date || '',
        'Apple Week (Activation)': r.activated_apple_week || '',
        'Apple Qtr (Activation)': r.activated_apple_qtr || '',
        'Apple Year (Activation)': r.activated_apple_year || '',
        'Duplicate Flag': r.is_duplicate
      }));

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'IMEI Export');
      XLSX.writeFile(wb, `imei_export_${Date.now()}.xlsx`);
      await logActivity('export', 'imei_records', null, { rowCount: rows.length });
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Export to Excel';
    }
  });

  loadRecords();
})();
