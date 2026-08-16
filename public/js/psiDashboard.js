// PSI Dashboard — chart view of PSI data (sell-in / sell-through /
// inventory / shipment plan by LOB) plus the SKU-level Sales Trend
// (relocated here from the main Dashboard). No new SQL: reuses the
// already-tested get_psi_report_v2() RPC (aggregated to per-LOB totals
// here in JS) and the existing get_sales_trend() RPC.
(async () => {
  const session = await requireAuth();
  if (!session) return;
  const profile = await getCurrentProfile();
  renderLayout('psi-dashboard', profile);

  Chart.register(ChartDataLabels);

  const errorBox = document.getElementById('error-box');
  const dashContent = document.getElementById('psi-dash-content');
  const trendContainer = document.getElementById('psi-trend-content');
  let period = 'quarter';
  let trendMetric = 'qty';
  const charts = {};

  const dataLabelBase = {
    display: true,
    color: '#184f95',
    font: { weight: '700', size: 11 },
    anchor: 'end',
    align: 'top'
  };

  function destroyChart(key) {
    if (charts[key]) { charts[key].destroy(); delete charts[key]; }
  }

  function fmt(n) {
    return Number(n || 0).toLocaleString();
  }

  async function loadPsiDashboard() {
    errorBox.style.display = 'none';
    dashContent.innerHTML = '<div class="loading">Loading PSI dashboard...</div>';

    const { data, error } = await supabaseClient.rpc('get_psi_report_v2', {
      p_lobs: [],
      p_sub_lobs: [],
      p_period: period
    });

    if (error) {
      errorBox.textContent = error.message;
      errorBox.style.display = 'block';
      dashContent.innerHTML = '';
      return;
    }

    const rows = data.rows || [];
    if (!rows.length) {
      dashContent.innerHTML = '<div class="panel pro-panel"><p class="empty-state">No PSI data uploaded yet — see PSI Files uploads.</p></div>';
      return;
    }

    // Aggregate per-(LOB, SubLob) report rows up to per-LOB totals.
    const byLob = {};
    rows.forEach((r) => {
      const key = r.lob || 'Unknown';
      if (!byLob[key]) {
        byLob[key] = { lob: key, sellInQty: 0, sellThroughQty: 0, invTotalQty: 0, shipTotal: 0, backlog: 0 };
      }
      const b = byLob[key];
      b.sellInQty += Number(r.sellInQty || 0);
      b.sellThroughQty += Number(r.sellThroughQty || 0);
      b.invTotalQty += Number(r.invTotalQty || 0);
      b.shipTotal += Number(r.shipWk1 || 0) + Number(r.shipWk2 || 0) + Number(r.shipWk3 || 0);
      b.backlog += Number(r.backlog || 0);
    });
    const lobRows = Object.values(byLob).sort((a, b) => b.sellThroughQty - a.sellThroughQty);

    const totals = lobRows.reduce((acc, r) => ({
      sellInQty: acc.sellInQty + r.sellInQty,
      sellThroughQty: acc.sellThroughQty + r.sellThroughQty,
      invTotalQty: acc.invTotalQty + r.invTotalQty,
      shipTotal: acc.shipTotal + r.shipTotal
    }), { sellInQty: 0, sellThroughQty: 0, invTotalQty: 0, shipTotal: 0 });

    dashContent.innerHTML = `
      <div class="stat-grid pro-stat-grid">
        <div class="stat-card pro-stat-card"><span class="stat-label">Sell-In Qty</span><span class="stat-value">${fmt(totals.sellInQty)}</span></div>
        <div class="stat-card pro-stat-card accent-navy"><span class="stat-label">Sell-Through Qty</span><span class="stat-value">${fmt(totals.sellThroughQty)}</span></div>
        <div class="stat-card pro-stat-card accent-gold"><span class="stat-label">Inventory on Hand</span><span class="stat-value">${fmt(totals.invTotalQty)}</span></div>
        <div class="stat-card pro-stat-card accent-purple"><span class="stat-label">Shipment Plan (3 wk)</span><span class="stat-value">${fmt(totals.shipTotal)}</span></div>
      </div>
      <div class="panel-grid two-col" style="margin-top:20px;">
        <div class="panel pro-panel">
          <h3>Sell-In vs Sell-Through by LOB</h3>
          <canvas id="chart-psi-sellinout" height="220"></canvas>
        </div>
        <div class="panel pro-panel">
          <h3>Inventory on Hand by LOB</h3>
          <canvas id="chart-psi-inv" height="220"></canvas>
        </div>
      </div>
      <div class="panel-grid two-col" style="margin-top:20px;">
        <div class="panel pro-panel">
          <h3>Shipment Plan (next 3 weeks) by LOB</h3>
          <canvas id="chart-psi-ship" height="220"></canvas>
        </div>
        <div class="panel pro-panel">
          <h3>Backlog by LOB</h3>
          <canvas id="chart-psi-backlog" height="220"></canvas>
        </div>
      </div>
    `;

    destroyChart('sellInOut');
    charts.sellInOut = new Chart(document.getElementById('chart-psi-sellinout'), {
      type: 'bar',
      data: {
        labels: lobRows.map((r) => r.lob),
        datasets: [
          { label: 'Sell-In', data: lobRows.map((r) => r.sellInQty), backgroundColor: '#2a78d6', borderRadius: 4 },
          { label: 'Sell-Through', data: lobRows.map((r) => r.sellThroughQty), backgroundColor: '#1baf7a', borderRadius: 4 }
        ]
      },
      options: { responsive: true, plugins: { legend: { position: 'bottom' }, datalabels: { display: false } } }
    });

    destroyChart('inv');
    charts.inv = new Chart(document.getElementById('chart-psi-inv'), {
      type: 'bar',
      data: {
        labels: lobRows.map((r) => r.lob),
        datasets: [{ label: 'Inventory', data: lobRows.map((r) => r.invTotalQty), backgroundColor: '#c9962b', borderRadius: 4 }]
      },
      options: { responsive: true, indexAxis: 'y', plugins: { legend: { display: false }, datalabels: { ...dataLabelBase, anchor: 'end', align: 'right' } } }
    });

    destroyChart('ship');
    charts.ship = new Chart(document.getElementById('chart-psi-ship'), {
      type: 'bar',
      data: {
        labels: lobRows.map((r) => r.lob),
        datasets: [{ label: 'Shipment Plan', data: lobRows.map((r) => r.shipTotal), backgroundColor: '#7a4fc9', borderRadius: 4 }]
      },
      options: { responsive: true, plugins: { legend: { display: false }, datalabels: dataLabelBase } }
    });

    destroyChart('backlog');
    charts.backlog = new Chart(document.getElementById('chart-psi-backlog'), {
      type: 'bar',
      data: {
        labels: lobRows.map((r) => r.lob),
        datasets: [{ label: 'Backlog', data: lobRows.map((r) => r.backlog), backgroundColor: '#B03A2E', borderRadius: 4 }]
      },
      options: { responsive: true, plugins: { legend: { display: false }, datalabels: dataLabelBase } }
    });
  }

  async function loadSalesTrend() {
    const { data, error } = await supabaseClient.rpc('get_sales_trend', {
      p_group_by: 'week',
      p_periods: 16,
      p_lobs: []
    });

    if (error) {
      trendContainer.innerHTML = `<div class="alert-error">${escapeHtml(error.message)}</div>`;
      return;
    }

    if (!data.points.length || data.points.every((p) => p.qty === 0 && p.revenue === 0)) {
      trendContainer.innerHTML = '<div class="panel pro-panel"><p class="empty-state">No Sales Data uploaded yet — see PSI Files → Sales Data.</p></div>';
      return;
    }

    trendContainer.innerHTML = `
      <div class="panel-grid two-col">
        <div class="panel pro-panel">
          <h3>Weekly ${trendMetric === 'qty' ? 'Units Sold' : 'Revenue'}</h3>
          <canvas id="chart-psi-trend" height="200"></canvas>
        </div>
        <div class="panel pro-panel">
          <h3>By LOB (this window)</h3>
          <canvas id="chart-psi-lob" height="200"></canvas>
        </div>
      </div>
    `;

    destroyChart('psiTrend');
    charts.psiTrend = new Chart(document.getElementById('chart-psi-trend'), {
      type: 'bar',
      data: {
        labels: data.points.map((p) => p.label),
        datasets: [{
          label: trendMetric === 'qty' ? 'Units Sold' : 'Revenue',
          data: data.points.map((p) => (trendMetric === 'qty' ? p.qty : p.revenue)),
          backgroundColor: '#2a78d6',
          borderRadius: 4
        }]
      },
      options: { responsive: true, plugins: { legend: { display: false }, datalabels: { ...dataLabelBase, color: '#184f95' } } }
    });

    destroyChart('psiLob');
    charts.psiLob = new Chart(document.getElementById('chart-psi-lob'), {
      type: 'bar',
      data: {
        labels: data.byLob.map((l) => l.lob),
        datasets: [{
          label: trendMetric === 'qty' ? 'Units Sold' : 'Revenue',
          data: data.byLob.map((l) => (trendMetric === 'qty' ? l.qty : l.revenue)),
          backgroundColor: '#1baf7a',
          borderRadius: 4
        }]
      },
      options: { responsive: true, indexAxis: 'y', plugins: { legend: { display: false }, datalabels: { ...dataLabelBase, anchor: 'end', align: 'right' } } }
    });
  }

  document.getElementById('psi-dash-period-toggle').addEventListener('click', (e) => {
    const btn = e.target.closest('.toggle-btn');
    if (!btn) return;
    document.querySelectorAll('#psi-dash-period-toggle .toggle-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    period = btn.dataset.period;
    loadPsiDashboard();
  });

  document.getElementById('trend-metric-toggle').addEventListener('click', (e) => {
    const btn = e.target.closest('.toggle-btn');
    if (!btn) return;
    document.querySelectorAll('#trend-metric-toggle .toggle-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    trendMetric = btn.dataset.metric;
    loadSalesTrend();
  });

  await loadPsiDashboard();
  await loadSalesTrend();
})();
