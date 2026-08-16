(async () => {
  const session = await requireAuth();
  if (!session) return;
  const profile = await getCurrentProfile();
  renderLayout('upload-activation', profile);

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
      const { activatedRows, totalRows, warnings } = await parseActivationCheckFile(file);
      if (activatedRows.length === 0) {
        throw new Error('No rows with status "Activated" found in this file — nothing to update.');
      }

      uploadBtn.textContent = `Matching ${activatedRows.length} activated IMEIs...`;

      const { data: batchId, error: createErr } = await supabaseClient.rpc('create_upload_batch', {
        p_file_name: file.name,
        p_upload_type: 'activation_check'
      });
      if (createErr) throw new Error(createErr.message);

      const CHUNK = 1000; // smaller chunks to stay under Supabase's statement timeout on large files
      let updatedTotal = 0;

      for (let i = 0; i < activatedRows.length; i += CHUNK) {
        const chunkRows = activatedRows.slice(i, i + CHUNK);
        const { data: chunkUpdated, error: chunkErr } = await supabaseClient.rpc('process_activation_check_chunk', {
          p_batch_id: batchId,
          p_rows: chunkRows
        });
        if (chunkErr) throw new Error(chunkErr.message);
        updatedTotal += chunkUpdated;
      }

      const { data: combined, error: finalErr } = await supabaseClient.rpc('finalize_activation_batch', {
        p_batch_id: batchId,
        p_total_rows: activatedRows.length,
        p_updated_count: updatedTotal
      });
      if (finalErr) throw new Error(finalErr.message);

      resultBox.style.display = 'block';
      resultBox.innerHTML = `
        <h3>Upload Complete</h3>
        <ul>
          <li>Total rows in file: <strong>${totalRows}</strong></li>
          <li>Rows marked "Activated": <strong>${activatedRows.length}</strong></li>
          <li>Records updated: <strong>${combined.recordsUpdated}</strong></li>
          <li>IMEIs not found in system: <strong>${combined.imeiNotFoundInSystem}</strong></li>
        </ul>
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
