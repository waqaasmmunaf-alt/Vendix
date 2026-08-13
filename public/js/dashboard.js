(async () => {
  const session = await requireAuth();
  if (!session) return;
  const profile = await getCurrentProfile();
  renderLayout('dashboard', profile);

  Chart.register(ChartDataLabels);

  // --- Welcome banner ---
  const firstName = (profile.name || 'there').split(' ')[0];
  document.getElementById('welcome-heading').textContent = `Welcome, ${firstName}`;
  document.getElementById('welcome-date').textContent = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  const errorBox = document.getElementById('error-box');
  const container = document.getElementById('dashboard-content');
  let dateMode = 'sales';
  let charts = {};

  function qtrWeekSortKey(qtr, week) {
    const m = String(qtr || '').match(/Q(\d)(\d{4})/);
    const qNum = m ? parseInt(m[1]) : 0;
    const year = m ? parseInt(m[2]) : 0;
    const wNum = parseInt(String(week || '').replace(/\D/g, '')) || 0;
    return year * 1000 + qNum * 100 + wNum;
  }

  // --- Multi-select filter widgets (RTM, Customer, Model, Qtr, Week) ---
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

  function getFilterArrays() {
    return {
      p_date_mode: dateMode,
      p_rtm_category_ids: multiSelects['ms-d-rtm'] ? multiSelects['ms-d-rtm'].getValues() : [],
      p_customer_ids: multiSelects['ms-d-customer'] ? multiSelects['ms-d-customer'].getValues() : [],
      p_models: multiSelects['ms-d-model'] ? multiSelects['ms-d-model'].getValues() : [],
      p_qtrs: multiSelects['ms-d-qtr'] ? multiSelects['ms-d-qtr'].getValues() : [],
      p_weeks: multiSelects['ms-d-week'] ? multiSelects['ms-d-week'].getValues() : []
    };
  }

  async function populateFilterOptions() {
    const { data, error } = await supabaseClient.rpc('get_dashboard_filter_options');
    if (error) { console.error(error); return; }
    setupMultiSelect('ms-d-rtm', 'RTM', data.rtmCategories, (r) => r.name, (r) => r.id);
    setupMultiSelect('ms-d-customer', 'Customer', data.customers, (c) => c.name, (c) => c.id);
    setupMultiSelect('ms-d-model', 'Model', data.models, (m) => m, (m) => m);
    setupMultiSelect('ms-d-qtr', 'Qtr', data.qtrs, (q) => q, (q) => q);
    setupMultiSelect('ms-d-week', 'Week', data.weeks, (w) => w, (w) => w);
  }

  function destroyChart(key) {
    if (charts[key]) { charts[key].destroy(); delete charts[key]; }
  }

  function renderStatCards(totals) {
    return `
      <div class="stat-grid pro-stat-grid">
        <div class="stat-card pro-stat-card">
          <span class="stat-label">Units Sold</span>
          <span class="stat-value">${totals.units_sold}</span>
        </div>
        <div class="stat-card pro-stat-card accent-gold">
          <span class="stat-label">Activated</span>
          <span class="stat-value">${totals.activated}</span>
        </div>
        <div class="stat-card pro-stat-card accent-navy">
          <span class="stat-label">Unactivated</span>
          <span class="stat-value">${totals.not_activated}</span>
        </div>
        <div class="stat-card pro-stat-card accent-purple">
          <span class="stat-label">Not Included</span>
          <span class="stat-value">${totals.not_included || 0}</span>
        </div>
      </div>`;
  }

  function renderHeatmap(heatmap) {
    if (!heatmap.length) return '<div class="panel pro-panel"><h3>Activation Rate — Quarter × Apple Week</h3><p class="empty-state">No data yet</p></div>';

    const qtrs = [...new Set(heatmap.map((h) => h.qtr))].sort((a, b) => qtrWeekSortKey(a, '0') - qtrWeekSortKey(b, '0'));
    const weeks = [...new Set(heatmap.map((h) => h.week))].sort((a, b) => (parseInt(a.replace(/\D/g,'')) || 0) - (parseInt(b.replace(/\D/g,'')) || 0));

    const cellMap = {};
    heatmap.forEach((h) => { cellMap[`${h.qtr}|${h.week}`] = h; });

    function cellColor(rate) {
      if (rate === undefined) return '#eef0f5';
      // Navy (low) -> Gold (high) — matches the dashboard's classic palette instead of a generic red/green scale
      const t = rate / 100;
      const r = Math.round(11 + t * (201 - 11));
      const g = Math.round(30 + t * (162 - 30));
      const b = Math.round(61 + t * (39 - 61));
      return `rgb(${r},${g},${b})`;
    }

    let html = '<div class="panel pro-panel panel-wide"><h3>Activation Rate — Quarter × Apple Week</h3><div class="heatmap-scroll"><table class="heatmap-table"><thead><tr><th></th>';
    weeks.forEach((w) => { html += `<th>${escapeHtml(w)}</th>`; });
    html += '</tr></thead><tbody>';
    qtrs.forEach((q) => {
      html += `<tr><td class="heatmap-row-label">${escapeHtml(q)}</td>`;
      weeks.forEach((w) => {
        const cell = cellMap[`${q}|${w}`];
        const rate = cell ? cell.activation_rate : undefined;
        const title = cell ? `${cell.activated}/${cell.total} activated (${rate}%)` : 'No data';
        const textColor = rate !== undefined && rate > 55 ? '#0B1E3D' : '#fff';
        html += `<td class="heatmap-cell" style="background:${cellColor(rate)};color:${textColor}" title="${escapeHtml(title)}">${rate !== undefined ? rate + '%' : ''}</td>`;
      });
      html += '</tr>';
    });
    html += '</tbody></table></div></div>';
    return html;
  }

  const dataLabelBase = {
    display: true,
    color: '#0B1E3D',
    font: { weight: '700', size: 11 },
    anchor: 'end',
    align: 'top'
  };

  async function load() {
    errorBox.style.display = 'none';
    const { data, error } = await supabaseClient.rpc('get_dashboard_v3', getFilterArrays());

    if (error) {
      errorBox.textContent = error.message;
      errorBox.style.display = 'block';
      return;
    }

    const { totals, salesTrend, activationTrend, byRtmCategory, modelMix, topCustomersPending, heatmap, duplicateTrend } = data;

    container.innerHTML = `
      ${renderStatCards(totals)}

      <div class="panel-grid two-col">
        <div class="panel pro-panel">
          <h3>Sales Chart</h3>
          <canvas id="chart-sales" height="200"></canvas>
        </div>
        <div class="panel pro-panel">
          <h3>Activation Chart</h3>
          <canvas id="chart-activation" height="200"></canvas>
        </div>
      </div>

      <div class="panel pro-panel">
        <h3>Model Mix — In Channel vs Activated</h3>
        <canvas id="chart-model" height="140"></canvas>
      </div>

      ${renderHeatmap(heatmap)}

      <div class="panel-grid">
        <div class="panel pro-panel">
          <h3>By RTM Category</h3>
          <canvas id="chart-rtm"></canvas>
        </div>
        <div class="panel pro-panel">
          <h3>Top Customers Pending Activation</h3>
          <canvas id="chart-customers"></canvas>
        </div>
      </div>

      <div class="panel pro-panel">
        <h3>Duplicate IMEIs Flagged per Upload</h3>
        <canvas id="chart-duplicates" height="80"></canvas>
      </div>
    `;

    // --- Sales chart (bar, with data labels) ---
    const sortedSales = [...salesTrend].sort((a, b) => qtrWeekSortKey(a.f_qtr, a.f_week) - qtrWeekSortKey(b.f_qtr, b.f_week));
    destroyChart('sales');
    charts.sales = new Chart(document.getElementById('chart-sales'), {
      type: 'bar',
      data: {
        labels: sortedSales.map((t) => `${t.f_qtr} ${t.f_week}`),
        datasets: [{ label: 'Units Sold', data: sortedSales.map((t) => t.sold), backgroundColor: '#0B1E3D', borderRadius: 4 }]
      },
      options: { responsive: true, plugins: { legend: { display: false }, datalabels: dataLabelBase } }
    });

    // --- Activation chart (bar, with data labels) ---
    const sortedActivation = [...activationTrend].sort((a, b) => qtrWeekSortKey(a.f_qtr, a.f_week) - qtrWeekSortKey(b.f_qtr, b.f_week));
    destroyChart('activation');
    charts.activation = new Chart(document.getElementById('chart-activation'), {
      type: 'bar',
      data: {
        labels: sortedActivation.map((t) => `${t.f_qtr} ${t.f_week}`),
        datasets: [{ label: 'Units Activated', data: sortedActivation.map((t) => t.activated), backgroundColor: '#C9A227', borderRadius: 4 }]
      },
      options: { responsive: true, plugins: { legend: { display: false }, datalabels: { ...dataLabelBase, color: '#0B1E3D' } } }
    });

    // --- Model mix (bar, with data labels) ---
    destroyChart('model');
    charts.model = new Chart(document.getElementById('chart-model'), {
      type: 'bar',
      data: {
        labels: modelMix.map((m) => m.model),
        datasets: [
          { label: 'In Channel', data: modelMix.map((m) => m.in_channel), backgroundColor: '#0B1E3D', borderRadius: 4 },
          { label: 'Activated', data: modelMix.map((m) => m.activated), backgroundColor: '#C9A227', borderRadius: 4 }
        ]
      },
      options: { responsive: true, plugins: { legend: { position: 'bottom' }, datalabels: dataLabelBase } }
    });

    // --- RTM breakdown ---
    destroyChart('rtm');
    charts.rtm = new Chart(document.getElementById('chart-rtm'), {
      type: 'bar',
      data: {
        labels: byRtmCategory.map((r) => r.rtm_category),
        datasets: [
          { label: 'In Channel', data: byRtmCategory.map((r) => r.in_channel), backgroundColor: '#0B1E3D', borderRadius: 4 },
          { label: 'Activated', data: byRtmCategory.map((r) => r.activated), backgroundColor: '#C9A227', borderRadius: 4 }
        ]
      },
      options: { responsive: true, plugins: { legend: { position: 'bottom' }, datalabels: { display: false } } }
    });

    // --- Top customers ---
    destroyChart('customers');
    charts.customers = new Chart(document.getElementById('chart-customers'), {
      type: 'bar',
      data: {
        labels: topCustomersPending.map((c) => c.customer_name),
        datasets: [{ label: 'Pending', data: topCustomersPending.map((c) => c.pending), backgroundColor: '#0B1E3D', borderRadius: 4 }]
      },
      options: { responsive: true, indexAxis: 'y', plugins: { legend: { display: false }, datalabels: { ...dataLabelBase, anchor: 'end', align: 'right' } } }
    });

    // --- Duplicate trend ---
    const dupSorted = [...duplicateTrend].reverse();
    destroyChart('duplicates');
    charts.duplicates = new Chart(document.getElementById('chart-duplicates'), {
      type: 'bar',
      data: {
        labels: dupSorted.map((d) => `${d.file_name} (${d.uploaded_at.slice(0, 10)})`),
        datasets: [{ label: 'Duplicates Flagged', data: dupSorted.map((d) => d.duplicate_count), backgroundColor: '#B03A2E', borderRadius: 4 }]
      },
      options: { responsive: true, plugins: { legend: { display: false }, datalabels: { display: false } } }
    });
  }

  document.getElementById('date-mode-toggle').addEventListener('click', (e) => {
    const btn = e.target.closest('.toggle-btn');
    if (!btn) return;
    document.querySelectorAll('.toggle-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    dateMode = btn.dataset.mode;
    load();
  });

  document.getElementById('clear-filters-btn').addEventListener('click', () => {
    Object.values(multiSelects).forEach((ms) => ms.clear());
    load();
  });

  await populateFilterOptions();
  await load();
})();
