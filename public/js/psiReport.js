(async () => {
  const session = await requireAuth();
  if (!session) return;
  const profile = await getCurrentProfile();
  renderLayout('psi-report', profile);

  const errorBox = document.getElementById('error-box');
  const warnBox = document.getElementById('warn-box');
  const content = document.getElementById('psi-content');
  const exportBtn = document.getElementById('export-psi-btn');

  let lastReport = null;
  let period = 'quarter';

  // --- Multi-select filter widgets (LOB, Sub LOB) ---
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
      else if (selected.size === 1) btn.textContent = `${label}: ${[...selected][0]}`;
      else btn.textContent = `${label}: ${selected.size} selected`;
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
    const { data, error } = await supabaseClient.rpc('get_psi_filter_options');
    if (error) { console.error(error); return; }
    setupMultiSelect('ms-p-lob', 'LOB', data.lobs, (l) => l, (l) => l);
    setupMultiSelect('ms-p-sublob', 'Sub LOB', data.subLobs, (l) => l, (l) => l);
  }

  function getFilterArgs() {
    return {
      p_lobs: multiSelects['ms-p-lob'] ? multiSelects['ms-p-lob'].getValues() : [],
      p_sub_lobs: multiSelects['ms-p-sublob'] ? multiSelects['ms-p-sublob'].getValues() : [],
      p_period: period
    };
  }

  // --- Column layout shared by the on-screen table and the Excel export ---
  const COLUMNS = [
    { group: 'LOB', span: 1, leaf: ['LOB'] },
    { group: 'SUB LOB', span: 1, leaf: ['SUB LOB'] },
    { group: 'Sell-in', span: 2, leaf: ['Qty', 'Value'] },
    { group: 'Sell through', span: 2, leaf: ['Qty', 'Value'] },
    { group: 'Inventory-in hand', span: 3, leaf: ['SG', 'DXB', 'LE PK'] },
    { group: 'Inventory Total', span: 2, leaf: ['Qty', 'Value'] },
    { group: 'Shipment plan', span: 3, leaf: ['WK-1', 'WK-2', 'WK-3'] },
    { group: 'Backlog', span: 1, leaf: ['Backlog'] },
    { group: 'Total Upcoming', span: 1, leaf: ['Total Upcoming'] },
    { group: 'DOS', span: 1, leaf: ['DOS'] },
    { group: 'WOS', span: 1, leaf: ['WOS'] }
  ];
  const LEAF_COUNT = COLUMNS.reduce((sum, c) => sum + c.span, 0);

  function fmt(v) {
    return v === null || v === undefined ? '—' : v;
  }
  function fmtMoney(v) {
    return v === null || v === undefined ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 });
  }

  function renderTable(report) {
    let headRow1 = '';
    let headRow2 = '';
    COLUMNS.forEach((col) => {
      if (col.span === 1) {
        headRow1 += `<th rowspan="2">${escapeHtml(col.group)}</th>`;
      } else {
        headRow1 += `<th colspan="${col.span}">${escapeHtml(col.group)}</th>`;
        col.leaf.forEach((l) => { headRow2 += `<th>${escapeHtml(l)}</th>`; });
      }
    });

    const bodyRows = report.rows.map((r) => `
        <tr>
          <td>${escapeHtml(r.lob)}</td>
          <td>${escapeHtml(r.subLob) || '—'}</td>
          <td>${fmt(r.sellInQty)}</td>
          <td>${fmtMoney(r.sellInValue)}</td>
          <td>${fmt(r.sellThroughQty)}</td>
          <td>${fmtMoney(r.sellThroughValue)}</td>
          <td>${fmt(r.invSg)}</td>
          <td>${fmt(r.invDxb)}</td>
          <td>${fmt(r.invLePk)}</td>
          <td>${fmt(r.invTotalQty)}</td>
          <td>${fmtMoney(r.invTotalValue)}</td>
          <td>${fmt(r.shipWk1)}</td>
          <td>${fmt(r.shipWk2)}</td>
          <td>${fmt(r.shipWk3)}</td>
          <td>${fmt(r.backlog)}</td>
          <td>${fmt(r.totalUpcoming)}</td>
          <td>${fmt(r.dos)}</td>
          <td>${fmt(r.wos)}</td>
        </tr>`).join('') || `<tr><td colspan="${LEAF_COUNT}" class="empty-state">No data for this filter yet — upload Sales, Purchase, Inventory and/or Shipment Plan files first.</td></tr>`;

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
        Sell-in / Sell-through totals are for the selected period above. Inventory and Shipment
        Plan always reflect your latest upload of each. Report generated ${new Date(report.generatedAt).toLocaleString()}.
      </p>
    `;
  }

  async function load() {
    errorBox.style.display = 'none';
    warnBox.style.display = 'none';
    const { data, error } = await supabaseClient.rpc('get_psi_report_v2', getFilterArgs());

    if (error) {
      errorBox.textContent = error.message;
      errorBox.style.display = 'block';
      content.innerHTML = '';
      return;
    }

    lastReport = data;
    if (data.unmatchedShipmentQty > 0) {
      warnBox.style.display = 'block';
      warnBox.textContent = `${data.unmatchedShipmentQty} planned shipment unit(s) didn't match any LOB/Sub LOB from your Sales/Purchase/Inventory data, so they aren't reflected in the table below — this usually means the Shipment Plan file's Product Category/Model naming doesn't line up exactly with your other files.`;
    }
    renderTable(data);
  }

  // --- Export to Excel, matching the on-screen grouped-header layout ---
  function exportToExcel() {
    if (!lastReport || !lastReport.rows.length) { alert('Nothing to export yet.'); return; }

    const headRow1 = [];
    const headRow2 = [];
    const merges = [];
    let colIdx = 0;
    COLUMNS.forEach((col) => {
      headRow1.push(col.group);
      if (col.span === 1) {
        headRow2.push('');
        merges.push({ s: { r: 0, c: colIdx }, e: { r: 1, c: colIdx } });
        colIdx += 1;
      } else {
        for (let i = 1; i < col.span; i++) headRow1.push(null);
        merges.push({ s: { r: 0, c: colIdx }, e: { r: 0, c: colIdx + col.span - 1 } });
        col.leaf.forEach((l) => headRow2.push(l));
        colIdx += col.span;
      }
    });

    const dataRows = lastReport.rows.map((r) => [
      r.lob || '', r.subLob || '',
      r.sellInQty ?? 0, r.sellInValue ?? 0,
      r.sellThroughQty ?? 0, r.sellThroughValue ?? 0,
      r.invSg ?? 0, r.invDxb ?? 0, r.invLePk ?? 0,
      r.invTotalQty ?? 0, r.invTotalValue ?? 0,
      r.shipWk1 ?? 0, r.shipWk2 ?? 0, r.shipWk3 ?? 0,
      r.backlog ?? 0, r.totalUpcoming ?? 0,
      r.dos ?? '', r.wos ?? ''
    ]);

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
      await logActivity('export', 'psi_report', null, { rowCount: lastReport ? lastReport.rows.length : 0, period });
    } finally {
      exportBtn.disabled = false;
    }
  });

  document.getElementById('period-toggle').addEventListener('click', (e) => {
    const btn = e.target.closest('.toggle-btn');
    if (!btn) return;
    document.querySelectorAll('#period-toggle .toggle-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    period = btn.dataset.period;
    load();
  });

  document.getElementById('clear-filters-btn').addEventListener('click', () => {
    Object.values(multiSelects).forEach((ms) => ms.clear());
    load();
  });

  await populateFilterOptions();
  await load();
})();
