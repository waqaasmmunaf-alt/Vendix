(async () => {
  const session = await requireAuth();
  if (!session) return;
  const profile = await getCurrentProfile();
  renderLayout('upload-combined', profile);

  if (profile.role === 'viewer') {
    document.querySelector('.main-content').innerHTML = '<div class="alert-error">Viewers cannot upload files.</div>';
    return;
  }

  const fileInput = document.getElementById('file-input');
  const uploadBtn = document.getElementById('upload-btn');
  const errorBox = document.getElementById('error-box');
  const resultBox = document.getElementById('result-box');

  fileInput.addEventListener('change', () => {
    uploadBtn.disabled = !fileInput.files.length;
  });

  document.getElementById('upload-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = fileInput.files[0];
    if (!file) return;

    errorBox.style.display = 'none';
    resultBox.style.display = 'none';
    uploadBtn.disabled = true;
    uploadBtn.textContent = 'Reading file...';

    try {
      const { rows, warnings } = await parseCombinedReportFile(file);
      if (rows.length === 0) {
        throw new Error('No valid IMEI rows found in this file.');
      }

      uploadBtn.textContent = `Uploading ${rows.length} rows...`;

      const { data: batchId, error: createErr } = await supabaseClient.rpc('create_upload_batch', {
        p_file_name: file.name,
        p_upload_type: 'combined_report'
      });
      if (createErr) throw new Error(createErr.message);

      const CHUNK = 3000;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunkRows = rows.slice(i, i + CHUNK);
        const { error: chunkErr } = await supabaseClient.rpc('process_combined_report_chunk', {
          p_batch_id: batchId,
          p_rows: chunkRows
        });
        if (chunkErr) throw new Error(chunkErr.message);
      }

      const { data: combined, error: finalErr } = await supabaseClient.rpc('finalize_ops_or_combined_batch', {
        p_batch_id: batchId,
        p_total_rows: rows.length
      });
      if (finalErr) throw new Error(finalErr.message);

      resultBox.style.display = 'block';
      const remarkCounts = {};
      rows.forEach((r) => { if (r.activation_remark) remarkCounts[r.activation_remark] = (remarkCounts[r.activation_remark] || 0) + 1; });
      const remarkSummary = Object.entries(remarkCounts).map(([text, count]) => `${text}: ${count}`).join(', ');

      resultBox.innerHTML = `
        <h3>Upload Complete</h3>
        <ul>
          <li>Total rows read: <strong>${combined.totalRows}</strong></li>
          <li>New records added: <strong>${combined.newRecords}</strong></li>
          <li>Already marked activated: <strong>${combined.activatedCount}</strong></li>
          <li>Flagged duplicates: <strong>${combined.flaggedDuplicates}</strong></li>
        </ul>
        ${remarkSummary ? `<div class="alert-warning"><strong>Non-standard status remarks found (kept, not discarded):</strong><br>${escapeHtml(remarkSummary)}</div>` : ''}
        ${warnings.length ? `<div class="alert-warning">${warnings.map((w) => `<div>${escapeHtml(w)}</div>`).join('')}</div>` : ''}
      `;
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.style.display = 'block';
    } finally {
      uploadBtn.disabled = false;
      uploadBtn.textContent = 'Upload File';
    }
  });
})();
