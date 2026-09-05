(async () => {
  const session = await requireAuth();
  if (!session) return;
  const profile = await getCurrentProfile();
  renderLayout('bulk-invoice-lookup', profile);

  const errorBox = document.getElementById('error-box');
  const summaryBox = document.getElementById('summary-box');
  const resultsContent = document.getElementById('results-content');
  const lookupBtn = document.getElementById('lookup-btn');
  const exportBtn = document.getElementById('export-btn');

  let lastResults = [];

  document.getElementById('lookup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.style.display = 'none';
    summaryBox.style.display = 'none';
    exportBtn.style.display = 'none';
    resultsContent.innerHTML = '';

    const raw = document.getElementById('invoice-textarea').value;
    const invoices = [...new Set(
      raw.split(/[\n,]+/).map((s) => s.trim()).filter((s) => s.length > 0)
    )];

    if (invoices.length === 0) {
      errorBox.textContent = 'No invoice numbers found in the input.';
      errorBox.style.display = 'block';
      return;
    }

    lookupBtn.disabled = true;
    lookupBtn.textContent = 'Looking up...';

    try {
      const { data, error } = await supabaseClient.rpc('bulk_invoice_lookup', { p_invoices: invoices });
      if (error) throw new Error(error.message);

      const foundMap = {};
      data.forEach((r) => { foundMap[r.invoice_no] = r; });

      lastResults = invoices.map((inv) => foundMap[inv] || { invoice_no: inv, notFound: true });

      const foundCount = lastResults.filter((r) => !r.notFound).length;
      const notFoundCount = lastResults.length - foundCount;

      summaryBox.style.display = 'block';
      summaryBox.textContent = `Looked up ${invoices.length} invoice(s): ${foundCount} found, ${notFoundCount} not found.`;

      resultsContent.innerHTML = `
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Invoice #</th><th>Customer</th><th>RTM</th><th>Model(s)</th>
                <th>Sales Date</th><th>Sales Qtr</th><th>Sales Week</th>
                <th>Total Qty</th><th>Activated</th><th>Unactivated</th><th>Not Included</th>
              </tr>
            </thead>
            <tbody>
              ${lastResults.map((r) => `
                <tr class="${r.notFound ? 'row-flagged' : ''}">
                  <td>${escapeHtml(r.invoice_no)}</td>
                  <td>${r.notFound ? '<span class="alert-error" style="display:inline; padding:2px 8px; margin:0;">Not Found</span>' : escapeHtml(r.customer_name) || '—'}</td>
                  <td>${escapeHtml(r.rtm_name) || '—'}</td>
                  <td>${r.notFound ? '—' : (r.model_count > 1 ? `${escapeHtml(r.sample_model)} +${r.model_count - 1} more` : escapeHtml(r.sample_model) || '—')}</td>
                  <td>${r.sales_date || '—'}</td>
                  <td>${escapeHtml(r.sales_qtr) || '—'}</td>
                  <td>${escapeHtml(r.sales_week) || '—'}</td>
                  <td>${r.total_qty ?? '—'}</td>
                  <td>${r.activated || 0}</td>
                  <td>${r.unactivated || 0}</td>
                  <td>${r.not_included || 0}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;

      exportBtn.style.display = 'inline-block';
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.style.display = 'block';
    } finally {
      lookupBtn.disabled = false;
      lookupBtn.textContent = 'Lookup';
    }
  });

  exportBtn.addEventListener('click', () => {
    const rows = lastResults.map((r) => ({
      'Invoice #': r.invoice_no,
      'Found': r.notFound ? 'No' : 'Yes',
      'Customer': r.customer_name || '',
      'RTM': r.rtm_name || '',
      'Sample Model': r.sample_model || '',
      'Model Count': r.model_count || '',
      'Sales Date': r.sales_date || '',
      'Sales Qtr': r.sales_qtr || '',
      'Sales Week': r.sales_week || '',
      'Total Qty': r.total_qty || '',
      'Activated': r.activated || 0,
      'Unactivated': r.unactivated || 0,
      'Not Included': r.not_included || 0
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Bulk Invoice Lookup');
    XLSX.writeFile(wb, `bulk_invoice_lookup_${Date.now()}.xlsx`);
  });
})();
