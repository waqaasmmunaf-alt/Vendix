(async () => {
  const session = await requireAuth();
  if (!session) return;
  const profile = await getCurrentProfile();
  renderLayout('upload-inventory-snapshot', profile);

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
      const { rows, warnings } = await parseInventorySnapshotFile(file);
      if (rows.length === 0) {
        throw new Error('No inventory lines found. Make sure the file has the consolidated warehouse-value sheet (Part No / LOB / SG Qty / Total Qty columns).');
      }

      const { data: batchId, error: createErr } = await supabaseClient.rpc('create_upload_batch', {
        p_file_name: file.name,
        p_upload_type: 'inventory_snapshot'
      });
      if (createErr) throw new Error(createErr.message);

      const CHUNK = 1000; // smaller chunks to stay under Supabase's statement timeout on large files
      let rowsAdded = 0;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunkRows = rows.slice(i, i + CHUNK);
        uploadBtn.textContent = `Uploading ${Math.min(i + CHUNK, rows.length)} / ${rows.length}...`;
        const { data: chunkAdded, error: chunkErr } = await supabaseClient.rpc('process_inventory_snapshot_chunk', {
          p_batch_id: batchId,
          p_rows: chunkRows
        });
        if (chunkErr) throw new Error(chunkErr.message);
        rowsAdded += chunkAdded || 0;
      }

      const { data: summary, error: finalErr } = await supabaseClient.rpc('finalize_inventory_snapshot_batch', {
        p_batch_id: batchId,
        p_total_rows: rows.length
      });
      if (finalErr) throw new Error(finalErr.message);

      resultBox.style.display = 'block';
      resultBox.innerHTML = `
        <h3>Upload Complete</h3>
        <ul>
          <li>Part / location lines added: <strong>${rowsAdded}</strong></li>
        </ul>
        <p>This is now the active inventory snapshot. Head to the <a href="psi-report.html">PSI Report</a> to see it.</p>
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
