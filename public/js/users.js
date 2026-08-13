(async () => {
  const session = await requireAuth();
  if (!session) return;
  const profile = await getCurrentProfile();
  renderLayout('users', profile);

  if (profile.role !== 'admin') {
    document.querySelector('.main-content').innerHTML = '<div class="alert-error">Admin access only.</div>';
    return;
  }

  const errorBox = document.getElementById('error-box');

  async function load() {
    const [{ data: users, error: usersErr }, { data: rtmCategories, error: rtmErr }, { data: accessRows, error: accessErr }] = await Promise.all([
      supabaseClient.from('profiles').select('*').order('created_at'),
      supabaseClient.from('rtm_categories').select('*').order('name'),
      supabaseClient.from('user_rtm_access').select('*')
    ]);

    if (usersErr || rtmErr || accessErr) {
      errorBox.textContent = (usersErr || rtmErr || accessErr).message;
      errorBox.style.display = 'block';
      return;
    }

    // Map of user_id -> Set of allowed rtm_category_ids
    const accessMap = {};
    accessRows.forEach((row) => {
      if (!accessMap[row.user_id]) accessMap[row.user_id] = new Set();
      accessMap[row.user_id].add(row.rtm_category_id);
    });

    document.getElementById('table-body').innerHTML = users.map((u) => `
      <tr>
        <td>${escapeHtml(u.name)}</td>
        <td>${escapeHtml(u.email)}</td>
        <td>
          <select data-id="${u.id}" class="role-select">
            <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
            <option value="sales" ${u.role === 'sales' ? 'selected' : ''}>Sales</option>
            <option value="viewer" ${u.role === 'viewer' ? 'selected' : ''}>Viewer</option>
          </select>
        </td>
        <td>
          ${u.role === 'admin'
            ? '<span class="page-subtitle" style="margin:0;">All (admin)</span>'
            : `<div class="multiselect" id="ms-access-${u.id}"><button type="button" class="multiselect-btn"></button><div class="multiselect-panel"></div></div>`}
        </td>
      </tr>
    `).join('');

    document.querySelectorAll('.role-select').forEach((sel) => {
      sel.addEventListener('change', async () => {
        const id = sel.dataset.id;
        const { error: roleErr } = await supabaseClient.from('profiles').update({ role: sel.value }).eq('id', id);
        if (roleErr) { alert(roleErr.message); return; }
        await logActivity('manual_edit', 'profiles', id, { newRole: sel.value });
        load(); // reload so the RTM Access cell correctly appears/disappears based on new role
      });
    });

    // Build a multi-select RTM access widget for each non-admin user
    users.filter((u) => u.role !== 'admin').forEach((u) => {
      const container = document.getElementById(`ms-access-${u.id}`);
      if (!container) return;
      const btn = container.querySelector('.multiselect-btn');
      const panel = container.querySelector('.multiselect-panel');
      const currentAccess = accessMap[u.id] || new Set();

      panel.innerHTML = rtmCategories.map((rtm) => `
        <label class="multiselect-option">
          <input type="checkbox" value="${rtm.id}" ${currentAccess.has(rtm.id) ? 'checked' : ''} />
          ${escapeHtml(rtm.name)}
        </label>
      `).join('');

      function updateLabel() {
        const checked = [...panel.querySelectorAll('input:checked')];
        btn.textContent = checked.length === 0 ? 'All (unrestricted)' : `${checked.length} selected`;
      }
      updateLabel();

      panel.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
        cb.addEventListener('change', async () => {
          updateLabel();
          const selectedIds = [...panel.querySelectorAll('input:checked')].map((cb2) => parseInt(cb2.value));
          const { error: accessErr2 } = await supabaseClient.rpc('set_user_rtm_access', {
            p_user_id: u.id,
            p_rtm_ids: selectedIds
          });
          if (accessErr2) { alert(accessErr2.message); }
        });
      });

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.multiselect-panel.open').forEach((p) => { if (p !== panel) p.classList.remove('open'); });
        panel.classList.toggle('open');
      });
    });
  }

  document.addEventListener('click', () => {
    document.querySelectorAll('.multiselect-panel.open').forEach((p) => p.classList.remove('open'));
  });

  load();
})();
