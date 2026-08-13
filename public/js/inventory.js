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
  const dateFromEl = document.getElementById('filter-date-from');
  const dateToEl = document.getElementById('filter-date-to');
  const tbody = document.getElementById('table-body');
  const errorBox = document.getElementById('error-box');
  const pageInfo = document.getElementById('page-info');
  const prevBtn = document.getElementById('prev-btn');
  const nextBtn = document.getElementById('next-btn');

  // ---------------------------------------------------------------
  // Reusable checkbox multi-select widget. Each instance manages its
  // own button label + dropdown panel + selected values.
  // ---------------------------------------------------------------
  const multiSelects = {}; // id -> { getValues(), setValues(arr) }

  function setupMultiSelect(containerId, label, items, labelFn, valueFn, onChange) {
    const container = document.getElementById(containerId);
    const btn = container.querySelector('.multiselect-btn');
    const panel = container.querySelector('.multiselect-panel');
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
        onChange();
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

    const reload = () => { page = 0; loadRecords(); };

    setupMultiSelect('ms-rtm', 'RTM', data.rtmCategories, (r) => r.name, (r) => r.id, reload);
    setupMultiSelect('ms-customer', 'Customer', data.customers, (c) => c.name, (c) => c.id, reload);
    setupMultiSelect('ms-model', 'Model', data.models, (m) => m, (m) => m, reload);
    setupMultiSelect('ms-qtr', 'Sales Qtr', data.qtrs, (q) => q, (q) => q, reload);
    setupMultiSelect('ms-week', 'Sales Week', data.weeks, (w) => w, (w) => w, reload);
  }

  function buildQuery(rangeFrom, rangeTo) {
    const rtmValues = multiSelects['ms-rtm'] ? multiSelects['ms-rtm'].getValues() : [];
    const customerValues = multiSelects['ms-customer'] ? multiSelects['ms-customer'].getValues() : [];
    const modelValues = multiSelects['ms-model'] ? multiSelects['ms-model'].getValues() : [];
    const qtrValues = multiSelects['ms-qtr'] ? multiSelects['ms-qtr'].getValues() : [];
    const weekValues = multiSelects['ms-week'] ? multiSelects['ms-week'].getValues() : [];

    const rtmActive = rtmValues.length > 0;
    const customerSelect = rtmActive
      ? 'customers!inner(name, rtm_category_id, rtm_categories(name))'
      : 'customers(name, rtm_categories(name))';

    let q = supabaseClient
      .from('imei_records')
      .select(`id, imei1, imei2, serial_no, model, description, part_no, qty, proforma_invoice_no, date_of_shipment, apple_week, apple_qtr, status, activated_date, activated_apple_week, activated_apple_qtr, activation_remark, is_duplicate, ${customerSelect}`, { count: 'exact' })
      .is('deleted_at', null)
      .order('date_of_shipment', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false }); // stable tie-breaker so pagination doesn't skip/repeat rows

    if (statusEl.value) q = q.eq('status', statusEl.value);
    if (dupEl.value === 'true') q = q.eq('is_duplicate', true);
    if (searchEl.value.trim()) q = q.or(`imei1.ilike.%${searchEl.value.trim()}%,serial_no.ilike.%${searchEl.value.trim()}%`);
    if (rtmActive) q = q.in('customers.rtm_category_id', rtmValues);
    if (customerValues.length) q = q.in('customer_id', customerValues);
    if (modelValues.length) q = q.in('model', modelValues);
    if (qtrValues.length) q = q.in('apple_qtr', qtrValues);
    if (weekValues.length) q = q.in('apple_week', weekValues);
    if (dateFromEl.value) q = q.gte('date_of_shipment', dateFromEl.value);
    if (dateToEl.value) q = q.lte('date_of_shipment', dateToEl.value);
    if (rangeFrom !== undefined) q = q.range(rangeFrom, rangeTo);
    return q;
  }

  async function loadRecords() {
    errorBox.style.display = 'none';
    const { data, error, count } = await buildQuery(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (error) {
      errorBox.textContent = error.message;
      errorBox.style.display = 'block';
      return;
    }
    total = count || 0;

    tbody.innerHTML = data.map((r) => `
      <tr class="${r.is_duplicate ? 'row-flagged' : ''}">
        <td>${escapeHtml(r.customers?.rtm_categories?.name || 'Uncategorized')}</td>
        <td>${escapeHtml(r.serial_no)}</td>
        <td>${escapeHtml(r.imei1)}</td>
        <td>${escapeHtml(r.imei2) || '—'}</td>
        <td>${escapeHtml(r.model) || '—'}</td>
        <td>${escapeHtml(r.description)}</td>
        <td>${escapeHtml(r.part_no)}</td>
        <td>${r.qty ?? ''}</td>
        <td>${escapeHtml(r.proforma_invoice_no)}</td>
        <td>${escapeHtml(r.customers?.name || '')}</td>
        <td>${r.date_of_shipment || ''}</td>
        <td>${escapeHtml(r.apple_qtr) || '—'}</td>
        <td>${escapeHtml(r.apple_week) || '—'}</td>
        <td><span class="badge badge-${r.status}">${r.status === 'not_included' ? 'Not Included' : r.status}</span></td>
        <td>${r.activated_date || '—'}</td>
        <td>${escapeHtml(r.activated_apple_qtr) || '—'}</td>
        <td>${escapeHtml(r.activated_apple_week) || '—'}</td>
        <td>${r.activation_remark ? `<span class="remark-badge" title="${escapeHtml(r.activation_remark)}">${escapeHtml(r.activation_remark)}</span>` : ''}</td>
        <td>${r.is_duplicate ? 'Yes' : ''}</td>
        <td>${isAdmin ? `<button class="btn-link-danger" data-id="${r.id}">Delete</button>` : ''}</td>
      </tr>
    `).join('') || '<tr><td colspan="20" class="empty-state">No records match this filter</td></tr>';

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

  [statusEl, dupEl, dateFromEl, dateToEl].forEach((el) =>
    el.addEventListener('change', () => { page = 0; loadRecords(); })
  );
  let searchTimeout;
  searchEl.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => { page = 0; loadRecords(); }, 400);
  });
  prevBtn.addEventListener('click', () => { if (page > 0) { page--; loadRecords(); } });
  nextBtn.addEventListener('click', () => { page++; loadRecords(); });

  async function fetchAllFiltered(btn) {
    const EXPORT_PAGE = 1000;
    let allRows = [];
    let from = 0;

    while (true) {
      btn.textContent = `Fetching records... (${allRows.length} so far)`;
      const { data, error, count } = await buildQuery(from, from + EXPORT_PAGE - 1);
      if (error) throw new Error(error.message);
      if (!data.length) break;
      allRows = allRows.concat(data);
      from += data.length; // advance by what was ACTUALLY returned, never by the requested page size —
                            // guarantees no rows are skipped even if the platform silently caps a response smaller than asked
      if (allRows.length >= count) break;
    }
    return allRows;
  }

  function rowsToRawSheetData(allRows) {
    return allRows.map((r) => ({
      'RTM Category': r.customers?.rtm_categories?.name || 'Uncategorized',
      'Serial No': r.serial_no,
      'IMEI 1': r.imei1,
      'IMEI 2': r.imei2,
      'Model': r.model,
      'Description': r.description,
      'Part No': r.part_no,
      'Qty': r.qty,
      'PFI #': r.proforma_invoice_no,
      'Customer Name': r.customers?.name || '',
      'Sales Date': r.date_of_shipment,
      'Sales Qtr': r.apple_qtr,
      'Sales Week': r.apple_week,
      'Activation Status': r.status,
      'Activation Date': r.activated_date || '',
      'Act Qtr': r.activated_apple_qtr || '',
      'Act Week': r.activated_apple_week || '',
      'Remark': r.activation_remark || '',
      'Duplicate Flag': r.is_duplicate
    }));
  }

  function writeWorkbook(allRows) {
    const EXCEL_MAX_ROWS = 1000000; // stay safely under Excel's hard cap of 1,048,576 rows/sheet
    const chunks = [];
    for (let i = 0; i < allRows.length; i += EXCEL_MAX_ROWS) chunks.push(allRows.slice(i, i + EXCEL_MAX_ROWS));

    chunks.forEach((chunkRows, idx) => {
      const wb = XLSX.utils.book_new();
      const rawWs = XLSX.utils.json_to_sheet(rowsToRawSheetData(chunkRows));
      XLSX.utils.book_append_sheet(wb, rawWs, 'IMEI Export');
      const suffix = chunks.length > 1 ? `_part${idx + 1}of${chunks.length}` : '';
      XLSX.writeFile(wb, `imei_export_${Date.now()}${suffix}.xlsx`);
    });
  }

  async function handleExport(btn) {
    const originalText = btn.textContent;
    btn.disabled = true;
    try {
      const allRows = await fetchAllFiltered(btn);
      if (!allRows.length) { alert('No records match this filter'); return; }
      btn.textContent = 'Building Excel file...';
      writeWorkbook(allRows);
      await logActivity('export', 'imei_records', null, { rowCount: allRows.length });
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }

  document.getElementById('export-raw-btn').addEventListener('click', (e) => handleExport(e.target));

  document.getElementById('clear-filters-btn').addEventListener('click', () => {
    statusEl.value = '';
    dupEl.value = '';
    dateFromEl.value = '';
    dateToEl.value = '';
    Object.values(multiSelects).forEach((ms) => ms.clear());
    page = 0;
    loadRecords();
  });

  await populateFilterOptions();
  loadRecords();
})();
