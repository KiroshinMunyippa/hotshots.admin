import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_ACCOUNTS_URL, SUPABASE_ACCOUNTS_ANON_KEY, API_BASE } from './config.js';

const supabase = createClient(SUPABASE_ACCOUNTS_URL, SUPABASE_ACCOUNTS_ANON_KEY);
const app = document.getElementById('app');

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' })[char]);
const showToast = (message) => { 
  const toast = document.getElementById('toast'); 
  toast.textContent = message; 
  toast.classList.add('show'); 
  clearTimeout(showToast.timer); 
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2600); 
};
const formatDate = (iso) => iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

const state = {
  session: null, adminProfile: null, authChecked: false, authError: '',
  tab: 'users', users: [], recipes: [], stats: null,
  userSearch: '', recipeSearch: '', loading: false,
  // New feature state
  analytics: null, moderation: [], auditLogs: [], settings: [],
  selectedUser: null, userDrawerOpen: false
};

async function authFetch(path, options = {}) {
  const token = state.session?.access_token;
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) }
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(body.error || 'Something went wrong');
  return body;
}

async function checkAdmin() {
  const { data } = await supabase.from('profiles').select('display_name, email, is_admin').eq('id', state.session.user.id).single();
  state.adminProfile = data || null;
  state.authChecked = true;
}

async function loadAll() {
  state.loading = true; render();
  try {
    const [{ users }, { recipes }, stats, analytics, moderation, auditLogs, settings] = await Promise.all([
      authFetch('/api/admin/users'), 
      authFetch('/api/admin/recipes'), 
      authFetch('/api/admin/stats'),
      authFetch('/api/admin/analytics'),
      authFetch('/api/admin/moderation'),
      authFetch('/api/admin/audit'),
      authFetch('/api/admin/settings')
    ]);
    state.users = users; state.recipes = recipes; state.stats = stats;
    state.analytics = analytics; state.moderation = moderation; 
    state.auditLogs = auditLogs; state.settings = settings;
  } catch (err) { showToast(err.message); }
  state.loading = false; render();
}

function exportToCSV(data, filename) {
  if (!data || !data.length) return showToast('No data to export');
  const headers = Object.keys(data[0]);
  const csv = [
    headers.join(','),
    ...data.map(row => headers.map(h => `"${String(row[h] ?? '').replace(/"/g, '""')}"`).join(','))
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
  showToast('Exported successfully');
}

function renderAuth() {
  app.innerHTML = `
    <div class="auth-shell">
      <div class="auth-card">
        <h1>HotShots Admin</h1>
        <p>Sign in with an account flagged as an administrator.</p>
        <form id="admin-login">
          <div class="field"><label for="admin-email">Email</label><input id="admin-email" name="email" type="email" required autocomplete="email"></div>
          <div class="field"><label for="admin-password">Password</label><input id="admin-password" name="password" type="password" required autocomplete="current-password"></div>
          ${state.authError ? `<p class="auth-error">${escapeHtml(state.authError)}</p>` : ''}
          <button class="primary-button" type="submit">Sign in</button>
        </form>
      </div>
    </div>`;
}

function renderLocked() {
  app.innerHTML = `
    <div class="auth-shell">
      <div class="auth-card">
        <h1>Not an admin account</h1>
        <p>${escapeHtml(state.adminProfile?.email || state.session?.user?.email || 'This account')} isn't flagged as an administrator.</p>
        <button class="primary-button" id="admin-sign-out" type="button">Sign out</button>
      </div>
    </div>`;
}

function statStrip() {
  if (!state.stats) return '';
  const items = [
    { label: 'Users', value: state.stats.users }, { label: 'Recipes', value: state.stats.recipes },
    { label: 'Shared', value: state.stats.shared }, { label: 'Paid plans', value: state.stats.paid }
  ];
  return `<div class="stat-strip">${items.map(i => `<div class="stat-box"><strong>${i.value}</strong><span>${i.label}</span></div>`).join('')}</div>`;
}

function renderShell(content) {
  const modCount = state.moderation.length;
  app.innerHTML = `
    <aside class="sidebar">
      <p class="brand">HotShots<span>Admin</span></p>
      <nav class="side-nav">
        <button data-tab="users" class="${state.tab === 'users' ? 'active' : ''}">Users</button>
        <button data-tab="recipes" class="${state.tab === 'recipes' ? 'active' : ''}">Recipes</button>
        <button data-tab="analytics" class="${state.tab === 'analytics' ? 'active' : ''}">Analytics</button>
        <button data-tab="moderation" class="${state.tab === 'moderation' ? 'active' : ''}">
          Moderation ${modCount ? `<span class="badge status-past_due" style="margin-left:6px;font-size:9px;">${modCount}</span>` : ''}
        </button>
        <button data-tab="audit" class="${state.tab === 'audit' ? 'active' : ''}">Audit Log</button>
        <button data-tab="settings" class="${state.tab === 'settings' ? 'active' : ''}">Settings</button>
      </nav>
      <div class="sidebar-foot">
        <div class="admin-chip"><strong>${escapeHtml(state.adminProfile?.display_name || 'Admin')}</strong>${escapeHtml(state.adminProfile?.email || '')}</div>
        <button class="sign-out-link" id="admin-sign-out">Sign out</button>
      </div>
    </aside>
    <main class="main">${content}</main>`;
}

function renderUsers() {
  const search = state.userSearch.trim().toLowerCase();
  const rows = state.users.filter(u => !search || u.display_name?.toLowerCase().includes(search) || u.email?.toLowerCase().includes(search));
  renderShell(`
    <h1>Users</h1>
    <p class="main-subtitle">Everyone with a HotShots account. Override plan or status here.</p>
    ${statStrip()}
    <div class="toolbar">
      <input type="search" id="user-search" placeholder="Search by name or email" value="${escapeHtml(state.userSearch)}">
      <button class="icon-button" data-export="users">Export CSV</button>
    </div>
    <div class="table-card"><table>
      <thead><tr><th>User</th><th>Plan</th><th>Status</th><th>Joined</th><th>Update</th></tr></thead>
      <tbody>
        ${rows.length ? rows.map(u => `
          <tr data-user-row="${u.id}">
            <td class="name-cell"><strong>${escapeHtml(u.display_name)}</strong><small>${escapeHtml(u.email)}</small></td>
            <td><span class="badge plan-${u.subscription_plan}">${escapeHtml(u.subscription_plan)}</span></td>
            <td><span class="badge status-${u.subscription_status}">${escapeHtml(u.subscription_status)}</span></td>
            <td>${formatDate(u.created_at)}</td>
            <td><div class="row-actions">
              <button class="icon-button" data-view-user="${u.id}">View</button>
              <select data-field="subscription_plan"><option value="free" ${u.subscription_plan === 'free' ? 'selected' : ''}>Free</option><option value="plus" ${u.subscription_plan === 'plus' ? 'selected' : ''}>Plus</option><option value="pro" ${u.subscription_plan === 'pro' ? 'selected' : ''}>Pro</option></select>
              <select data-field="subscription_status"><option value="active" ${u.subscription_status === 'active' ? 'selected' : ''}>Active</option><option value="trialing" ${u.subscription_status === 'trialing' ? 'selected' : ''}>Trialing</option><option value="past_due" ${u.subscription_status === 'past_due' ? 'selected' : ''}>Past due</option><option value="canceled" ${u.subscription_status === 'canceled' ? 'selected' : ''}>Canceled</option></select>
              <button class="icon-button save" data-save-user="${u.id}">Save</button>
            </div></td>
          </tr>`).join('') : `<tr class="empty-row"><td colspan="5">No users match that search.</td></tr>`}
      </tbody>
    </table></div>`);
}

function renderRecipes() {
  const search = state.recipeSearch.trim().toLowerCase();
  const rows = state.recipes.filter(r => !search || r.name.toLowerCase().includes(search) || r.author.display_name?.toLowerCase().includes(search) || r.author.email?.toLowerCase().includes(search));
  renderShell(`
    <h1>Recipes</h1>
    <p class="main-subtitle">Every recipe across the app, shared or private.</p>
    ${statStrip()}
    <div class="toolbar">
      <input type="search" id="recipe-search" placeholder="Search by name or author" value="${escapeHtml(state.recipeSearch)}">
      <button class="icon-button" data-export="recipes">Export CSV</button>
    </div>
    <div class="table-card"><table>
      <thead><tr><th>Recipe</th><th>Author</th><th>Rating</th><th>Visibility</th><th>Created</th><th>Actions</th></tr></thead>
      <tbody>
        ${rows.length ? rows.map(r => `
          <tr>
            <td class="name-cell"><strong>${escapeHtml(r.name)}</strong><small>${escapeHtml(r.category)}</small></td>
            <td class="name-cell"><strong>${escapeHtml(r.author.display_name)}</strong><small>${escapeHtml(r.author.email)}</small></td>
            <td>${r.rating.count ? `${(r.rating.total / r.rating.count).toFixed(1)} (${r.rating.count})` : '—'}</td>
            <td><span class="badge shared-${r.shared ? 'yes' : 'no'}">${r.shared ? 'Shared' : 'Private'}</span></td>
            <td>${formatDate(r.createdAt)}</td>
            <td><div class="row-actions">
              <button class="icon-button" data-toggle-shared="${r.id}" data-currently-shared="${r.shared}">${r.shared ? 'Hide' : 'Unhide'}</button>
              <button class="icon-button danger" data-delete-recipe="${r.id}">Delete</button>
            </div></td>
          </tr>`).join('') : `<tr class="empty-row"><td colspan="6">No recipes match that search.</td></tr>`}
      </tbody>
    </table></div>`);
}

function renderAnalytics() {
  if (!state.analytics) return '<p class="main-subtitle">Loading analytics...</p>';
  const { signupsLast30Days, planDistribution, recipesByCategory, sharedRecipes } = state.analytics;
  const totalUsers = Object.values(planDistribution).reduce((a, b) => a + b, 0) || 1;
  
  return `
    <h1>Analytics</h1>
    <p class="main-subtitle">Overview of app usage and growth.</p>
    <div class="stat-strip">
      <div class="stat-box"><strong>${signupsLast30Days}</strong><span>Signups (30d)</span></div>
      <div class="stat-box"><strong>${sharedRecipes}</strong><span>Shared Recipes</span></div>
      <div class="stat-box"><strong>${Object.keys(recipesByCategory).length}</strong><span>Categories</span></div>
      <div class="stat-box"><strong>${totalUsers}</strong><span>Total Users</span></div>
    </div>
    <div class="table-card" style="padding: 20px;">
      <h3 style="margin: 0 0 16px; font-size: 14px;">Plan Distribution</h3>
      ${Object.entries(planDistribution).map(([plan, count]) => `
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
          <span style="width: 60px; font-size: 12px; text-transform: capitalize;">${plan}</span>
          <div style="flex: 1; height: 20px; background: var(--panel-2); border-radius: 6px; overflow: hidden;">
            <div style="height: 100%; width: ${(count / totalUsers) * 100}%; background: var(--acid); transition: width 0.3s;"></div>
          </div>
          <span style="width: 40px; text-align: right; font-size: 12px; color: var(--muted);">${count}</span>
        </div>
      `).join('')}
    </div>`;
}

function renderModeration() {
  return `
    <h1>Moderation Queue</h1>
    <p class="main-subtitle">Reported recipes pending review.</p>
    <div class="table-card"><table>
      <thead><tr><th>Recipe</th><th>Reason</th><th>Reported</th><th>Actions</th></tr></thead>
      <tbody>
        ${state.moderation.length ? state.moderation.map(r => `
          <tr>
            <td class="name-cell"><strong>${escapeHtml(r.recipe?.name || 'Unknown')}</strong></td>
            <td>${escapeHtml(r.reason || 'No reason provided')}</td>
            <td>${formatDate(r.created_at)}</td>
            <td><div class="row-actions">
              <button class="icon-button save" data-resolve-report="${r.id}">Resolve</button>
              <button class="icon-button danger" data-dismiss-report="${r.id}">Dismiss</button>
            </div></td>
          </tr>
        `).join('') : `<tr class="empty-row"><td colspan="4">No pending reports. Great job!</td></tr>`}
      </tbody>
    </table></div>`;
}

function renderAudit() {
  return `
    <h1>Audit Log</h1>
    <p class="main-subtitle">Recent admin actions.</p>
    <div class="table-card"><table>
      <thead><tr><th>Admin</th><th>Action</th><th>Target</th><th>When</th></tr></thead>
      <tbody>
        ${state.auditLogs.length ? state.auditLogs.map(log => `
          <tr>
            <td>${escapeHtml(log.admin_email || 'System')}</td>
            <td><span class="badge status-active">${escapeHtml(log.action)}</span></td>
            <td>${escapeHtml(log.target_type)} ${escapeHtml(log.target_id || '')}</td>
            <td>${formatDate(log.created_at)}</td>
          </tr>
        `).join('') : `<tr class="empty-row"><td colspan="4">No audit logs yet.</td></tr>`}
      </tbody>
    </table></div>`;
}

function renderSettings() {
  return `
    <h1>App Settings</h1>
    <p class="main-subtitle">Global feature flags and configuration.</p>
    <div class="table-card"><table>
      <thead><tr><th>Setting</th><th>Value</th><th>Updated</th><th>Actions</th></tr></thead>
      <tbody>
        ${state.settings.map(s => `
          <tr data-setting-row="${s.key}">
            <td><strong>${escapeHtml(s.key)}</strong></td>
            <td><input type="text" data-setting-value="${s.key}" value="${escapeHtml(String(s.value))}" style="width: 100%; max-width: 200px;"></td>
            <td>${formatDate(s.updated_at)}</td>
            <td><button class="icon-button save" data-save-setting="${s.key}">Save</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table></div>`;
}

function renderUserDrawer() {
  if (!state.userDrawerOpen || !state.selectedUser) return '';
  const { user, recipes } = state.selectedUser;
  return `
    <div class="drawer-overlay" id="drawer-overlay"></div>
    <div class="drawer">
      <div class="drawer-header">
        <h2>${escapeHtml(user.display_name || 'User')}</h2>
        <button class="icon-button" id="close-drawer" style="font-size: 18px; padding: 2px 8px;">×</button>
      </div>
      <div class="drawer-content">
        <div class="drawer-section">
          <h3>Account Info</h3>
          <p><strong>Email:</strong> ${escapeHtml(user.email)}</p>
          <p><strong>Plan:</strong> <span class="badge plan-${user.subscription_plan}">${escapeHtml(user.subscription_plan)}</span></p>
          <p><strong>Status:</strong> <span class="badge status-${user.subscription_status}">${escapeHtml(user.subscription_status)}</span></p>
          <p><strong>Joined:</strong> ${formatDate(user.created_at)}</p>
        </div>
        <div class="drawer-section">
          <h3>Admin Notes</h3>
          <textarea id="admin-notes" style="width: 100%; min-height: 100px; resize: vertical;">${escapeHtml(user.admin_notes || '')}</textarea>
          <button class="icon-button save" id="save-notes" data-user-id="${user.id}" style="margin-top: 10px;">Save Notes</button>
        </div>
        <div class="drawer-section">
          <h3>Recipes (${recipes.length})</h3>
          ${recipes.length ? recipes.map(r => `
            <div style="padding: 8px 0; border-bottom: 1px solid var(--line);">
              <strong>${escapeHtml(r.name)}</strong>
              <small style="display: block; color: var(--muted); margin-top: 4px;">${formatDate(r.created_at)} • ${r.shared ? 'Shared' : 'Private'}</small>
            </div>
          `).join('') : '<p style="color: var(--muted); font-size: 13px;">No recipes yet.</p>'}
        </div>
      </div>
    </div>`;
}

function render() {
  if (!state.session) return renderAuth();
  if (!state.authChecked) { app.innerHTML = '<div class="auth-shell"><p class="main-subtitle">Checking access…</p></div>'; return; }
  if (!state.adminProfile?.is_admin) return renderLocked();
  if (state.loading && !state.stats) { app.innerHTML = '<div class="auth-shell"><p class="main-subtitle">Loading dashboard…</p></div>'; return; }

  let content = '';
  switch (state.tab) {
    case 'analytics': content = renderAnalytics(); break;
    case 'moderation': content = renderModeration(); break;
    case 'audit': content = renderAudit(); break;
    case 'settings': content = renderSettings(); break;
    case 'recipes': content = renderRecipes(); break;
    default: content = renderUsers();
  }

  renderShell(content);
  if (state.userDrawerOpen) {
    document.body.insertAdjacentHTML('beforeend', renderUserDrawer());
  }
}

document.addEventListener('click', event => {
  const tab = event.target.closest('[data-tab]'); 
  if (tab) { state.tab = tab.dataset.tab; return render(); }
  
  if (event.target.closest('#admin-sign-out')) return supabase.auth.signOut();

  // Export CSV
  if (event.target.closest('[data-export="users"]')) { exportToCSV(state.users, 'hotshots-users.csv'); return; }
  if (event.target.closest('[data-export="recipes"]')) { exportToCSV(state.recipes, 'hotshots-recipes.csv'); return; }

  // User Drawer
  if (event.target.closest('[data-view-user]')) {
    const id = event.target.closest('[data-view-user]').dataset.viewUser;
    authFetch(`/api/admin/users/${id}/details`)
      .then(data => { state.selectedUser = data; state.userDrawerOpen = true; render(); })
      .catch(err => showToast(err.message));
    return;
  }
  if (event.target.closest('#close-drawer') || event.target.closest('#drawer-overlay')) {
    state.userDrawerOpen = false; state.selectedUser = null; render(); return;
  }
  if (event.target.closest('#save-notes')) {
    const userId = event.target.closest('#save-notes').dataset.userId;
    const notes = document.getElementById('admin-notes').value;
    authFetch(`/api/admin/users/${userId}/details`, { method: 'PATCH', body: JSON.stringify({ admin_notes: notes }) })
      .then(() => { showToast('Notes saved'); state.userDrawerOpen = false; render(); })
      .catch(err => showToast(err.message));
    return;
  }

  // Save User Plan/Status
  const saveUser = event.target.closest('[data-save-user]');
  if (saveUser) {
    const id = saveUser.dataset.saveUser;
    const row = saveUser.closest('[data-user-row]');
    const plan = row.querySelector('[data-field="subscription_plan"]').value;
    const status = row.querySelector('[data-field="subscription_status"]').value;
    authFetch(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify({ subscription_plan: plan, subscription_status: status }) })
      .then(({ user }) => { state.users = state.users.map(u => u.id === id ? { ...u, ...user } : u); render(); showToast(`Updated ${user.display_name || user.email}`); })
      .catch(err => showToast(err.message));
    return;
  }

  // Toggle Recipe Shared
  const toggle = event.target.closest('[data-toggle-shared]');
  if (toggle) {
    const id = toggle.dataset.toggleShared;
    const nextShared = toggle.dataset.currentlyShared !== 'true';
    authFetch(`/api/admin/recipes/${id}`, { method: 'PATCH', body: JSON.stringify({ shared: nextShared }) })
      .then(({ recipe }) => { state.recipes = state.recipes.map(r => r.id === id ? { ...r, shared: recipe.is_shared } : r); render(); showToast(nextShared ? 'Recipe unhidden' : 'Recipe hidden'); })
      .catch(err => showToast(err.message));
    return;
  }

  // Delete Recipe
  const del = event.target.closest('[data-delete-recipe]');
  if (del) {
    const id = del.dataset.deleteRecipe;
    const recipe = state.recipes.find(r => r.id === id);
    if (!window.confirm(`Permanently delete "${recipe?.name}"? This can't be undone.`)) return;
    authFetch(`/api/admin/recipes/${id}`, { method: 'DELETE' })
      .then(() => { state.recipes = state.recipes.filter(r => r.id !== id); render(); showToast('Recipe deleted'); })
      .catch(err => showToast(err.message));
    return;
  }

  // Moderation Actions
  if (event.target.closest('[data-resolve-report]')) {
    const id = event.target.closest('[data-resolve-report]').dataset.resolveReport;
    authFetch(`/api/admin/moderation/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'resolved' }) })
      .then(() => { state.moderation = state.moderation.filter(r => r.id !== id); render(); showToast('Report resolved'); })
      .catch(err => showToast(err.message));
    return;
  }
  if (event.target.closest('[data-dismiss-report]')) {
    const id = event.target.closest('[data-dismiss-report]').dataset.dismissReport;
    authFetch(`/api/admin/moderation/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'dismissed' }) })
      .then(() => { state.moderation = state.moderation.filter(r => r.id !== id); render(); showToast('Report dismissed'); })
      .catch(err => showToast(err.message));
    return;
  }

  // Save Settings
  if (event.target.closest('[data-save-setting]')) {
    const key = event.target.closest('[data-save-setting]').dataset.saveSetting;
    const value = document.querySelector(`[data-setting-value="${key}"]`).value;
    authFetch('/api/admin/settings', { method: 'PATCH', body: JSON.stringify({ key, value }) })
      .then(() => { state.settings = state.settings.map(s => s.key === key ? { ...s, value } : s); render(); showToast('Setting saved'); })
      .catch(err => showToast(err.message));
    return;
  }
});

document.addEventListener('submit', event => {
  if (event.target.id !== 'admin-login') return;
  event.preventDefault();
  const form = new FormData(event.target);
  state.authError = '';
  supabase.auth.signInWithPassword({ email: form.get('email').trim(), password: form.get('password') })
    .then(({ error }) => { if (error) { state.authError = error.message; render(); } });
});

document.addEventListener('input', event => {
  if (event.target.id === 'user-search') { state.userSearch = event.target.value; return renderUsers(); }
  if (event.target.id === 'recipe-search') { state.recipeSearch = event.target.value; return renderRecipes(); }
});

supabase.auth.onAuthStateChange(async (_event, newSession) => {
  const wasSignedIn = Boolean(state.session);
  state.session = newSession;
  if (newSession && !wasSignedIn) {
    render();
    await checkAdmin();
    if (state.adminProfile?.is_admin) await loadAll(); else render();
  }
  if (!newSession) { 
    state.adminProfile = null; state.authChecked = false; state.users = []; state.recipes = []; 
    state.stats = null; state.tab = 'users'; state.userDrawerOpen = false; state.selectedUser = null;
    render(); 
  }
});

render();
