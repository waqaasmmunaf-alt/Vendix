// Injects the sidebar into <div id="app-shell"> and wires up logout + role-based nav visibility.
// Call renderLayout(activePage, contentHtml) from each page's script after loading the profile.

function renderLayout(activePage, profile) {
  const isAdmin = profile.role === 'admin';

  const navItems = [
    { href: 'dashboard.html', label: 'Dashboard', key: 'dashboard' },
    { href: 'upload-ops.html', label: 'Upload Sales File', key: 'upload-ops' },
    { href: 'upload-activation.html', label: 'Upload Activation Check', key: 'upload-activation' },
    { href: 'upload-combined.html', label: 'Upload Combined Report', key: 'upload-combined' },
    { href: 'inventory.html', label: 'Inventory', key: 'inventory' },
    { href: 'search.html', label: 'IMEI Search', key: 'search' },
    { section: 'PSI Files' },
    { href: 'upload-shipment-plan.html', label: 'Upload Shipment Plan', key: 'upload-shipment-plan' },
    { href: 'psi-report.html', label: 'PSI Report', key: 'psi-report' },
    { section: null },
    { href: 'settings.html', label: 'Master Settings', key: 'settings' }
  ];
  if (isAdmin) {
    navItems.push(
      { href: 'trash.html', label: 'Trash', key: 'trash' },
      { href: 'manage-uploads.html', label: 'Manage Uploads', key: 'manage-uploads' },
      { href: 'audit-log.html', label: 'Audit Log', key: 'audit-log' },
      { href: 'users.html', label: 'Users', key: 'users' }
    );
  }

  const navHtml = navItems
    .map((item) => item.section !== undefined
      ? (item.section ? `<span class="nav-section-label">${item.section}</span>` : '')
      : `<a href="${item.href}" class="${item.key === activePage ? 'active' : ''}">${item.label}</a>`)
    .join('');

  document.getElementById('sidebar-nav').innerHTML = navHtml;
  document.getElementById('user-name').textContent = profile.name;
  document.getElementById('user-role').textContent = profile.role;
  document.getElementById('logout-btn').addEventListener('click', logout);
}
