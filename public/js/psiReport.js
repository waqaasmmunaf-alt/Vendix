(async () => {
  const session = await requireAuth();
  if (!session) return;
  const profile = await getCurrentProfile();
  renderLayout('psi-report', profile);

  const errorBox = document.getElementById('error-box');
  const warnBox = document.getElementById('warn-box');
  const content = document.getElementById('psi-content');
  const exportBtn = document.getElementById('export-psi-btn');

  let lastReport = null; // last successful get_psi_report() result, kept around for the export button

  // --- Multi-select filter widgets (RTM, Customer, Model) — same pattern as dashboard.js / inventory.js ---
  const multiSelects = {};

  function setupMultiSelect(containerId, label, items, labelFn, valueFn) {
    const containerEl = document.getElementById(containerId);
    const btn = containerEl.querySelector('.multiselect-btn');
    const panel = containerEl.querySelector('.multiselect-panel');
    let selected = new Set();

    panel.innerHTML = items.map((item, idx) => `
      <label class="multiselect-option">
        <input type="checkbox" value="${escapeHtml(String(valueFn(item)))}" data-idx="${idx}" />
        ${escapeHtml(labelFn(item))}
      </label>
    `).join('') || '<div class="multiselect-empty">No options</div>';

    function updateLabel() {
      if (selected.size === 0) btn.textContent = `${label}: All`;
      else if (selected.size === 1) {
        const item = items.find((it) => String(valueFn(it)) === [...selected][0]);
        btn.textContent = `${label}: ${item ? labelFn(item) : '1 selected'}`;
      } else btn.textContent = `${label}: ${selected.size} selected`;
    }

    panel.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener('change', () => {
        if (cb.checked) selected.add(cb.value); else selected.delete(cb.value);
        updateLabel();
        load();
      });
    });

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.multiselect-panel.open').forEach((p) => { if (p !== panel) p.classList.remove('open'); });
      panel.classList.toggle('open');
    });

    multiSelects[containerId] = {
      getValues: () => [...selected],
      clear: () => {
        selected = new Set();
        panel.querySelectorAll('input[type="checkbox"]').forEach((cb) => { cb.checked = false; });
        updateLabel();
      }
    };
  }

  document.addEventListener('click', () => {
    document.querySelectorAll('.multiselect-panel.open').forEach((p) => p.classList.remove('open'));
  });

  async function populateFilterOptions() {
    const { data, error } = await supabaseClient.rpc('get_dashboard_filter_options');
    if (error) { console.error(error); return; }
    setupMultiSelect('ms-p-rtm', 'RTM', data.rtmCategories, (r) => r.name, (r) => r.id);
    setupMultiSelect('ms-p-customer', 'Customer', data.customers, (c) => c.name, (c) => c.id);
    setupMultiSelect('ms-p-model', 'Model', data.models, (m) => m, (m) => m);
  }

  function getFilterArrays() {
    const toIntArray = (arr) => arr.map((v) => parseInt(v, 10));
    return {
      p_rtm_category_ids: multiSelects['ms-p-rtm'] ? toIntArray(multiSelects['ms-p-rtm'].getValues()) : [],
      p_customer_ids: multiSelects['ms-p-customer'] ? toIntArray(multiSelects['ms-p-customer'].getValues()) : [],
      p_models: multiSelects['ms-p-model'] ? multiSelects['ms-p-model'].getValues() : []
    };
  }

  // --- Column layout shared by the on-screen table and the Excel export ---
  // Group headers: label + how many leaf columns it spans (1 = no sub-columns)
  function buildColumns(trendMonths) {
    return [
      { group: 'LOB', span: 1, leaf: ['LOB'] },
      { group: 'SUB LOB', span: 1, leaf: ['SUB LOB'] },
      { group: 'Storage', span: 1, leaf: ['Storage'] },
      { group: 'Color', span: 1, leaf: ['Color'] },
      { group: 'Sell-in', span: 1, leaf: ['Sell-in'] },
      { group: 'Sell through', span: 1, leaf: ['Sell through'] },
      { group: 'Activated', span: 1, leaf: ['Activated'] },
      { group: 'In channel', span: 1, leaf: ['In channel'] },
      { group: '6 Month Sell Trend', span: 6, leaf: trendMonths },
      { group: 'Inventory-in hand', span: 3, leaf: ['SG', 'DXB', 'LE PK'] },
      { group: 'Shipment plan', span: 3, leaf: ['WK-1', 'WK-2', 'WK-3'] },
      { group: 'Backlog', span: 1, leaf: ['Backlog'] },
      { group: 'Total Upcoming', span: 1, leaf: ['Total Upcoming'] },
      { group: 'FGOS', span: 1, leaf: ['FGOS'] },
      { group: 'DOS', span: 1, leaf: ['DOS'] },
      { group: 'WOS', span: 1, leaf: ['WOS'] }
    ];
  }

  function fmt(v) {
    return v === null || v === undefined ? '—' : v;
  }

  function renderTable(report) {
    const trendMonths = (report.rows[0]?.sixMonthTrend || []).map((t) => t.month);
    const columns = buildColumns(trendMonths.length ? trendMonths : ['', '', '', '', '', '']);

    let headRow1 = '';
    let headRow2 = '';
    columns.forEach((col) => {
      if (col.span === 1) {
        headRow1 += `<th rowspan="2">${escapeHtml(col.group)}</th>`;
      } else {
        headRow1 += `<th colspan="${col.span}">${escapeHtml(col.group)}</th>`;
        col.leaf.forEach((l) => { headRow2 += `<th>${escapeHtml(l)}</th>`; });
      }
    });

    const bodyRows = report.rows.map((r) => {
      const trendCells = (r.sixMonthTrend || []).map((t) => `<td>${fmt(t.units)}</td>`).join('');
      return `
        <tr>
          <td>${escapeHtml(r.lob)}</td>
          <td>${escapeHtml(r.subLob) || '—'}</td>
          <td>${escapeHtml(r.storage) || '—'}</td>
          <td>${escapeHtml(r.color) || '—'}</td>
          <td>${fmt(r.sellIn)}</td>
          <td>${fmt(r.sellThrough)}</td>
          <td>${fmt(r.activated)}</td>
          <td>${fmt(r.inChannel)}</td>
          ${trendCells}
          <td>${fmt(r.invSg)}</td>
          <td>${fmt(r.invDxb)}</td>
          <td>${fmt(r.invLePk)}</td>
          <td>${fmt(r.planWk1)}</td>
          <td>${fmt(r.planWk2)}</td>
          <td>${fmt(r.planWk3)}</td>
          <td>${fmt(r.backlog)}</td>
          <td>${fmt(r.totalUpcoming)}</td>
          <td>${fmt(r.fgos)}</td>
          <td>${fmt(r.dos)}</td>
          <td>${fmt(r.wos)}</td>
        </tr>`;
    }).join('') || `<tr><td colspan="25" class="empty-state">No data for this filter yet — upload a Sales File and/or Shipment Plan first.</td></tr>`;

    content.innerHTML = `
      <div class="table-wrap">
        <table class="psi-table">
          <thead>
            <tr>${headRow1}</tr>
            <tr>${headRow2}</tr>
          </thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>
      <p class="page-subtitle" style="margin-top:12px;">
        Model row shown as LOB / Storage / Color — hover the sidebar link for column definitions.
        Report generated ${new Date(report.generatedAt).toLocaleString()}.
      </p>
    `;
  }

  async function load() {
    errorBox.style.display = 'none';
    warnBox.style.display = 'none';
    const { data, error } = await supabaseClient.rpc('get_psi_report', getFilterArrays());

    if (error) {
      errorBox.textContent = error.message;
      errorBox.style.display = 'block';
      content.innerHTML = '';
      return;
    }

    lastReport = data;
    if (data.otherLocationCount > 0) {
      warnBox.style.display = 'block';
      warnBox.textContent = `${data.otherLocationCount} unactivated unit(s) didn't match the SG / DXB / LE PK location buckets and aren't counted in "Inventory-in hand" — check the location/RTM values on those records if this number looks high.`;
    }
    renderTable(data);
  }

  // --- Export to Excel, matching the on-screen grouped-header layout ---
  function exportToExcel() {
    if (!lastReport || !lastReport.rows.length) { alert('Nothing to export yet.'); return; }

    const trendMonths = (lastReport.rows[0]?.sixMonthTrend || []).map((t) => t.month);
    const columns = buildColumns(trendMonths.length ? trendMonths : ['', '', '', '', '', '']);

    const headRow1 = [];
    const headRow2 = [];
    const merges = [];
    let colIdx = 0;
    columns.forEach((col) => {
      headRow1.push(col.group);
      if (col.span === 1) {
        headRow2.push('');
        merges.push({ s: { r: 0, c: colIdx }, e: { r: 1, c: colIdx } }); // vertical merge, single column
        colIdx += 1;
      } else {
        for (let i = 1; i < col.span; i++) headRow1.push(null);
        merges.push({ s: { r: 0, c: colIdx }, e: { r: 0, c: colIdx + col.span - 1 } }); // horizontal merge on row 1
        col.leaf.forEach((l) => headRow2.push(l));
        colIdx += col.span;
      }
    });

    const dataRows = lastReport.rows.map((r) => {
      const trendVals = (r.sixMonthTrend || []).map((t) => t.units ?? '');
      return [
        r.lob || '', r.subLob || '', r.storage || '', r.color || '',
        r.sellIn ?? 0, r.sellThrough ?? 0, r.activated ?? 0, r.inChannel ?? 0,
        ...trendVals,
        r.invSg ?? 0, r.invDxb ?? 0, r.invLePk ?? 0,
        r.planWk1 ?? 0, r.planWk2 ?? 0, r.planWk3 ?? 0,
        r.backlog ?? 0, r.totalUpcoming ?? 0, r.fgos ?? 0,
        r.dos ?? '', r.wos ?? ''
      ];
    });

    const aoa = [headRow1, headRow2, ...dataRows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!merges'] = merges;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'PSI');
    XLSX.writeFile(wb, `psi_report_${Date.now()}.xlsx`);
  }

  exportBtn.addEventListener('click', async () => {
    exportBtn.disabled = true;
    try {
      exportToExcel();
      await logActivity('export', 'psi_report', null, { rowCount: lastReport ? lastReport.rows.length : 0 });
    } finally {
      exportBtn.disabled = false;
    }
  });

  document.getElementById('clear-filters-btn').addEventListener('click', () => {
    Object.values(multiSelects).forEach((ms) => ms.clear());
    load();
  });

  await populateFilterOptions();
  await load();
})();
