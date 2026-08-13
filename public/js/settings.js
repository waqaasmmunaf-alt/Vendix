(async () => {
  const session = await requireAuth();
  if (!session) return;
  const profile = await getCurrentProfile();
  renderLayout('settings', profile);
  const isAdmin = profile.role === 'admin';

  if (!isAdmin) document.getElementById('readonly-note').style.display = 'block';
  else {
    document.getElementById('rtm-form').style.display = 'flex';
    document.getElementById('customer-form').style.display = 'flex';
  }

  const errorBox = document.getElementById('error-box');
  let categories = [];

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.style.display = 'block';
  }

  async function loadCategories() {
    const { data, error } = await supabaseClient.from('rtm_categories').select('*').order('name');
    if (error) return showError(error.message);
    categories = data;
    document.getElementById('rtm-table-body').innerHTML = data.map((c) => `<tr><td>${escapeHtml(c.name)}</td></tr>`).join('');

    const rtmSelect = document.getElementById('customer-rtm-select');
    if (rtmSelect) {
      rtmSelect.innerHTML = '<option value="">Uncategorized</option>' +
        data.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    }
  }

  async function loadCustomers(search = '') {
    let q = supabaseClient.from('customers').select('id, name, rtm_category_id, rtm_categories(name)').order('name').limit(500);
    if (search) q = q.ilike('name', `%${search}%`);
    const { data, error } = await q;
    if (error) return showError(error.message);

    const options = (selectedId) => categories.map((c) =>
      `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
    ).join('');

    document.getElementById('customer-table-body').innerHTML = data.map((c) => `
      <tr>
        <td>${escapeHtml(c.name)}</td>
        <td>
          ${isAdmin
            ? `<select data-id="${c.id}" class="tag-select"><option value="">Uncategorized</option>${options(c.rtm_category_id)}</select>`
            : escapeHtml(c.rtm_categories?.name || 'Uncategorized')}
        </td>
      </tr>
    `).join('') || '<tr><td colspan="2" class="empty-state">No customers found</td></tr>';

    if (isAdmin) {
      document.querySelectorAll('.tag-select').forEach((sel) => {
        sel.addEventListener('change', async () => {
          const customerId = sel.dataset.id;
          const rtmId = sel.value || null;
          const { error: tagErr } = await supabaseClient.from('customers').update({ rtm_category_id: rtmId, updated_at: new Date().toISOString() }).eq('id', customerId);
          if (tagErr) return showError(tagErr.message);
          await logActivity('tag_customer', 'customers', customerId, { rtm_category_id: rtmId });
        });
      });
    }
  }

  if (isAdmin) {
    document.getElementById('rtm-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('rtm-input');
      const name = input.value.trim();
      if (!name) return;
      const { data, error } = await supabaseClient.from('rtm_categories').insert({ name }).select().single();
      if (error) return showError(error.message);
      await logActivity('create_rtm_category', 'rtm_categories', data.id, { name });
      input.value = '';
      await loadCategories();
      await loadCustomers(document.getElementById('customer-search').value);
    });

    document.getElementById('customer-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const nameInput = document.getElementById('customer-name-input');
      const rtmSelect = document.getElementById('customer-rtm-select');
      const name = nameInput.value.trim();
      if (!name) return;

      const { data, error } = await supabaseClient
        .from('customers')
        .insert({ name, rtm_category_id: rtmSelect.value || null })
        .select()
        .single();

      if (error) {
        showError(error.code === '23505' ? 'A customer with that name already exists.' : error.message);
        return;
      }
      await logActivity('create_customer', 'customers', data.id, { name, rtm_category_id: rtmSelect.value || null });
      nameInput.value = '';
      rtmSelect.value = '';
      await loadCustomers(document.getElementById('customer-search').value);
    });
  }

  let searchTimeout;
  document.getElementById('customer-search').addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => loadCustomers(e.target.value), 400);
  });

  await loadCategories();
  await loadCustomers();
})();
