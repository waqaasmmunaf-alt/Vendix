// Injects the sidebar into <div id="app-shell"> and wires up logout + role-based nav visibility.
// Call renderLayout(activePage, contentHtml) from each page's script after loading the profile.

// Minimal inline icon set (stroke-based, 24x24 viewBox) — no external icon font needed.
const NAV_ICONS = {
  dashboard: '<path d="M3 13h8V3H3v10Zm10 8h8V11h-8v10ZM3 21h8v-6H3v6ZM13 9h8V3h-8v6Z"/>',
  upload: '<path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 21h14a2 2 0 0 0 2-2v-5"/><path d="M3 14v5a2 2 0 0 0 2 2"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.2 2.2 4.8-4.8"/>',
  layers: '<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
  box: '<path d="M21 8V7l-9-4-9 4v10l9 4 9-4v-1"/><path d="M3.3 7 12 11l8.7-4"/><path d="M12 22V11"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  sliders: '<path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><circle cx="4" cy="12" r="2"/><circle cx="12" cy="10" r="2"/><circle cx="20" cy="14" r="2"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  list: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  truck: '<path d="M1 3h15v13H1z"/><path d="M16 8h4l3 3v5h-7V8Z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
  chart: '<path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="6"/><rect x="12" y="8" width="3" height="10"/><rect x="17" y="5" width="3" height="13"/>',
  dollar: '<circle cx="12" cy="12" r="9"/><path d="M12 6v12"/><path d="M15.5 9.5c0-1.4-1.6-2.5-3.5-2.5s-3.5 1-3.5 2.5S10 12 12 12s3.5 1 3.5 2.5-1.6 2.5-3.5 2.5-3.5-1.1-3.5-2.5"/>',
  cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h2l2.4 12.4a2 2 0 0 0 2 1.6h8.2a2 2 0 0 0 2-1.6L21 7H6"/>',
  archive: '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>'
};

function navIcon(key) {
  const path = NAV_ICONS[key] || NAV_ICONS.dashboard;
  return `<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

function renderLayout(activePage, profile) {
  const isAdmin = profile.role === 'admin';

  const navItems = [
    { href: 'dashboard.html', label: 'Dashboard', key: 'dashboard', icon: 'dashboard' },
    { href: 'upload-ops.html', label: 'Upload Sales File', key: 'upload-ops', icon: 'upload' },
    { href: 'upload-activation.html', label: 'Upload Activation Check', key: 'upload-activation', icon: 'check' },
    { href: 'upload-combined.html', label: 'Upload Combined Report', key: 'upload-combined', icon: 'layers' },
    { href: 'inventory.html', label: 'Inventory', key: 'inventory', icon: 'box' },
    { href: 'search.html', label: 'IMEI Search', key: 'search', icon: 'search' },
    { href: 'settings.html', label: 'Master Settings', key: 'settings', icon: 'sliders' }
  ];
  if (isAdmin) {
    navItems.push(
      { href: 'trash.html', label: 'Trash', key: 'trash', icon: 'trash' },
      { href: 'manage-uploads.html', label: 'Manage Uploads', key: 'manage-uploads', icon: 'list' },
      { href: 'audit-log.html', label: 'Audit Log', key: 'audit-log', icon: 'clock' },
      { href: 'users.html', label: 'Users', key: 'users', icon: 'users' }
    );
  }

  // PSI Files — kept in its own visually-separate, tinted group (own data
  // pipeline: Sales/Purchase ledgers, Inventory snapshot, Shipment plan — all
  // SKU-level, independent of the IMEI-based tracking above).
  const psiItems = [
    { href: 'upload-sales-ledger.html', label: 'Upload Sales Data', key: 'upload-sales-ledger', icon: 'dollar' },
    { href: 'upload-purchase-ledger.html', label: 'Upload Purchase Data', key: 'upload-purchase-ledger', icon: 'cart' },
    { href: 'upload-inventory-snapshot.html', label: 'Upload Inventory', key: 'upload-inventory-snapshot', icon: 'archive' },
    { href: 'upload-shipment-plan.html', label: 'Upload Shipment Plan', key: 'upload-shipment-plan', icon: 'truck' },
    { href: 'psi-report.html', label: 'PSI Report', key: 'psi-report', icon: 'chart' }
  ];

  const linkHtml = (item) =>
    `<a href="${item.href}" class="${item.key === activePage ? 'active' : ''}">${navIcon(item.icon)}<span>${item.label}</span></a>`;

  const navHtml = navItems.map(linkHtml).join('') +
    `<div class="nav-group-psi">
      <span class="nav-section-label">PSI Files</span>
      ${psiItems.map(linkHtml).join('')}
    </div>`;

  document.getElementById('sidebar-nav').innerHTML = navHtml;
  document.getElementById('user-name').textContent = profile.name;
  document.getElementById('user-role').textContent = profile.role;
  document.getElementById('logout-btn').addEventListener('click', logout);
}
