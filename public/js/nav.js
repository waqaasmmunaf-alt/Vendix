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
  pin: '<path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Z"/><circle cx="12" cy="9" r="2.5"/>',
  chart: '<path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="6"/><rect x="12" y="8" width="3" height="10"/><rect x="17" y="5" width="3" height="13"/>',
  table: '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/>',
  receipt: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M9 13h6"/><path d="M9 17h6"/>'
};

function navIcon(key) {
  const path = NAV_ICONS[key] || NAV_ICONS.dashboard;
  return `<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

const NAV_CHEVRON = '<svg class="nav-chevron" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

function linkHtml(item, activePage) {
  return `<a href="${item.href}" class="${item.key === activePage ? 'active' : ''}">${navIcon(item.icon)}<span>${item.label}</span></a>`;
}

// Renders a collapsible nav group: a clickable header (icon + label + chevron)
// with its links nested underneath. Open state is remembered per-browser via
// localStorage, but a group is always forced open if it contains the active page.
function groupHtml(group, activePage) {
  const containsActive = group.items.some((i) => i.key === activePage);
  let stored = null;
  try { stored = localStorage.getItem('cp_nav_' + group.key + '_open'); } catch (e) { /* ignore */ }
  const isOpen = containsActive || stored === '1' || (stored === null && group.defaultOpen !== false);

  return `<div class="nav-group ${isOpen ? 'open' : ''}" data-group-key="${group.key}">
    <button type="button" class="nav-group-toggle">
      ${navIcon(group.icon)}<span>${group.label}</span>${NAV_CHEVRON}
    </button>
    <div class="nav-subgroup">
      ${group.items.map((i) => linkHtml(i, activePage)).join('')}
    </div>
  </div>`;
}

function renderLayout(activePage, profile) {
  const isAdmin = profile.role === 'admin';

  const uploadGroup = {
    key: 'upload', label: 'Upload', icon: 'upload', defaultOpen: false,
    items: [
      { href: 'upload-ops.html', label: 'Sales File', key: 'upload-ops', icon: 'upload' },
      { href: 'upload-activation.html', label: 'Activation Check', key: 'upload-activation', icon: 'check' },
      { href: 'upload-combined.html', label: 'Combined Report', key: 'upload-combined', icon: 'layers' },
      { href: 'upload-pk-order.html', label: 'PK Orders', key: 'upload-pk-order', icon: 'pin' }
    ]
  };

  const searchGroup = {
    key: 'search-group', label: 'Search', icon: 'search', defaultOpen: false,
    items: [
      { href: 'search.html', label: 'IMEI', key: 'search', icon: 'search' },
      { href: 'invoice-search.html', label: 'Invoice', key: 'invoice-search', icon: 'receipt' },
      { href: 'bulk-lookup.html', label: 'Bulk Lookup', key: 'bulk-lookup', icon: 'list' },
      { href: 'bulk-invoice-lookup.html', label: 'Bulk Invoice Lookup', key: 'bulk-invoice-lookup', icon: 'receipt' }
    ]
  };

  const reportsGroup = {
    key: 'reports', label: 'Reports', icon: 'chart', defaultOpen: false,
    items: [
      { href: 'summary.html', label: 'Summary', key: 'summary', icon: 'chart' },
      { href: 'pivot-summary.html', label: 'Pivot Summary', key: 'pivot-summary', icon: 'table' }
    ]
  };

  const settingsGroup = {
    key: 'admin-settings', label: 'Settings', icon: 'sliders', defaultOpen: false,
    items: [
      { href: 'trash.html', label: 'Trash', key: 'trash', icon: 'trash' },
      { href: 'manage-uploads.html', label: 'Manage Uploads', key: 'manage-uploads', icon: 'list' },
      { href: 'settings.html', label: 'Master Settings', key: 'settings', icon: 'sliders' },
      { href: 'audit-log.html', label: 'Audit Log', key: 'audit-log', icon: 'clock' },
      { href: 'users.html', label: 'Users', key: 'users', icon: 'users' }
    ]
  };

  const topItems = [
    { href: 'dashboard.html', label: 'Dashboard', key: 'dashboard', icon: 'dashboard' }
  ];
  const midItems = [
    { href: 'inventory.html', label: 'Inventory', key: 'inventory', icon: 'box' }
  ];

  const navHtml =
    topItems.map((i) => linkHtml(i, activePage)).join('') +
    groupHtml(uploadGroup, activePage) +
    midItems.map((i) => linkHtml(i, activePage)).join('') +
    groupHtml(searchGroup, activePage) +
    groupHtml(reportsGroup, activePage) +
    (isAdmin ? groupHtml(settingsGroup, activePage) : (
      `<a href="settings.html" class="${activePage === 'settings' ? 'active' : ''}">${navIcon('sliders')}<span>Master Settings</span></a>`
    ));

  document.getElementById('sidebar-nav').innerHTML = navHtml;
  document.getElementById('user-name').textContent = profile.name;
  document.getElementById('user-role').textContent = profile.role;
  document.getElementById('logout-btn').addEventListener('click', logout);

  document.querySelectorAll('.nav-group-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const group = btn.closest('.nav-group');
      const isOpen = group.classList.toggle('open');
      try { localStorage.setItem('cp_nav_' + group.dataset.groupKey + '_open', isOpen ? '1' : '0'); } catch (e) { /* ignore */ }
    });
  });
}
