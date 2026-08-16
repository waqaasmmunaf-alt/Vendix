// PSI Pivot — live, interactive Excel-style pivot table over the flat
// feed from get_psi_pivot_data(). Uses pivottable.js ($.pivotUI) so the
// user can drag Source / LOB / Sub LOB / Part No / Location / Period
// into Rows, Columns, and Values themselves, right in the browser.
(async () => {
  const session = await requireAuth();
  if (!session) return;
  const profile = await getCurrentProfile();
  renderLayout('psi-pivot', profile);

  const errorBox = document.getElementById('error-box');
  const contentBox = document.getElementById('psi-pivot-content');
  const pivotOutput = document.getElementById('pivot-output');
  let period = 'all';

  async function loadPivot() {
    errorBox.style.display = 'none';
    contentBox.innerHTML = '<div class="loading">Loading pivot data...</div>';
    pivotOutput.innerHTML = '';

    const { data, error } = await supabaseClient.rpc('get_psi_pivot_data', { p_period: period });

    if (error) {
      errorBox.textContent = error.message;
      errorBox.style.display = 'block';
      contentBox.innerHTML = '';
      return;
    }

    if (!data || !data.length) {
      contentBox.innerHTML = '<div class="panel pro-panel"><p class="empty-state">No PSI data uploaded yet — see PSI Files uploads.</p></div>';
      return;
    }

    contentBox.innerHTML = `<p class="page-subtitle">${data.length.toLocaleString()} rows loaded — drag fields below to build your view.</p>`;

    // Reshape for pivottable.js: friendly field names, one flat record per row.
    const records = data.map((r) => ({
      Source: r.source,
      LOB: r.lob,
      'Sub LOB': r.subLob,
      'Part No': r.partNo,
      Location: r.location || '—',
      Period: r.period,
      Qty: r.qty,
      Value: r.value
    }));

    $(pivotOutput).pivotUI(records, {
      rows: ['LOB', 'Sub LOB'],
      cols: ['Source'],
      aggregatorName: 'Sum',
      vals: ['Qty'],
      rendererName: 'Table'
    });
  }

  document.getElementById('psi-pivot-period-toggle').addEventListener('click', (e) => {
    const btn = e.target.closest('.toggle-btn');
    if (!btn) return;
    document.querySelectorAll('#psi-pivot-period-toggle .toggle-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    period = btn.dataset.period;
    loadPivot();
  });

  await loadPivot();
})();
