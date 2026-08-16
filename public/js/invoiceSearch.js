// Invoice Search — same imei_records lookup as IMEI Search, keyed on
// proforma_invoice_no (PFI #) instead of imei1. One invoice can cover many
// units, so results render as a single table (with Export to Excel) instead
// of one card per unit.
(async () => {
  const session = await requireAuth();
  if (!session) return;
  const profile = await getCurrentProfile();
  renderLayout('invoice-search', profile);

  const errorBox = document.getElementById('error-box');
  const results = document.getElementById('results');
  const tableWrap = document.getElementById('results-table-wrap');
  const exportBtn = document.getElementById('export-invoice-btn');
  let lastRows = [];

  function rowToExportRecord(r) {
    return {
      'IMEI 1': r.imei1,
      'IMEI 2': r.imei2 || '',
      Status: r.status,
      Customer: r.customers?.name || 'Unknown Customer',
      'RTM Category': r.customers?.rtm_categories?.name || 'Uncategorized',
      Location: r.location || '',
      Description: r.description || '',
      'PFI / Invoice #': r.proforma_invoice_no || '',
      'Shipment Date': r.date_of_shipment || '',
      'Apple Week (Shipment)': r.apple_week || '',
      'Apple Qtr (Shipment)': r.apple_qtr || '',
      'Apple Year (Shipment)': r.apple_year || '',
      'Uploaded Via': r.upload_batch?.file_name || '',
      'Activated Date': r.activated_date || '',
      'Apple Week (Activation)': r.activated_apple_week || '',
      'Apple Qtr (Activation)': r.activated_apple_qtr || '',
      'Apple Year (Activation)': r.activated_apple_year || '',
      'Activation File': r.activation_batch?.file_name || '',
      Remark: r.activation_remark || '',
      Duplicate: r.is_duplicate ? 'Yes' : 'No'
    };
  }

  function renderTable(data) {
    tableWrap.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>IMEI</th><th>Status</th><th>Customer</th><th>RTM Category</th><th>Location</th>
            <th>Description</th><th>PFI #</th><th>Shipment Date</th><th>Activated Date</th>
            <th>Remark</th><th>Duplicate</th>
          </tr>
        </thead>
        <tbody>
          ${data.map((r) => `
            <tr>
              <td>${escapeHtml(r.imei1)}</td>
              <td><span class="badge badge-${r.status}">${escapeHtml(r.status)}</span></td>
              <td>${escapeHtml(r.customers?.name || 'Unknown Customer')}</td>
              <td>${escapeHtml(r.customers?.rtm_categories?.name || 'Uncategorized')}</td>
              <td>${escapeHtml(r.location)}</td>
              <td>${escapeHtml(r.description)}</td>
              <td>${escapeHtml(r.proforma_invoice_no)}</td>
              <td>${r.date_of_shipment || '—'}</td>
              <td>${r.activated_date || '—'}</td>
              <td>${escapeHtml(r.activation_remark) || '—'}</td>
              <td>${r.is_duplicate ? 'Yes' : 'No'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  document.getElementById('search-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.style.display = 'none';
    results.innerHTML = '<div class="loading">Searching...</div>';
    tableWrap.innerHTML = '';
    exportBtn.style.display = 'none';
    lastRows = [];

    const invoice = document.getElementById('invoice-input').value.trim();

    const { data, error } = await supabaseClient
      .from('imei_records')
      .select(`
        *, customers(name, rtm_categories(name)),
        upload_batch:upload_batches!imei_records_upload_batch_id_fkey(file_name, uploaded_at),
        activation_batch:upload_batches!imei_records_activation_batch_id_fkey(file_name, uploaded_at)
      `)
      .eq('proforma_invoice_no', invoice)
      .order('created_at', { ascending: false });

    if (error) {
      errorBox.textContent = error.message;
      errorBox.style.display = 'block';
      results.innerHTML = '';
      return;
    }

    if (!data.length) {
      results.innerHTML = '<div class="alert-error">No records found for this invoice / PFI number</div>';
      return;
    }

    lastRows = data;
    results.innerHTML = `<p class="page-subtitle">${data.length} unit${data.length === 1 ? '' : 's'} found under this invoice.</p>`;
    renderTable(data);
    exportBtn.style.display = '';
  });

  exportBtn.addEventListener('click', () => {
    if (!lastRows.length) return;
    const ws = XLSX.utils.json_to_sheet(lastRows.map(rowToExportRecord));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Invoice Search');
    XLSX.writeFile(wb, `invoice_search_${Date.now()}.xlsx`);
  });
})();
