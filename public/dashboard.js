(async () => {
  const session = await requireAuth();
  if (!session) return;
  const profile = await getCurrentProfile();
  renderLayout('dashboard', profile);

  const errorBox = document.getElementById('error-box');
  const container = document.getElementById('dashboard-content');
  let dateMode = 'sales';
  let charts = {}; // holds Chart.js instances so we can destroy/recreate on refresh

  function qtrWeekSortKey(qtr, week) {
    // qtr like "Q42026" -> quarter 4, year 2026. week like "WK5" -> 5.
    const m = String(qtr || '').match(/Q(\d)(\d{4})/);
    const qNum = m ? parseInt(m[1]) : 0;
    const year = m ? parseInt(m[2]) : 0;
    const wNum = parseInt(String(week || '').replace(/\D/g, '')) || 0;
    return year * 1000 + qNum * 100 + wNum;
  }

  function getFilters() {
    return {
      p_date_mode: dateMode,
      p_qtr: document.getElementById('filter-qtr').value || null,
      p_week: document.getElementById('filter-week').value || null,
      p_customer_id: document.getElementById('filter-customer').value || null,
      p_rtm_category_id: document.getElementById('filter-rtm').value || null,
      p_model: document.getElementById('filter-model').value || null
    };
  }

  async function populateFilterOptions() {
    const { data, error } = await supabaseClient.rpc('get_dashboard_filter_options');
    if (error) { console.error(error); return; }

    const fill = (id, items, labelFn, valueFn) => {
      const el = document.getElementById(id);
      const current = el.value;
      const placeholder = el.options[0];
      el.innerHTML = '';
      el.appendChild(placeholder);
      items.forEach((item) => {
        const opt = document.createElement('option');
        opt.value = valueFn(item);
        opt.textContent = labelFn(item);
        el.appendChild(opt);
      });
      el.value = current;
    };

    fill('filter-qtr', data.qtrs, (q) => q, (q) => q);
    fill('filter-week', data.weeks, (w) => w, (w) => w);
    fill('filter-customer', data.customers, (c) => c.name, (c) => c.id);
    fill('filter-rtm', data.rtmCategories, (r) => r.name, (r) => r.id);
    fill('filter-model', data.models, (m) => m, (m) => m);
  }

  function destroyChart(key) {
    if (charts[key]) { charts[key].destroy(); delete charts[key]; }
  }

  function renderStatCards(totals) {
    return `
      <div class="stat-grid">
        <div class="stat-card"><span class="stat-label">Units Sold</span><span class="stat-value">${totals.units_sold}</span></div>
        <div class="stat-card"><span class="stat-label">Activated</span><span class="stat-value">${totals.activated}</span></div>
        <div class="stat-card"><span class="stat-label">Not Activated</span><span class="stat-value">${totals.not_activated}</span></div>
      </div>`;
  }

  function renderHeatmap(heatmap) {
    if (!heatmap.length) return '<div class="panel"><h3>Activation Rate — Quarter × Apple Week</h3><p class="empty-state">No data yet</p></div>';

    const qtrs = [...new Set(heatmap.map((h) => h.qtr))].sort((a, b) => qtrWeekSortKey(a, '0') - qtrWeekSortKey(b, '0'));
    const weeks = [...new Set(heatmap.map((h) => h.week))].sort((a, b) => (parseInt(a.replace(/\D/g,'')) || 0) - (parseInt(b.replace(/\D/g,'')) || 0));

    const cellMap = {};
    heatmap.forEach((h) => { cellMap[`${h.qtr}|${h.week}`] = h; });

    function cellColor(rate) {
      if (rate === undefined) return '#f0f1f5';
      const hue = Math.round((rate / 100) * 130); // 0=red, ~130=green
      return `hsl(${hue}, 65%, 55%)`;
    }

    let html = '<div class="panel panel-wide"><h3>Activation Rate — Quarter × Apple Week</h3><div class="heatmap-scroll"><table class="heatmap-table"><thead><tr><th></th>';
    weeks.forEach((w) => { html += `<th>${escapeHtml(w)}</th>`; });
    html += '</tr></thead><tbody>';
    qtrs.forEach((q) => {
      html += `<tr><td class="heatmap-row-label">${escapeHtml(q)}</td>`;
      weeks.forEach((w) => {
        const cell = cellMap[`${q}|${w}`];
        const rate = cell ? cell.activation_rate : undefined;
        const title = cell ? `${cell.activated}/${cell.total} activated (${rate}%)` : 'No data';
        html += `<td class="heatmap-cell" style="background:${cellColor(rate)}" title="${escapeHtml(title)}">${rate !== undefined ? rate + '%' : ''}</td>`;
      });
      html += '</tr>';
    });
    html += '</tbody></table></div></div>';
    return html;
  }

  async function load() {
    errorBox.style.display = 'none';
    const { data, error } = await supabaseClient.rpc('get_dashboard_v2', getFilters());

    if (error) {
      errorBox.textContent = error.message;
      errorBox.style.display = 'block';
      return;
    }

    const { totals, trend, byRtmCategory, modelMix, topCustomersPending, heatmap, duplicateTrend } = data;

    container.innerHTML = `
      ${renderStatCards(totals)}

      <div class="panel panel-wide">
        <h3>Activation Trend — Sold vs Activated</h3>
        <canvas id="chart-trend" height="90"></canvas>
      </div>

      ${renderHeatmap(heatmap)}

      <div class="panel-grid">
        <div class="panel">
          <h3>By RTM Category</h3>
          <canvas id="chart-rtm"></canvas>
        </div>
        <div class="panel">
          <h3>Model Mix (In-Channel)</h3>
          <canvas id="chart-model"></canvas>
        </div>
        <div class="panel">
          <h3>Top Customers Pending Activation</h3>
          <canvas id="chart-customers"></canvas>
        </div>
      </div>

      <div class="panel panel-wide">
        <h3>Duplicate IMEIs Flagged per Upload</h3>
        <canvas id="chart-duplicates" height="80"></canvas>
      </div>
    `;

    const sortedTrend = [...trend].sort((a, b) => qtrWeekSortKey(a.f_qtr, a.f_week) - qtrWeekSortKey(b.f_qtr, b.f_week));
    destroyChart('trend');
    charts.trend = new Chart(document.getElementById('chart-trend'), {
      type: 'line',
      data: {
        labels: sortedTrend.map((t) => `${t.f_qtr} ${t.f_week}`),
        datasets: [
          { label: 'Sold', data: sortedTrend.map((t) => t.sold), borderColor: '#3b5bdb', backgroundColor: 'rgba(59,91,219,0.1)', tension: 0.3 },
          { label: 'Activated', data: sortedTrend.map((t) => t.activated), borderColor: '#2f9e44', backgroundColor: 'rgba(47,158,68,0.1)', tension: 0.3 }
        ]
      },
      options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
    });

    destroyChart('rtm');
    charts.rtm = new Chart(document.getElementById('chart-rtm'), {
      type: 'bar',
      data: {
        labels: byRtmCategory.map((r) => r.rtm_category),
        datasets: [
          { label: 'In Channel', data: byRtmCategory.map((r) => r.in_channel), backgroundColor: '#f08c00' },
          { label: 'Activated', data: byRtmCategory.map((r) => r.activated), backgroundColor: '#2f9e44' }
        ]
      },
      options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
    });

    destroyChart('model');
    charts.model = new Chart(document.getElementById('chart-model'), {
      type: 'bar',
      data: {
        labels: modelMix.map((m) => m.model),
        datasets: [{ label: 'In Channel', data: modelMix.map((m) => m.in_channel), backgroundColor: '#3b5bdb' }]
      },
      options: { responsive: true, indexAxis: 'y', plugins: { legend: { display: false } } }
    });

    destroyChart('customers');
    charts.customers = new Chart(document.getElementById('chart-customers'), {
      type: 'bar',
      data: {
        labels: topCustomersPending.map((c) => c.customer_name),
        datasets: [{ label: 'Pending', data: topCustomersPending.map((c) => c.pending), backgroundColor: '#f08c00' }]
      },
      options: { responsive: true, indexAxis: 'y', plugins: { legend: { display: false } } }
    });

    const dupSorted = [...duplicateTrend].reverse();
    destroyChart('duplicates');
    charts.duplicates = new Chart(document.getElementById('chart-duplicates'), {
      type: 'bar',
      data: {
        labels: dupSorted.map((d) => `${d.file_name} (${d.uploaded_at.slice(0, 10)})`),
        datasets: [{ label: 'Duplicates Flagged', data: dupSorted.map((d) => d.duplicate_count), backgroundColor: '#d64545' }]
      },
      options: { responsive: true, plugins: { legend: { display: false } } }
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

  document.querySelectorAll('#dash-filters select').forEach((el) => el.addEventListener('change', load));
  document.getElementById('clear-filters-btn').addEventListener('click', () => {
    document.querySelectorAll('#dash-filters select').forEach((el) => { el.value = ''; });
    load();
  });

  await populateFilterOptions();
  await load();
})();
