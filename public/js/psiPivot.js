// PSI Pivot — live, interactive Excel-style pivot table over the flat
// feed from get_psi_pivot_data(). Two modes:
//  - Presets: one-click common breakdowns (By LOB, By Source, By
//    Location, By Part No) rendered as plain tables, no dragging needed.
//  - Custom: the actual pivottable.js library ($.pivotUI) so fields can
//    be dragged into Rows / Columns / Values for anything the presets
//    don't cover.
(async () => {
  const session = await requireAuth();
  if (!session) return;
  const profile = await getCurrentProfile();
  renderLayout('psi-pivot', profile);

  const SOURCES = ['Sell-In', 'Sell-Through', 'Inventory', 'Shipment Plan'];
  const errorBox = document.getElementById('error-box');
  const statsBox = document.getElementById('psi-pivot-stats');
  const presetContent = document.getElementById('psi-pivot-preset-content');
  const pivotOutput = document.getElementById('pivot-output');

  let period = 'all';
  let preset = 'lob';
  let metric = 'qty';
  let rows = [];
  let customBuilt = false;

  function fmt(n) {
    return Number(n || 0).toLocaleString();
  }

  function renderStats() {
    const totals = { 'Sell-In': 0, 'Sell-Through': 0, 'Inventory': 0, 'Shipment Plan': 0 };
    rows.forEach((r) => { totals[r.source] = (totals[r.source] || 0) + Number(r.qty || 0); });
    statsBox.innerHTML = `
      <div class="stat-grid pro-stat-grid">
        <div class="stat-card pro-stat-card accent-blue"><span class="stat-label">Sell-In Qty</span><span class="stat-value">${fmt(totals['Sell-In'])}</span></div>
        <div class="stat-card pro-stat-card"><span class="stat-label">Sell-Through Qty</span><span class="stat-value">${fmt(totals['Sell-Through'])}</span></div>
        <div class="stat-card pro-stat-card accent-gold"><span class="stat-label">Inventory on Hand</span><span class="stat-value">${fmt(totals['Inventory'])}</span></div>
        <div class="stat-card pro-stat-card accent-purple"><span class="stat-label">Shipment Plan</span><span class="stat-value">${fmt(totals['Shipment Plan'])}</span></div>
      </div>
    `;
  }

  // Groups rows by one or two dimension keys, pivoting Source across columns.
  function buildPivotTable(dimKeys, dimLabels) {
    const groups = new Map();
    rows.forEach((r) => {
      const dimVals = dimKeys.map((k) => r[k] || 'Unknown');
      const key = dimVals.join('');
      if (!groups.has(key)) groups.set(key, { dimVals, bySource: {} });
      const g = groups.get(key);
      g.bySource[r.source] = (g.bySource[r.source] || 0) + Number(r[metric] || 0);
    });

    const entries = [...groups.values()].sort((a, b) => {
      const totalA = SOURCES.reduce((s, src) => s + (a.bySource[src] || 0), 0);
      const totalB = SOURCES.reduce((s, src) => s + (b.bySource[src] || 0), 0);
      return totalB - totalA;
    });

    const LIMIT = 200;
    const truncated = entries.length > LIMIT;
    const shown = truncated ? entries.slice(0, LIMIT) : entries;

    const colTotals = {};
    SOURCES.forEach((s) => { colTotals[s] = 0; });
    entries.forEach((e) => SOURCES.forEach((s) => { colTotals[s] += e.bySource[s] || 0; }));

    const fmtVal = (v) => (metric === 'value' ? Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : fmt(v));

    let html = `<div class="table-wrap"><table id="psi-pivot-table"><thead><tr>`;
    dimLabels.forEach((l) => { html += `<th>${l}</th>`; });
    SOURCES.forEach((s) => { html += `<th>${s}</th>`; });
    html += `</tr></thead><tbody>`;
    shown.forEach((e) => {
      html += '<tr>';
      e.dimVals.forEach((v) => { html += `<td>${escapeHtml(String(v))}</td>`; });
      SOURCES.forEach((s) => { html += `<td style="text-align:right;">${fmtVal(e.bySource[s] || 0)}</td>`; });
      html += '</tr>';
    });
    html += `<tr class="total-row" style="font-weight:700;background:#eef4fc;">`;
    dimLabels.forEach((_, i) => { html += i === 0 ? `<td>Total</td>` : `<td></td>`; });
    SOURCES.forEach((s) => { html += `<td style="text-align:right;">${fmtVal(colTotals[s])}</td>`; });
    html += `</tr></tbody></table></div>`;
    if (truncated) {
      html += `<p class="page-subtitle">Showing top ${LIMIT} of ${entries.length} rows by total ${metric === 'value' ? 'value' : 'qty'}. Switch to Custom for the full unfiltered breakdown.</p>`;
    }
    return html;
  }

  function renderPreset() {
    if (!rows.length) {
      presetContent.innerHTML = '<div class="panel pro-panel"><p class="empty-state">No PSI data uploaded yet — see PSI Files uploads.</p></div>';
      return;
    }
    if (preset === 'lob') {
      presetContent.innerHTML = buildPivotTable(['lob', 'subLob'], ['LOB', 'Sub LOB']);
    } else if (preset === 'source') {
      // Single dimension (Source itself) -- render directly rather than
      // reusing buildPivotTable, since pivoting Source across itself
      // doesn't make sense.
      const totals = {};
      SOURCES.forEach((s) => { totals[s] = 0; });
      rows.forEach((r) => { totals[r.source] = (totals[r.source] || 0) + Number(r[metric] || 0); });
      const fmtVal = (v) => (metric === 'value' ? Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : fmt(v));
      presetContent.innerHTML = `<div class="table-wrap"><table id="psi-pivot-table"><thead><tr><th>Source</th><th>${metric === 'value' ? 'Value' : 'Qty'}</th></tr></thead><tbody>` +
        SOURCES.map((s) => `<tr><td>${s}</td><td style="text-align:right;">${fmtVal(totals[s])}</td></tr>`).join('') +
        `</tbody></table></div>`;
    } else if (preset === 'location') {
      presetContent.innerHTML = buildPivotTable(['location'], ['Location']);
    } else if (preset === 'partno') {
      presetContent.innerHTML = buildPivotTable(['partNo', 'lob'], ['Part No', 'LOB']);
    }
  }

  function buildCustomTab() {
    if (customBuilt) return;
    if (!rows.length) {
      pivotOutput.innerHTML = '<div class="panel pro-panel"><p class="empty-state">No PSI data uploaded yet — see PSI Files uploads.</p></div>';
      return;
    }
    const records = rows.map((r) => ({
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
    customBuilt = true;
  }

  async function loadPivot() {
    errorBox.style.display = 'none';
    statsBox.innerHTML = '';
    presetContent.innerHTML = '<div class="loading">Loading pivot data...</div>';
    pivotOutput.innerHTML = '<div class="loading">Loading pivot data...</div>';
    customBuilt = false;

    const { data, error } = await supabaseClient.rpc('get_psi_pivot_data', { p_period: period });

    if (error) {
      errorBox.textContent = error.message;
      errorBox.style.display = 'block';
      presetContent.innerHTML = '';
      return;
    }

    rows = data || [];
    renderStats();
    renderPreset();
    // Custom tab is built lazily (only when the user clicks it), since
    // pivotUI is heavier to construct than the preset tables.
    if (document.querySelector('#psi-pivot-tabs .toggle-btn[data-tab="custom"]').classList.contains('active')) {
      buildCustomTab();
    }
  }

  document.getElementById('psi-pivot-period-toggle').addEventListener('click', (e) => {
    const btn = e.target.closest('.toggle-btn');
    if (!btn) return;
    document.querySelectorAll('#psi-pivot-period-toggle .toggle-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    period = btn.dataset.period;
    loadPivot();
  });

  document.getElementById('psi-pivot-preset-toggle').addEventListener('click', (e) => {
    const btn = e.target.closest('.toggle-btn');
    if (!btn) return;
    document.querySelectorAll('#psi-pivot-preset-toggle .toggle-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    preset = btn.dataset.preset;
    renderPreset();
  });

  document.getElementById('psi-pivot-metric-toggle').addEventListener('click', (e) => {
    const btn = e.target.closest('.toggle-btn');
    if (!btn) return;
    document.querySelectorAll('#psi-pivot-metric-toggle .toggle-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    metric = btn.dataset.metric;
    renderPreset();
  });

  document.getElementById('psi-pivot-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.toggle-btn');
    if (!btn) return;
    document.querySelectorAll('#psi-pivot-tabs .toggle-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.getElementById('tab-presets').style.display = tab === 'presets' ? '' : 'none';
    document.getElementById('tab-custom').style.display = tab === 'custom' ? '' : 'none';
    if (tab === 'custom') buildCustomTab();
  });

  document.getElementById('export-pivot-btn').addEventListener('click', () => {
    const table = document.getElementById('psi-pivot-table');
    if (!table) return;
    const ws = XLSX.utils.table_to_sheet(table);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'PSI Pivot');
    XLSX.writeFile(wb, `psi_pivot_${Date.now()}.xlsx`);
  });

  await loadPivot();
})();
